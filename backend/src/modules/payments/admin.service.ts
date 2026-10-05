import { db, inTransaction } from '../../shared/config/db';
import { ApiError } from '../../shared/errors';
import { getOrCreateEarningsAccount, getOrCreateWalletAccount, getSystemAccountId, postTransaction } from './ledger.service';
import { emitWalletUpdated } from '../../websocket/notifications';

const uuid=(value:unknown)=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
function checkAudit(reason:unknown,requestKey:unknown,amountKobo?:number) {
  if (typeof reason!=='string'||reason.trim().length<5||!uuid(requestKey)) throw new ApiError(400,'reason_and_request_key_required');
  if (amountKobo!==undefined&&(!Number.isSafeInteger(amountKobo)||amountKobo<=0)) throw new ApiError(400,'invalid_amount');
}
export async function refundTrip(actorId:string,input:{tripId:string;amountKobo:number;reason:string;requestKey:string}) {
  checkAudit(input.reason,input.requestKey,input.amountKobo);
  const result=await inTransaction(async(client)=>{
    const trip=(await client.query<{id:string;rider_id:string;fare_kobo:string;status:string}>('SELECT id,rider_id,fare_kobo,status FROM trips WHERE id=$1 FOR UPDATE',[input.tripId])).rows[0];
    if (!trip||trip.status!=='completed') throw new ApiError(409,'trip_not_completed');
    if (input.amountKobo>Number(trip.fare_kobo)) throw new ApiError(400,'refund_exceeds_fare');
    const account=await getOrCreateWalletAccount(client,trip.rider_id);
    const expense=await getSystemAccountId(client,'expense_refunds');
    const {transactionId}=await postTransaction(client,{type:'refund',idempotencyKey:`refund:${trip.id}:${input.requestKey}`,referenceType:'trip',referenceId:trip.id,createdBy:actorId,description:input.reason,
      entries:[{accountId:expense,direction:'debit',amountKobo:input.amountKobo},{accountId:account,direction:'credit',amountKobo:input.amountKobo}]});
    await client.query('INSERT INTO admin_audit_log(actor_id,action,target_user_id,request_key,reason,ledger_transaction_id) VALUES($1,$2,$3,$4,$5,$6)',[actorId,'refund',trip.rider_id,input.requestKey,input.reason,transactionId]);
    return {transactionId};
  });
  const user=(await db.query<{rider_id:string}>('SELECT rider_id FROM trips WHERE id=$1',[input.tripId])).rows[0];
  if (user) emitWalletUpdated(user.rider_id);
  return result;
}
export async function adjustBalance(actorId:string,actorRole:string,input:{userId:string;account:'wallet'|'earnings';direction:'credit'|'debit';amountKobo:number;reason:string;requestKey:string}) {
  checkAudit(input.reason,input.requestKey,input.amountKobo);
  if (!['wallet','earnings'].includes(input.account)||!['credit','debit'].includes(input.direction)) throw new ApiError(400,'invalid_adjustment');
  const result=await inTransaction(async(client)=>{
    const threshold=Number((await client.query<{admin_adjustment_approval_kobo:string}>('SELECT admin_adjustment_approval_kobo FROM payment_settings WHERE id=true')).rows[0]?.admin_adjustment_approval_kobo??0);
    if (input.amountKobo>threshold&&actorRole!=='super_admin') throw new ApiError(403,'super_admin_required');
    const account=input.account==='wallet'?await getOrCreateWalletAccount(client,input.userId):await getOrCreateEarningsAccount(client,input.userId);
    const expense=await getSystemAccountId(client,'expense_adjustments');
    const {transactionId}=await postTransaction(client,{type:'adjustment',idempotencyKey:`adjustment:${input.requestKey}`,referenceType:'admin',referenceId:input.userId,createdBy:actorId,description:input.reason,
      entries:input.direction==='credit'?[{accountId:expense,direction:'debit',amountKobo:input.amountKobo},{accountId:account,direction:'credit',amountKobo:input.amountKobo}]
        :[{accountId:account,direction:'debit',amountKobo:input.amountKobo},{accountId:expense,direction:'credit',amountKobo:input.amountKobo}]});
    await client.query('INSERT INTO admin_audit_log(actor_id,action,target_user_id,request_key,reason,ledger_transaction_id) VALUES($1,$2,$3,$4,$5,$6)',[actorId,'adjustment',input.userId,input.requestKey,input.reason,transactionId]);
    return {transactionId};
  });
  emitWalletUpdated(input.userId);
  return result;
}
export async function freezeAccount(actorId:string,userId:string,kind:'wallet'|'earnings',frozen:boolean,reason:string,requestKey:string) {
  checkAudit(reason,requestKey);
  if (kind!=='wallet'&&kind!=='earnings'||typeof frozen!=='boolean') throw new ApiError(400,'invalid_freeze_request');
  return inTransaction(async(client)=>{
    const account=kind==='wallet'?await getOrCreateWalletAccount(client,userId):await getOrCreateEarningsAccount(client,userId);
    await client.query('UPDATE ledger_accounts SET is_frozen=$2,updated_at=now() WHERE id=$1',[account,frozen]);
    await client.query('INSERT INTO admin_audit_log(actor_id,action,target_user_id,request_key,reason,metadata) VALUES($1,$2,$3,$4,$5,$6)',[actorId,frozen?'freeze':'unfreeze',userId,requestKey,reason,{account:kind}]);
    return {success:true};
  });
}
export async function sweepGateway(actorId:string,amountKobo:number,reason:string,requestKey:string) {
  checkAudit(reason,requestKey,amountKobo);
  return inTransaction(async(client)=>{
    const gateway=await getSystemAccountId(client,'gateway_balance');
    const bank=await getSystemAccountId(client,'bank_account');
    const {transactionId}=await postTransaction(client,{type:'gateway_sweep',idempotencyKey:`sweep:${requestKey}`,referenceType:'admin',createdBy:actorId,description:reason,
      entries:[{accountId:bank,direction:'debit',amountKobo},{accountId:gateway,direction:'credit',amountKobo}]});
    await client.query('INSERT INTO admin_audit_log(actor_id,action,request_key,reason,ledger_transaction_id) VALUES($1,$2,$3,$4,$5)',[actorId,'gateway_sweep',requestKey,reason,transactionId]);
    return {transactionId};
  });
}
export async function inspectUser(userId:string) {
  const {getBalances}=await import('./ledger.service.js');
  const [balances,entries,intents,withdrawals]=await Promise.all([
    getBalances(userId),
    db.query('SELECT e.id,e.direction,e.amount_kobo,e.balance_after_kobo,t.type,t.created_at FROM ledger_entries e JOIN ledger_accounts a ON a.id=e.account_id JOIN ledger_transactions t ON t.id=e.transaction_id WHERE a.owner_user_id=$1 ORDER BY e.id DESC LIMIT 100',[userId]),
    db.query('SELECT id,target,amount_kobo,status,created_at FROM payment_intents WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50',[userId]),
    db.query('SELECT id,amount_kobo,status,requested_at FROM withdrawals WHERE user_id=$1 ORDER BY requested_at DESC LIMIT 50',[userId]),
  ]);
  return {balances,entries:entries.rows,intents:intents.rows,withdrawals:withdrawals.rows};
}
export async function getPaymentSettings() {
  return (await db.query('SELECT * FROM payment_settings WHERE id=true')).rows[0];
}
export async function updatePaymentSettings(actorId:string,input:Record<string,unknown>) {
  checkAudit(input.reason,input.requestKey);
  const fields=['minTopupKobo','maxTopupKobo','minWithdrawalKobo','maxDailyWithdrawalKobo','withdrawalFeeKobo','cashDebtLimitKobo','newPayoutAccountCooldownHours','paystackBalanceAlertKobo','adminAdjustmentApprovalKobo'] as const;
  for (const field of fields) if (input[field]!==undefined&&(!Number.isSafeInteger(input[field])||Number(input[field])<0)) throw new ApiError(400,'invalid_payment_setting');
  if (input.payoutNameMatch!==undefined&&!['strict','lenient','off'].includes(String(input.payoutNameMatch))) throw new ApiError(400,'invalid_payment_setting');
  const tiers=input.transferFeeTiers;
  if (tiers!==undefined&&(!Array.isArray(tiers)||!tiers.length||tiers.some((tier:unknown)=>{const item=tier as {maxKobo:unknown;feeKobo:unknown};return (item.maxKobo!==null&&!Number.isSafeInteger(item.maxKobo))||!Number.isSafeInteger(item.feeKobo)||Number(item.feeKobo)<0;}))) throw new ApiError(400,'invalid_payment_setting');
  return inTransaction(async(client)=>{
    const updated=(await client.query(`UPDATE payment_settings SET
      min_topup_kobo=COALESCE($1,min_topup_kobo),max_topup_kobo=COALESCE($2,max_topup_kobo),
      min_withdrawal_kobo=COALESCE($3,min_withdrawal_kobo),max_daily_withdrawal_kobo=COALESCE($4,max_daily_withdrawal_kobo),
      withdrawal_fee_kobo=COALESCE($5,withdrawal_fee_kobo),cash_debt_limit_kobo=COALESCE($6,cash_debt_limit_kobo),
      new_payout_account_cooldown_hours=COALESCE($7,new_payout_account_cooldown_hours),
      paystack_balance_alert_kobo=COALESCE($8,paystack_balance_alert_kobo),
      admin_adjustment_approval_kobo=COALESCE($9,admin_adjustment_approval_kobo),
      payout_name_match=COALESCE($10,payout_name_match),transfer_fee_tiers=COALESCE($11::jsonb,transfer_fee_tiers)
      WHERE id=true RETURNING *`,[...fields.map((field)=>input[field]??null),input.payoutNameMatch??null,tiers===undefined?null:JSON.stringify(tiers)])).rows[0];
    if (Number(updated.min_topup_kobo)>Number(updated.max_topup_kobo)) throw new ApiError(400,'invalid_payment_limits');
    await client.query('INSERT INTO admin_audit_log(actor_id,action,request_key,reason,metadata) VALUES($1,$2,$3,$4,$5)',[actorId,'settings_update',input.requestKey,input.reason,input]);
    return updated;
  });
}
