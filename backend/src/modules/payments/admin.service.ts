import { createHash } from 'node:crypto';
import { db, inTransaction } from '../../shared/config/db';
import { ApiError } from '../../shared/errors';
import { getOrCreateEarningsAccount, getOrCreateWalletAccount, getSystemAccountId, postTransaction } from './ledger.service';
import { replayAdminOperation, recordAdminRead } from '../../shared/utils/adminAudit';
import { adminId } from '../../shared/utils/adminQuery';
import { emitWalletUpdated } from '../../websocket/notifications';
import { createNotificationRecord, publishNotification } from '../notifications/notifications.service';
import { walletNotification } from '../notifications/notificationTemplates';

const uuid=(value:unknown)=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
function checkAudit(reason:unknown,requestKey:unknown,amountKobo?:number) {
  if (typeof reason!=='string'||reason.trim().length<5||!uuid(requestKey)) throw new ApiError(400,'reason_and_request_key_required');
  if (amountKobo!==undefined&&(!Number.isSafeInteger(amountKobo)||amountKobo<=0)) throw new ApiError(400,'invalid_amount');
}
export async function refundTrip(actorId:string,input:{tripId:string;amountKobo:number;reason:string;requestKey:string}) {
  checkAudit(input.reason,input.requestKey,input.amountKobo);
  const completed=await inTransaction(async(client)=>{
    adminId(input.tripId);
    const operation=await replayAdminOperation(client,actorId,'refund',input.requestKey,{tripId:input.tripId,amountKobo:input.amountKobo,reason:input.reason});
    if(operation.previous)return {result:{transactionId:operation.previous.transactionId},notification:null,userId:null};
    const trip=(await client.query<{id:string;rider_id:string;fare_kobo:string;status:string;payment_status:string;settle_tx_id:string|null;payment_method:string}>('SELECT id,rider_id,fare_kobo,status,payment_status,settle_tx_id,payment_method FROM trips WHERE id=$1 FOR UPDATE',[input.tripId])).rows[0];
    if (!trip||trip.status!=='completed') throw new ApiError(409,'trip_not_completed');
    const evidence = await client.query(`SELECT id FROM ledger_transactions WHERE id=$1 AND reference_type='trip' AND reference_id=$2 AND type=$3`,[trip.settle_tx_id,trip.id,trip.payment_method==='wallet'?'trip_settlement_wallet':'trip_commission_cash']);
    if (trip.payment_status!=='settled' || !evidence.rowCount) throw new ApiError(409,'trip_settlement_evidence_required');
    if (input.amountKobo>Number(trip.fare_kobo)) throw new ApiError(400,'refund_exceeds_fare');
    const idempotencyKey = `refund:${trip.id}:${actorId}:${input.requestKey}`;
    const previous = await client.query('SELECT id FROM ledger_transactions WHERE idempotency_key=$1', [idempotencyKey]);
    // The trip lock serializes refunds. Exact retries still go through the ledger's
    // hash check, even when earlier refunds have exhausted the refundable amount.
    if (!previous.rowCount) {
      const refunded = (await client.query<{ total: string }>(
        `SELECT COALESCE(SUM(e.amount_kobo),0)::text AS total
         FROM ledger_transactions t JOIN ledger_entries e ON e.transaction_id=t.id
         WHERE t.type='refund' AND t.reference_type='trip' AND t.reference_id=$1 AND e.direction='credit'`,
        [trip.id],
      )).rows[0];
      if (BigInt(refunded.total) + BigInt(input.amountKobo) > BigInt(trip.fare_kobo)) {
        throw new ApiError(400, 'refund_exceeds_remaining_fare');
      }
    }
    const account=await getOrCreateWalletAccount(client,trip.rider_id);
    const expense=await getSystemAccountId(client,'expense_refunds');
    const {transactionId,replayed}=await postTransaction(client,{type:'refund',idempotencyKey,referenceType:'trip',referenceId:trip.id,createdBy:actorId,description:input.reason,
      entries:[{accountId:expense,direction:'debit',amountKobo:input.amountKobo},{accountId:account,direction:'credit',amountKobo:input.amountKobo}]});
    if (!replayed) await client.query('INSERT INTO admin_audit_log(actor_id,action,target_user_id,request_key,reason,ledger_transaction_id,metadata) VALUES($1,$2,$3,$4,$5,$6,$7)',[actorId,'refund',trip.rider_id,input.requestKey,input.reason,transactionId,{operationHash:operation.hash}]);
    const notification=replayed?null:await createNotificationRecord(client,walletNotification({userId:trip.rider_id,eventKey:`refund:${transactionId}:posted`,type:'refund_posted',title:'Refund added to your wallet',body:`₦${(input.amountKobo/100).toLocaleString('en-NG',{minimumFractionDigits:2,maximumFractionDigits:2})} has been returned to your Rakky Ride wallet.`,referenceId:trip.id}));
    return {result:{transactionId},notification,userId:trip.rider_id};
  });
  if(completed.userId){emitWalletUpdated(completed.userId);if(completed.notification)await publishNotification(completed.notification).catch((error:unknown)=>console.error('[notifications] refund publish failed',error instanceof Error?error.message:'unknown'));}
  return completed.result;
}
export async function adjustBalance(actorId:string,actorRole:string,input:{userId:string;account:'wallet'|'earnings';direction:'credit'|'debit';amountKobo:number;reason:string;requestKey:string}) {
  checkAudit(input.reason,input.requestKey,input.amountKobo);
  if (!['wallet','earnings'].includes(input.account)||!['credit','debit'].includes(input.direction)) throw new ApiError(400,'invalid_adjustment');
  const result=await inTransaction(async(client)=>{
    adminId(input.userId);
    const operation=await replayAdminOperation(client,actorId,'adjustment',input.requestKey,{userId:input.userId,account:input.account,direction:input.direction,amountKobo:input.amountKobo,reason:input.reason});
    if(operation.previous)return {transactionId:operation.previous.transactionId};
    const threshold=Number((await client.query<{admin_adjustment_approval_kobo:string}>('SELECT admin_adjustment_approval_kobo FROM payment_settings WHERE id=true')).rows[0]?.admin_adjustment_approval_kobo??0);
    if (input.amountKobo>threshold&&operation.role!=='super_admin') throw new ApiError(403,'super_admin_required');
    const account=input.account==='wallet'?await getOrCreateWalletAccount(client,input.userId):await getOrCreateEarningsAccount(client,input.userId);
    const expense=await getSystemAccountId(client,'expense_adjustments');
    const {transactionId}=await postTransaction(client,{type:'adjustment',idempotencyKey:`adjustment:${actorId}:${input.requestKey}`,referenceType:'admin',referenceId:input.userId,createdBy:actorId,description:input.reason,
      entries:input.direction==='credit'?[{accountId:expense,direction:'debit',amountKobo:input.amountKobo},{accountId:account,direction:'credit',amountKobo:input.amountKobo}]
        :[{accountId:account,direction:'debit',amountKobo:input.amountKobo},{accountId:expense,direction:'credit',amountKobo:input.amountKobo}]});
    await client.query('INSERT INTO admin_audit_log(actor_id,action,target_user_id,request_key,reason,ledger_transaction_id,metadata) VALUES($1,$2,$3,$4,$5,$6,$7)',[actorId,'adjustment',input.userId,input.requestKey,input.reason,transactionId,{operationHash:operation.hash}]);
    return {transactionId};
  });
  emitWalletUpdated(input.userId);
  return result;
}
export async function freezeAccount(actorId:string,userId:string,kind:'wallet'|'earnings',frozen:boolean,reason:string,requestKey:string) {
  checkAudit(reason,requestKey);
  if (kind!=='wallet'&&kind!=='earnings'||typeof frozen!=='boolean') throw new ApiError(400,'invalid_freeze_request');
  return inTransaction(async(client)=>{
    adminId(userId);
    const action=frozen?'freeze':'unfreeze';
    const operation=await replayAdminOperation(client,actorId,action,requestKey,{userId,kind,frozen,reason});
    if(operation.previous)return {success:true,auditId:operation.previous.id,replayed:true};
    const account=kind==='wallet'?await getOrCreateWalletAccount(client,userId):await getOrCreateEarningsAccount(client,userId);
    await client.query('UPDATE ledger_accounts SET is_frozen=$2,updated_at=now() WHERE id=$1',[account,frozen]);
    const audit=(await client.query<{id:string}>('INSERT INTO admin_audit_log(actor_id,action,target_user_id,request_key,reason,metadata) VALUES($1,$2,$3,$4,$5,$6) RETURNING id::text',[actorId,frozen?'freeze':'unfreeze',userId,requestKey,reason,{account:kind,operationHash:operation.hash}])).rows[0];
    return {success:true,auditId:audit.id};
  });
}
export async function sweepGateway(actorId:string,amountKobo:number,reason:string,requestKey:string) {
  checkAudit(reason,requestKey,amountKobo);
  return inTransaction(async(client)=>{
    const operation=await replayAdminOperation(client,actorId,'gateway_sweep',requestKey,{amountKobo,reason},['super_admin']);
    if(operation.previous)return {transactionId:operation.previous.transactionId};
    const gateway=await getSystemAccountId(client,'gateway_balance');
    const bank=await getSystemAccountId(client,'bank_account');
    const {transactionId}=await postTransaction(client,{type:'gateway_sweep',idempotencyKey:`sweep:${actorId}:${requestKey}`,referenceType:'admin',createdBy:actorId,description:reason,
      entries:[{accountId:bank,direction:'debit',amountKobo},{accountId:gateway,direction:'credit',amountKobo}]});
    await client.query('INSERT INTO admin_audit_log(actor_id,action,request_key,reason,ledger_transaction_id,metadata) VALUES($1,$2,$3,$4,$5,$6)',[actorId,'gateway_sweep',requestKey,reason,transactionId,{operationHash:operation.hash}]);
    return {transactionId};
  });
}
export async function inspectUser(actorId:string,userId:string) {
  adminId(userId);
  const {getBalances}=await import('./ledger.service.js');
  const [balances,entries,intents,withdrawals]=await Promise.all([
    getBalances(userId),
    db.query('SELECT e.id,e.direction,e.amount_kobo,e.balance_after_kobo,t.type,t.created_at FROM ledger_entries e JOIN ledger_accounts a ON a.id=e.account_id JOIN ledger_transactions t ON t.id=e.transaction_id WHERE a.owner_user_id=$1 ORDER BY e.id DESC LIMIT 100',[userId]),
    db.query('SELECT id,target,amount_kobo,status,created_at FROM payment_intents WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50',[userId]),
    db.query('SELECT id,amount_kobo,status,requested_at FROM withdrawals WHERE user_id=$1 ORDER BY requested_at DESC LIMIT 50',[userId]),
  ]);
  await recordAdminRead(actorId, 'financial_user_inspection', 'user', userId);
  return {balances,entries:entries.rows,intents:intents.rows,withdrawals:withdrawals.rows};
}
const settingsVersion=(row:object)=>createHash('sha256').update(JSON.stringify(row)).digest('hex');
export async function getPaymentSettings() {
  const row=(await db.query('SELECT * FROM payment_settings WHERE id=true')).rows[0];
  return row?{...row,version:settingsVersion(row)}:null;
}
export async function updatePaymentSettings(actorId:string,input:Record<string,unknown>) {
  checkAudit(input.reason,input.requestKey);
  const fields=['minTopupKobo','maxTopupKobo','minWithdrawalKobo','maxDailyWithdrawalKobo','withdrawalFeeKobo','cashDebtLimitKobo','newPayoutAccountCooldownHours','paystackBalanceAlertKobo','adminAdjustmentApprovalKobo'] as const;
  for (const field of fields) if (input[field]!==undefined&&(!Number.isSafeInteger(input[field])||Number(input[field])<0)) throw new ApiError(400,'invalid_payment_setting');
  if (input.payoutNameMatch!==undefined&&!['strict','lenient','off'].includes(String(input.payoutNameMatch))) throw new ApiError(400,'invalid_payment_setting');
  for(const key of Object.keys(input))if(![...fields,'payoutNameMatch','transferFeeTiers','reason','requestKey','expectedVersion'].includes(key as typeof fields[number]))throw new ApiError(400,'unsupported_payment_setting');
  if(typeof input.expectedVersion!=='string'||!/^[0-9a-f]{64}$/.test(input.expectedVersion))throw new ApiError(400,'expected_settings_version_required');
  if(input.newPayoutAccountCooldownHours!==undefined&&Number(input.newPayoutAccountCooldownHours)>2147483647)throw new ApiError(400,'invalid_payment_setting');
  const tiers=input.transferFeeTiers;
  if(tiers!==undefined){
    if(!Array.isArray(tiers)||!tiers.length||tiers.length>50)throw new ApiError(400,'invalid_payment_setting');
    let previous=0;
    for(const [index,tier] of tiers.entries()){
      if(!tier||typeof tier!=='object'||Array.isArray(tier))throw new ApiError(400,'invalid_payment_setting');
      const item=tier as {maxKobo:unknown;feeKobo:unknown};
      if(!Number.isSafeInteger(item.feeKobo)||Number(item.feeKobo)<0||Object.keys(item).some(k=>!['maxKobo','feeKobo'].includes(k)))throw new ApiError(400,'invalid_payment_setting');
      if(index===tiers.length-1){if(item.maxKobo!==null)throw new ApiError(400,'unbounded_final_fee_tier_required');}
      else {if(!Number.isSafeInteger(item.maxKobo)||Number(item.maxKobo)<=previous)throw new ApiError(400,'fee_tiers_must_increase');previous=Number(item.maxKobo);}
    }
  }
  return inTransaction(async(client)=>{
    const supplied=Object.fromEntries([...fields,'payoutNameMatch','transferFeeTiers'].filter(field=>input[field]!==undefined).map(field=>[field,input[field]]));
    const operation=await replayAdminOperation(client,actorId,'settings_update',String(input.requestKey),{...supplied,reason:input.reason,expectedVersion:input.expectedVersion},['super_admin']);
    if(operation.previous){const row=(await client.query('SELECT * FROM payment_settings WHERE id=true')).rows[0];return {...row,version:settingsVersion(row),auditId:operation.previous.id};}
    await client.query('SELECT id FROM payment_settings WHERE id=true FOR UPDATE');
    const before=(await client.query('SELECT * FROM payment_settings WHERE id=true')).rows[0];
    if(settingsVersion(before)!==input.expectedVersion)throw new ApiError(409,'payment_settings_changed');
    const updated=(await client.query(`UPDATE payment_settings SET
      min_topup_kobo=COALESCE($1,min_topup_kobo),max_topup_kobo=COALESCE($2,max_topup_kobo),
      min_withdrawal_kobo=COALESCE($3,min_withdrawal_kobo),max_daily_withdrawal_kobo=COALESCE($4,max_daily_withdrawal_kobo),
      withdrawal_fee_kobo=COALESCE($5,withdrawal_fee_kobo),cash_debt_limit_kobo=COALESCE($6,cash_debt_limit_kobo),
      new_payout_account_cooldown_hours=COALESCE($7,new_payout_account_cooldown_hours),
      paystack_balance_alert_kobo=COALESCE($8,paystack_balance_alert_kobo),
      admin_adjustment_approval_kobo=COALESCE($9,admin_adjustment_approval_kobo),
      payout_name_match=COALESCE($10,payout_name_match),transfer_fee_tiers=COALESCE($11::jsonb,transfer_fee_tiers)
      WHERE id=true RETURNING *`,[...fields.map((field)=>input[field]??null),input.payoutNameMatch??null,tiers===undefined?null:JSON.stringify(tiers)])).rows[0];
    if (Number(updated.min_topup_kobo)>Number(updated.max_topup_kobo)||Number(updated.min_withdrawal_kobo)>Number(updated.max_daily_withdrawal_kobo)) throw new ApiError(400,'invalid_payment_limits');
    const audit=(await client.query<{id:string}>('INSERT INTO admin_audit_log(actor_id,action,request_key,reason,metadata) VALUES($1,$2,$3,$4,$5) RETURNING id::text',[actorId,'settings_update',input.requestKey,input.reason,{operationHash:operation.hash,before,after:updated}])).rows[0];
    return {...updated,version:settingsVersion(updated),auditId:audit.id};
  });
}
