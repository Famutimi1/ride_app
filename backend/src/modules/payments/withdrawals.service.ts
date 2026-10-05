import { randomUUID } from 'node:crypto';
import { db, inTransaction } from '../../shared/config/db';
import { ApiError } from '../../shared/errors';
import { verifyOtp } from '../auth/otp.service';
import { gateway } from './gateway';
import { getOrCreateEarningsAccount, getSystemAccountId, postTransaction } from './ledger.service';
import { approvedDriver, rateLimit } from './payoutAccounts.service';
import { enqueuePayout } from './paymentQueue';
import { emitWalletUpdated } from '../../websocket/notifications';

interface WithdrawalRow {id:string;user_id:string;amount_kobo:string;fee_kobo:string;status:string;provider_reference:string;provider_transfer_code:string|null;recipient_code:string}
export async function requestWithdrawal(userId:string,payoutAccountId:string,amountKobo:number,otpCode:string) {
  const user=await approvedDriver(userId);
  if (!user.phone||!Number.isSafeInteger(amountKobo)||amountKobo<=0) throw new ApiError(400,'invalid_withdrawal');
  await rateLimit(`payments:withdraw:${userId}`,5,86400);
  const id=randomUUID(),reference=`wd_${id.replace(/-/g,'')}`;
  const result=await inTransaction(async(client)=>{
    await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[userId]);
    const settings=(await client.query<{min_withdrawal_kobo:string;max_daily_withdrawal_kobo:string;withdrawal_fee_kobo:string;new_payout_account_cooldown_hours:number;transfer_fee_tiers:{maxKobo:number|null;feeKobo:number}[]}>(
      'SELECT min_withdrawal_kobo,max_daily_withdrawal_kobo,withdrawal_fee_kobo,new_payout_account_cooldown_hours,transfer_fee_tiers FROM payment_settings WHERE id=true')).rows[0];
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
    if (gatewayBalance-inTransit<amountKobo+gatewayFee) throw new ApiError(409,'payout_funds_unavailable');
    await verifyOtp(user.phone!,'withdrawal',otpCode,client);
    const fee=Number(settings.withdrawal_fee_kobo);
    const earnings=await getOrCreateEarningsAccount(client,userId);
    const inserted=(await client.query<{id:string}>(`INSERT INTO withdrawals(id,user_id,payout_account_id,amount_kobo,fee_kobo,provider_reference)
      VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,[id,userId,payout.id,amountKobo,fee,reference])).rows[0];
    const transit=await getSystemAccountId(client,'payout_in_transit');
    const revenue=await getSystemAccountId(client,'revenue_fees');
    const {transactionId}=await postTransaction(client,{type:'withdrawal_request',idempotencyKey:`withdrawal:${id}:request`,referenceType:'withdrawal',referenceId:id,
      entries:[{accountId:earnings,direction:'debit',amountKobo:amountKobo+fee},{accountId:transit,direction:'credit',amountKobo},
        ...(fee>0?[{accountId:revenue,direction:'credit' as const,amountKobo:fee}]:[])]});
    const remaining=Number((await client.query<{balance_kobo:string}>('SELECT balance_kobo FROM ledger_accounts WHERE id=$1',[earnings])).rows[0].balance_kobo);
    if (remaining<0) throw new ApiError(402,'insufficient_earnings');
    await client.query('UPDATE withdrawals SET request_tx_id=$2 WHERE id=$1',[inserted.id,transactionId]);
    return {id,reference,status:'pending'};
  });
  await enqueuePayout(id);
  emitWalletUpdated(userId);
  return result;
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

export async function initiatePayout(id:string) {
  const wd=(await db.query<WithdrawalRow>(`SELECT w.*,p.recipient_code FROM withdrawals w JOIN payout_accounts p ON p.id=w.payout_account_id WHERE w.id=$1`,[id])).rows[0];
  if (!wd||wd.status!=='pending') return;
  let result;
  try { result=await gateway.initiateTransfer({amountKobo:Number(wd.amount_kobo),recipientCode:wd.recipient_code,reference:wd.provider_reference,reason:`Rakky Ride payout ${id}`}); }
  catch(error) {
    await db.query('UPDATE withdrawals SET attempts=attempts+1,updated_at=now() WHERE id=$1',[id]);
    console.error('[payments] transfer initiation needs reconciliation',{withdrawalId:id,error:error instanceof Error?error.message:'unknown'});
    return;
  }
  if (result.status==='otp') {
    console.error('[payments] Paystack transfer OTP is enabled; disable it for API payouts',{withdrawalId:id});
    return;
  }
  await db.query("UPDATE withdrawals SET status='processing',provider_transfer_code=$2,attempts=attempts+1,updated_at=now() WHERE id=$1 AND status='pending'",[id,result.transferCode]);
  if (result.status==='success') await applyWithdrawalOutcome(wd.provider_reference,'success');
  else if (['failed','reversed'].includes(result.status)) await applyWithdrawalOutcome(wd.provider_reference,result.status);
}

async function transferFee(amountKobo:number):Promise<number> {
  const settings=(await db.query<{transfer_fee_tiers:Array<{maxKobo:number|null;feeKobo:number}>}>('SELECT transfer_fee_tiers FROM payment_settings WHERE id=true')).rows[0];
  return settings?.transfer_fee_tiers.find((tier)=>tier.maxKobo===null||amountKobo<=tier.maxKobo)?.feeKobo??0;
}
export async function applyWithdrawalOutcome(reference:string,outcome:string) {
  if (!['success','failed','reversed'].includes(outcome)) return;
  const feeEstimate=outcome==='success'?await transferFee(Number((await db.query<{amount_kobo:string}>('SELECT amount_kobo FROM withdrawals WHERE provider_reference=$1',[reference])).rows[0]?.amount_kobo??0)):0;
  const owner=(await db.query<{user_id:string}>('SELECT user_id FROM withdrawals WHERE provider_reference=$1',[reference])).rows[0];
  const result=await inTransaction(async(client)=>{
    const wd=(await client.query<WithdrawalRow>('SELECT * FROM withdrawals WHERE provider_reference=$1 FOR UPDATE',[reference])).rows[0];
    if (!wd || ['failed','reversed'].includes(wd.status) || (wd.status==='success'&&outcome==='success')) return;
    const amount=Number(wd.amount_kobo),fee=Number(wd.fee_kobo);
    const transit=await getSystemAccountId(client,'payout_in_transit');
    const gatewayAccount=await getSystemAccountId(client,'gateway_balance');
    const earnings=await getOrCreateEarningsAccount(client,wd.user_id);
    let transactionId:string;
    if (outcome==='success') {
      ({transactionId}=await postTransaction(client,{type:'withdrawal_success',idempotencyKey:`withdrawal:${wd.id}:success`,referenceType:'withdrawal',referenceId:wd.id,
        entries:[{accountId:transit,direction:'debit',amountKobo:amount},{accountId:gatewayAccount,direction:'credit',amountKobo:amount}]}));
      if (feeEstimate>0) await postTransaction(client,{type:'withdrawal_fee_expense',idempotencyKey:`withdrawal:${wd.id}:gateway_fee`,referenceType:'withdrawal',referenceId:wd.id,
        entries:[{accountId:await getSystemAccountId(client,'expense_gateway_fees'),direction:'debit',amountKobo:feeEstimate},
          {accountId:gatewayAccount,direction:'credit',amountKobo:feeEstimate}]});
    } else {
      const source=wd.status==='success'?gatewayAccount:transit;
      const revenue=await getSystemAccountId(client,'revenue_fees');
      ({transactionId}=await postTransaction(client,{type:'withdrawal_reversal',idempotencyKey:`withdrawal:${wd.id}:reversal`,referenceType:'withdrawal',referenceId:wd.id,
        entries:[{accountId:source,direction:'debit',amountKobo:amount},
          ...(fee>0?[{accountId:revenue,direction:'debit' as const,amountKobo:fee}]:[]),
          {accountId:earnings,direction:'credit',amountKobo:amount+fee}]}));
    }
    await client.query('UPDATE withdrawals SET status=$2,final_tx_id=$3,completed_at=now(),updated_at=now() WHERE id=$1',[wd.id,outcome==='success'?'success':outcome,transactionId]);
  });
  if (owner) emitWalletUpdated(owner.user_id);
  return result;
}
