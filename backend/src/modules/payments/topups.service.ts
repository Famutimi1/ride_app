import { randomUUID } from 'node:crypto';
import { db, inTransaction } from '../../shared/config/db';
import { ApiError } from '../../shared/errors';
import { env } from '../../config/env';
import { gateway, paymentMode } from './gateway';
import { emitWalletUpdated } from '../../websocket/notifications';
import { getOrCreateEarningsAccount, getOrCreateWalletAccount, getSystemAccountId, postTransaction } from './ledger.service';
import { rateLimit } from './payoutAccounts.service';
import { createNotificationRecord, publishNotification } from '../notifications/notifications.service';
import { walletNotification } from '../notifications/notificationTemplates';

interface IntentRow { id:string;user_id:string;target:'wallet'|'earnings';amount_kobo:string;status:string;provider_reference:string;authorization_url:string|null }
export async function createTopup(userId:string,amountKobo:number,target:'wallet'|'earnings') {
  if(paymentMode()==='live'&&!env.ENABLE_LIVE_PAYMENTS)throw new ApiError(503,'live_payments_disabled');
  if (!Number.isSafeInteger(amountKobo)) throw new ApiError(400,'invalid_amount');
  if (target!=='wallet'&&target!=='earnings') throw new ApiError(400,'invalid_target');
  const settings=(await db.query<{min_topup_kobo:string;max_topup_kobo:string}>('SELECT min_topup_kobo,max_topup_kobo FROM payment_settings WHERE id=true')).rows[0];
  if (!settings || amountKobo<Number(settings.min_topup_kobo)||amountKobo>Number(settings.max_topup_kobo)) throw new ApiError(400,'topup_amount_out_of_range');
  const user=(await db.query<{email:string|null}>('SELECT email FROM users WHERE id=$1 AND is_active=true',[userId])).rows[0];
  if (!user) throw new ApiError(401,'user_not_found');
  if (target==='earnings') {
    const approved=(await db.query("SELECT 1 FROM driver_profiles WHERE user_id=$1 AND status='approved'",[userId])).rowCount;
    if (!approved) throw new ApiError(403,'driver_not_approved');
  }
  if (!user.email && !env.PAYMENT_SYNTHETIC_EMAIL_DOMAIN) throw new ApiError(503,'payment_email_domain_not_configured');
  await rateLimit(`payments:topup:${userId}`,10,3600);
  const id=randomUUID(),reference=`tu_${id.replace(/-/g,'')}`;
  await db.query('INSERT INTO payment_intents(id,user_id,target,amount_kobo,provider_reference) VALUES($1,$2,$3,$4,$5)',[id,userId,target,amountKobo,reference]);
  try {
    const callback=env.PAYMENT_CALLBACK_URL?new URL(env.PAYMENT_CALLBACK_URL):null;
    callback?.searchParams.set('target',target);
    const checkout=await gateway.initializeCharge({email:user.email??`u_${userId.replace(/-/g,'')}@${env.PAYMENT_SYNTHETIC_EMAIL_DOMAIN}`,amountKobo,reference,metadata:{intentId:id,userId,target},callbackUrl:callback?.toString()});
    await db.query('UPDATE payment_intents SET authorization_url=$2,access_code=$3,updated_at=now() WHERE id=$1',[id,checkout.authorizationUrl,checkout.accessCode]);
    return {reference,authorizationUrl:checkout.authorizationUrl,accessCode:checkout.accessCode};
  } catch(error) {
    await db.query("UPDATE payment_intents SET status='failed',failure_reason='initialization_failed',updated_at=now() WHERE id=$1",[id]);
    throw error;
  }
}

