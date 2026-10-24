import type {PoolClient} from 'pg';
import { randomUUID } from 'node:crypto';
import { db, inTransaction } from '../../shared/config/db';
import { ApiError } from '../../shared/errors';
import { withVerifiedOtp } from '../auth/otp.service';
import { gateway, isTransferNotFound, paymentMode, PaystackRequestError } from './gateway';
import { env } from '../../config/env';
import { getOrCreateEarningsAccount, getSystemAccountId, postTransaction } from './ledger.service';
import { approvedDriver, rateLimit } from './payoutAccounts.service';
import { enqueuePayout } from './paymentQueue';
import { emitWalletUpdated } from '../../websocket/notifications';
import { createNotificationRecord, publishNotification } from '../notifications/notifications.service';
import { walletNotification } from '../notifications/notificationTemplates';

interface WithdrawalRow {id:string;user_id:string;amount_kobo:string;fee_kobo:string;status:string;provider_reference:string;provider_transfer_code:string|null;recipient_code:string;attempts:number;request_tx_id:string|null}
export async function requestWithdrawal(userId:string,payoutAccountId:string,amountKobo:number,otpCode:string,expectedFeeKobo?:unknown) {
  if(expectedFeeKobo!==undefined&&(!Number.isSafeInteger(expectedFeeKobo)||Number(expectedFeeKobo)<0))throw new ApiError(400,'invalid_withdrawal_fee');
  if(paymentMode()==='live'&&!env.ENABLE_LIVE_PAYMENTS)throw new ApiError(503,'live_payments_disabled');
  const user=await approvedDriver(userId);
  if (!user.phone||!Number.isSafeInteger(amountKobo)||amountKobo<=0) throw new ApiError(400,'invalid_withdrawal');
  await rateLimit(`payments:withdraw:${userId}`,5,86400);
  const id=randomUUID(),reference=`wd_${id.replace(/-/g,'')}`;
  const completed=await withVerifiedOtp(user.phone,'withdrawal',otpCode,async(client)=>{
    await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[userId]);
    const settings=(await client.query<{min_withdrawal_kobo:string;max_daily_withdrawal_kobo:string;withdrawal_fee_kobo:string;new_payout_account_cooldown_hours:number;transfer_fee_tiers:{maxKobo:number|null;feeKobo:number}[]}>(
      'SELECT min_withdrawal_kobo,max_daily_withdrawal_kobo,withdrawal_fee_kobo,new_payout_account_cooldown_hours,transfer_fee_tiers FROM payment_settings WHERE id=true')).rows[0];
    if(settings&&expectedFeeKobo!==undefined&&expectedFeeKobo!==Number(settings.withdrawal_fee_kobo))throw new ApiError(409,'withdrawal_fee_changed');
    if (!settings||amountKobo<Number(settings.min_withdrawal_kobo)) throw new ApiError(400,'withdrawal_below_minimum');
    const payout=(await client.query<{id:string}>(`SELECT id FROM payout_accounts WHERE id=$1 AND user_id=$2 AND is_active=true
      AND created_at <= now()-($3*interval '1 hour') FOR UPDATE`,[payoutAccountId,userId,settings.new_payout_account_cooldown_hours])).rows[0];
    if (!payout) throw new ApiError(404,'payout_account_unavailable');
    const daily=(await client.query<{total:string}>(`SELECT COALESCE(SUM(amount_kobo),0)::text AS total FROM withdrawals
      WHERE user_id=$1 AND status NOT IN ('failed','reversed') AND (requested_at AT TIME ZONE 'Africa/Lagos')::date=(now() AT TIME ZONE 'Africa/Lagos')::date`,[userId])).rows[0];
    if (Number(daily?.total??0)+amountKobo>Number(settings.max_daily_withdrawal_kobo)) throw new ApiError(400,'daily_withdrawal_limit_exceeded');
    const gatewayFee=settings.transfer_fee_tiers.find((tier)=>tier.maxKobo===null||amountKobo<=tier.maxKobo)?.feeKobo??0;
    await client.query("SELECT pg_advisory_xact_lock(hashtext('payout_gateway_capacity'))");
    const float=await client.query<{code:string;balance_kobo:string}>("SELECT code,balance_kobo FROM ledger_accounts WHERE code IN ('gateway_balance','payout_in_transit')");
    const gatewayBalance=Number(float.rows.find((row)=>row.code==='gateway_balance')?.balance_kobo??0);
    const inTransit=Number(float.rows.find((row)=>row.code==='payout_in_transit')?.balance_kobo??0);
    const reservedFees=Number((await client.query<{total:string}>(`SELECT COALESCE(SUM((l.metadata->>'gatewayFeeEstimateKobo')::bigint),0)::text total FROM withdrawals w LEFT JOIN ledger_transactions l ON l.id=w.request_tx_id WHERE w.status IN ('pending','processing')`)).rows[0].total);
    if(![gatewayBalance,inTransit,reservedFees,gatewayFee].every(Number.isSafeInteger))throw new ApiError(409,'payout_capacity_out_of_range');
    if (gatewayBalance-inTransit-reservedFees<amountKobo+gatewayFee) throw new ApiError(409,'payout_funds_unavailable');
    // Ledger assets do not prove the provider's currently available transfer float.
    // Reserving all in-transit amounts again is deliberately conservative when
    // provider deductions are already in flight; statements resolve that timing.
    const providerAvailable=await gateway.getBalance();
    if(!Number.isSafeInteger(providerAvailable)||providerAvailable-inTransit-reservedFees<amountKobo+gatewayFee)throw new ApiError(409,'provider_payout_funds_unavailable');
    const fee=Number(settings.withdrawal_fee_kobo);
    const earnings=await getOrCreateEarningsAccount(client,userId);
    const inserted=(await client.query<{id:string}>(`INSERT INTO withdrawals(id,user_id,payout_account_id,amount_kobo,fee_kobo,provider_reference)
      VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,[id,userId,payout.id,amountKobo,fee,reference])).rows[0];
    const transit=await getSystemAccountId(client,'payout_in_transit');
    const revenue=await getSystemAccountId(client,'revenue_fees');
    const {transactionId}=await postTransaction(client,{type:'withdrawal_request',idempotencyKey:`withdrawal:${id}:request`,referenceType:'withdrawal',referenceId:id,metadata:{gatewayFeeEstimateKobo:gatewayFee,feeBasis:'request_time_capacity_estimate'},
      entries:[{accountId:earnings,direction:'debit',amountKobo:amountKobo+fee},{accountId:transit,direction:'credit',amountKobo},
        ...(fee>0?[{accountId:revenue,direction:'credit' as const,amountKobo:fee}]:[])]});
    const remaining=Number((await client.query<{balance_kobo:string}>('SELECT balance_kobo FROM ledger_accounts WHERE id=$1',[earnings])).rows[0].balance_kobo);
    if (remaining<0) throw new ApiError(402,'insufficient_earnings');
    await client.query('UPDATE withdrawals SET request_tx_id=$2 WHERE id=$1',[inserted.id,transactionId]);
    const result={id,reference,status:'pending'};
    const notification=await createNotificationRecord(client,walletNotification({userId,eventKey:`withdrawal:${id}:requested`,type:'withdrawal_requested',title:'Withdrawal requested',body:`Your ₦${(amountKobo/100).toLocaleString('en-NG',{minimumFractionDigits:2,maximumFractionDigits:2})} payout is being processed.`,referenceId:id}));
    return {result,notification};
  });
  // The committed reservation is recoverable by reconciliation if Redis fails.
  await enqueuePayout(id).catch(()=>console.error('[payments] payout enqueue needs recovery',{withdrawalId:id}));
  emitWalletUpdated(userId);
  await publishNotification(completed.notification).catch((error:unknown)=>console.error('[notifications] withdrawal request publish failed',error instanceof Error?error.message:'unknown'));
  return completed.result;
}

export async function listWithdrawals(userId:string) {
  await approvedDriver(userId);
  const {rows}=await db.query(`SELECT w.id,w.amount_kobo,w.fee_kobo,w.status,w.requested_at,w.completed_at,
    p.bank_name,p.account_last4 FROM withdrawals w JOIN payout_accounts p ON p.id=w.payout_account_id
    WHERE w.user_id=$1 ORDER BY w.requested_at DESC LIMIT 50`,[userId]);
  return {withdrawals:rows.map((row)=>({...row,amount_kobo:Number(row.amount_kobo),fee_kobo:Number(row.fee_kobo)}))};
}
export async function getWithdrawal(userId:string,id:string) {
  const row=(await db.query('SELECT id,amount_kobo,fee_kobo,status,requested_at,completed_at,failure_reason FROM withdrawals WHERE id=$1 AND user_id=$2',[id,userId])).rows[0];
  if (!row) throw new ApiError(404,'withdrawal_not_found');
  return {withdrawal:{...row,amount_kobo:Number(row.amount_kobo),fee_kobo:Number(row.fee_kobo)}};
}

/** Serialize transfer initiation across processes, persisting the attempt before the POST.
 * After any uncertain attempt, only an explicit provider not-found permits another
 * POST, using the identical reference. An outage never means "not initiated".
 */
export async function initiatePayout(id:string) {
  if(paymentMode()==='live'&&!env.ENABLE_LIVE_PAYMENTS)throw new ApiError(503,'live_payments_disabled');
  const lock=await db.connect();
  let acquired=false;
  try {
    acquired=(await lock.query<{locked:boolean}>('SELECT pg_try_advisory_lock(hashtext($1),hashtext($2)) AS locked',['paystack_initiation',id])).rows[0].locked;
    if(!acquired)return;
    const wd=(await lock.query<WithdrawalRow>(`SELECT w.*,p.recipient_code FROM withdrawals w JOIN payout_accounts p ON p.id=w.payout_account_id WHERE w.id=$1`,[id])).rows[0];
    if(!wd||wd.status!=='pending')return;
    if(wd.attempts>0) {
      try {await applyWithdrawalOutcome(wd.provider_reference,lock);return;}
      catch(error) {if(!isTransferNotFound(error))throw error;}
    }
    const claimed=await lock.query("UPDATE withdrawals SET attempts=attempts+1,failure_reason='transfer_initiation_uncertain',updated_at=now() WHERE id=$1 AND status='pending' RETURNING id",[id]);
    if(!claimed.rowCount)return;
    const result=await gateway.initiateTransfer({amountKobo:Number(wd.amount_kobo),recipientCode:wd.recipient_code,reference:wd.provider_reference,reason:`Rakky Ride payout ${id}`});
    // Never trust the initiation response to move ledger money. Provider verification
    // and webhooks may race this update; terminal records must not be overwritten.
    await lock.query("UPDATE withdrawals SET provider_transfer_code=COALESCE(provider_transfer_code,$2),updated_at=now() WHERE id=$1 AND status='pending'",[id,result.transferCode]);
    await applyWithdrawalOutcome(wd.provider_reference,lock);
  } catch(error) {
    if(error instanceof PaystackRequestError&&error.category==='access_denied')await lock.query("UPDATE withdrawals SET failure_reason='provider_transfer_access_denied',updated_at=now() WHERE id=$1 AND status IN ('pending','processing')",[id]);
    console.error('[payments] transfer requires reconciliation',{withdrawalId:id,category:error instanceof ApiError?error.code:'provider_unavailable'});
    throw error;
  } finally {
    try {if(acquired)await lock.query('SELECT pg_advisory_unlock(hashtext($1),hashtext($2))',['paystack_initiation',id]);}
    finally {lock.release();}
  }
}

/** Webhooks are notifications to verify, never authority to mark a payout paid. */
export async function applyWithdrawalOutcome(reference:string,connection?:PoolClient) {
  const work=async(client:PoolClient)=>{
    const wd=(await client.query<WithdrawalRow>(`SELECT w.*,p.recipient_code FROM withdrawals w JOIN payout_accounts p ON p.id=w.payout_account_id WHERE w.provider_reference=$1 FOR UPDATE OF w`,[reference])).rows[0];
    if(!wd)return {applied:false,status:'unknown_reference'};
    // Verify while holding the row lock so competing callbacks cannot apply an
    // older provider observation after a newer one.
    const verified=await gateway.verifyTransfer(reference);
    const amount=Number(wd.amount_kobo),fee=Number(wd.fee_kobo);
    const mismatch=verified.reference!==reference || verified.domain!==paymentMode() || verified.currency!=='NGN' || verified.amountKobo!==amount || verified.recipientCode!==wd.recipient_code || !verified.transferCode || (wd.provider_transfer_code!==null&&wd.provider_transfer_code!==verified.transferCode);
    const exception=async(code:string)=>{
      await client.query('UPDATE withdrawals SET failure_reason=$2,updated_at=now() WHERE id=$1',[wd.id,code]);
      return {applied:false,status:wd.status,exception:code};
    };
    if(mismatch)return exception('transfer_verification_mismatch');
    const outcome=verified.status;
    if(['pending','processing','queued','received','ongoing','otp','blocked'].includes(outcome)) {
      if(['success','failed','reversed'].includes(wd.status))return exception('transfer_terminal_conflict');
      await client.query("UPDATE withdrawals SET status='processing',provider_transfer_code=$2,failure_reason=$3,updated_at=now() WHERE id=$1",[wd.id,verified.transferCode,['otp','blocked'].includes(outcome)?`provider_transfer_${outcome}`:null]);
      return {applied:false,status:'processing'};
    }
    if(!['success','failed','reversed'].includes(outcome))return exception('transfer_status_unrecognized');
    if(wd.status===outcome)return {applied:false,status:outcome};
    if(wd.status==='failed'||wd.status==='reversed'||(wd.status==='success'&&outcome==='failed'))return exception('transfer_terminal_conflict');
    if(outcome==='success'&&(!Number.isSafeInteger(verified.feeKobo)||Number(verified.feeKobo)<0))return exception('transfer_fee_evidence_missing');
    const transit=await getSystemAccountId(client,'payout_in_transit');
    const gatewayAccount=await getSystemAccountId(client,'gateway_balance');
    let transactionId:string;
    if(outcome==='success') {
      ({transactionId}=await postTransaction(client,{type:'withdrawal_success',idempotencyKey:`withdrawal:${wd.id}:success`,referenceType:'withdrawal',referenceId:wd.id,
        metadata:{providerReference:reference,transferCode:verified.transferCode,providerDomain:verified.domain,feeKobo:verified.feeKobo},
        entries:[{accountId:transit,direction:'debit',amountKobo:amount},{accountId:gatewayAccount,direction:'credit',amountKobo:amount}]}));
      if(Number(verified.feeKobo)>0)await postTransaction(client,{type:'withdrawal_fee_expense',idempotencyKey:`withdrawal:${wd.id}:gateway_fee`,referenceType:'withdrawal',referenceId:wd.id,
        metadata:{feeBasis:'provider_verified',providerReference:reference},
        entries:[{accountId:await getSystemAccountId(client,'expense_gateway_fees'),direction:'debit',amountKobo:verified.feeKobo!},{accountId:gatewayAccount,direction:'credit',amountKobo:verified.feeKobo!}]});
    } else {
      // A driver's later suspension must not prevent return of reserved funds.
      const earnings=(await client.query<{id:string}>("SELECT id FROM ledger_accounts WHERE owner_user_id=$1 AND kind='driver_earnings'",[wd.user_id])).rows[0]?.id;
      if(!earnings)throw new ApiError(409,'withdrawal_earnings_evidence_missing');
      const source=wd.status==='success'?gatewayAccount:transit;
      const revenue=await getSystemAccountId(client,'revenue_fees');
      ({transactionId}=await postTransaction(client,{type:'withdrawal_reversal',idempotencyKey:`withdrawal:${wd.id}:reversal`,referenceType:'withdrawal',referenceId:wd.id,
        metadata:{providerReference:reference,transferCode:verified.transferCode,providerDomain:verified.domain},
        entries:[{accountId:source,direction:'debit',amountKobo:amount},...(fee>0?[{accountId:revenue,direction:'debit' as const,amountKobo:fee}]:[]),{accountId:earnings,direction:'credit',amountKobo:amount+fee}]}));
      // Provider fee refunds require their own statement evidence; do not invent one.
    }
    await client.query('UPDATE withdrawals SET status=$2,final_tx_id=$3,provider_transfer_code=$4,failure_reason=NULL,completed_at=now(),updated_at=now() WHERE id=$1',[wd.id,outcome,transactionId,verified.transferCode]);
    const successful=outcome==='success';
    const notification=await createNotificationRecord(client,walletNotification({userId:wd.user_id,eventKey:`withdrawal:${wd.id}:${outcome}`,type:successful?'withdrawal_succeeded':'withdrawal_failed',title:successful?'Withdrawal completed':'Withdrawal returned',body:successful?`₦${(amount/100).toLocaleString('en-NG',{minimumFractionDigits:2,maximumFractionDigits:2})} was sent to your payout account.`:'The payout could not be completed. Your reserved amount has been returned to earnings.',referenceId:wd.id,priority:successful?'normal':'high'}));
    return {applied:true,status:outcome,userId:wd.user_id,notification};
  };
  const onConnection=async(client:PoolClient)=>{
    await client.query('BEGIN');
    try{const value=await work(client);await client.query('COMMIT');return value;}
    catch(error){await client.query('ROLLBACK');throw error;}
  };
  // Initiation already owns a session advisory lock: reuse its connection rather
  // than consume a second pool slot and deadlock under concurrent payouts.
  const result=connection?await onConnection(connection):await inTransaction(work);
  if(result.applied&&'userId' in result&&result.userId){
    emitWalletUpdated(result.userId);
    if('notification' in result&&result.notification)await publishNotification(result.notification).catch((error:unknown)=>console.error('[notifications] withdrawal outcome publish failed',error instanceof Error?error.message:'unknown'));
  }
  if('exception' in result)throw new ApiError(409,result.exception);
  return result;
}