export async function applySuccessfulTopup(reference:string) {
  const known=(await db.query<{status:string}>('SELECT status FROM payment_intents WHERE provider_reference=$1',[reference])).rows[0];
  if(!known)return {applied:false,status:'unknown_reference'};
  if(known.status==='succeeded')return {applied:false,status:'succeeded',replayed:true};
  const charge=await gateway.verifyCharge(reference);
  if (charge.status!=='success') return {applied:false,status:charge.status};
  const completed=await inTransaction(async(client)=>{
    const intent=(await client.query<IntentRow>('SELECT * FROM payment_intents WHERE provider_reference=$1 FOR UPDATE',[reference])).rows[0];
    if (!intent) return {result:{applied:false,status:'unknown_reference'},notification:null,userId:null};
    if (intent.status==='succeeded') return {result:{applied:false,status:'succeeded',replayed:true},notification:null,userId:null};
    const gross=Number(intent.amount_kobo),fee=charge.feeKobo;
    if (charge.reference!==reference||charge.domain!==paymentMode()||charge.currency!=='NGN'||charge.amountKobo!==gross||!Number.isSafeInteger(gross)||!Number.isSafeInteger(fee)||fee<0||fee>=gross||!charge.paidAt||!Number.isFinite(Date.parse(charge.paidAt))) {
      await client.query("UPDATE payment_intents SET status='mismatch',updated_at=now() WHERE id=$1",[intent.id]);
      console.error('[payments] top-up verification mismatch', {reference,intentId:intent.id});
      return {result:{applied:false,status:'mismatch'},notification:null,userId:null};
    }
    const existingEarnings=(await client.query<{id:string}>("SELECT id FROM ledger_accounts WHERE owner_user_id=$1 AND kind='driver_earnings'",[intent.user_id])).rows[0]?.id;
    const userAccount=intent.target==='wallet'?await getOrCreateWalletAccount(client,intent.user_id):existingEarnings??await getOrCreateEarningsAccount(client,intent.user_id);
    const gatewayAccount=await getSystemAccountId(client,'gateway_balance');
    const feeAccount=await getSystemAccountId(client,'expense_gateway_fees');
    const {transactionId}=await postTransaction(client,{type:'topup',idempotencyKey:`topup:${intent.id}`,referenceType:'payment_intent',referenceId:intent.id,
      entries:[{accountId:gatewayAccount,direction:'debit',amountKobo:gross-fee},
        ...(fee>0?[{accountId:feeAccount,direction:'debit' as const,amountKobo:fee}]:[]),
        {accountId:userAccount,direction:'credit',amountKobo:gross}]});
    await client.query("UPDATE payment_intents SET status='succeeded',failure_reason=NULL,fee_kobo=$2,channel=$3,paid_at=$4,ledger_transaction_id=$5,updated_at=now() WHERE id=$1",[intent.id,fee,charge.channel,charge.paidAt,transactionId]);
    const notification=await createNotificationRecord(client,walletNotification({userId:intent.user_id,eventKey:`topup:${reference}:succeeded`,type:'topup_succeeded',title:intent.target==='wallet'?'Wallet top-up successful':'Earnings balance updated',body:`₦${(gross/100).toLocaleString('en-NG',{minimumFractionDigits:2,maximumFractionDigits:2})} has been added successfully.`,referenceId:reference}));
    return {result:{applied:true,status:'succeeded'},notification,userId:intent.user_id};
  });
  if (completed.result.applied&&completed.userId) {
    emitWalletUpdated(completed.userId);
    if(completed.notification)await publishNotification(completed.notification).catch((error:unknown)=>console.error('[notifications] top-up publish failed',error instanceof Error?error.message:'unknown'));
  }
  return completed.result;
}
export async function getTopup(userId:string,reference:string) {
  const row=(await db.query<IntentRow>('SELECT * FROM payment_intents WHERE user_id=$1 AND provider_reference=$2',[userId,reference])).rows[0];
  if (!row) throw new ApiError(404,'topup_not_found');
  if (['pending','failed','abandoned'].includes(row.status)) await applySuccessfulTopup(reference);
  const current=(await db.query<IntentRow>('SELECT * FROM payment_intents WHERE id=$1',[row.id])).rows[0];
  return {reference:current.provider_reference,status:current.status,amountKobo:Number(current.amount_kobo),target:current.target};
}
