import type { Request, Response } from 'express';
import { db } from '../../shared/config/db';
import { ApiError } from '../../shared/errors';
import { gateway, paymentMode } from './gateway';
import { applySuccessfulTopup } from './topups.service';
import { enqueueWebhook } from './paymentQueue';

interface PaystackEvent {event:string;data:{reference:string;domain:string;transfer_code?:string;id?:number}}
const supported=new Set(['charge.success','transfer.success','transfer.failed','transfer.reversed','charge.dispute.create']);
export async function receivePaystackWebhook(req:Request,res:Response) {
  const raw=req.body as Buffer;
  const header=typeof req.headers['x-paystack-signature']==='string'?req.headers['x-paystack-signature']:undefined;
  if(!Buffer.isBuffer(raw)||!gateway.verifyWebhookSignature(raw,header))return void res.sendStatus(401);
  let input:unknown;
  try {input=JSON.parse(raw.toString('utf8'));}catch{return void res.sendStatus(400);}
  if(!input||typeof input!=='object'||Array.isArray(input))return void res.sendStatus(400);
  const candidate=input as {event?:unknown;data?:unknown};
  if(typeof candidate.event!=='string'||candidate.event.length>60||!candidate.data||typeof candidate.data!=='object'||Array.isArray(candidate.data))return void res.sendStatus(400);
  if(!supported.has(candidate.event))return void res.sendStatus(200);
  const data=candidate.data as Record<string,unknown>;
  const transaction=data.transaction && typeof data.transaction==='object'?data.transaction as Record<string,unknown>:null;
  const reference=candidate.event==='charge.dispute.create'?transaction?.reference??data.reference:data.reference;
  const domain=data.domain??transaction?.domain;
  if(typeof reference!=='string'||!/^[-a-zA-Z0-9_.=]{1,80}$/.test(reference)||typeof domain!=='string'||domain!==paymentMode())return void res.sendStatus(400);
  // Retain only processing evidence, not customer/card/bank payloads.
  const event:PaystackEvent={event:candidate.event,data:{reference,domain}};
  if(typeof data.transfer_code==='string'&&data.transfer_code.length<=40)event.data.transfer_code=data.transfer_code;
  if(Number.isSafeInteger(data.id))event.data.id=Number(data.id);
  const key=`${event.event}:${reference}`;
  await db.query(`INSERT INTO payment_webhook_events(provider,dedupe_key,event_type,payload)
    VALUES('paystack',$1,$2,$3) ON CONFLICT(provider,dedupe_key) DO NOTHING`,[key,event.event,event]);
  // Acknowledge only durable receipt. Redis failure is repaired from PostgreSQL.
  res.sendStatus(200);
  void enqueueWebhook(key).catch(()=>console.error('[payments] webhook enqueue needs recovery',{eventType:event.event}));
}
export async function processWebhook(key:string) {
  const row=(await db.query<{id:string;event_type:string;payload:PaystackEvent;status:string}>('SELECT * FROM payment_webhook_events WHERE provider=$1 AND dedupe_key=$2',['paystack',key])).rows[0];
  if(!row||row.status==='processed'||row.status==='ignored')return;
  try {
    let status='processed';
    if(row.event_type==='charge.success'&&row.payload.data.reference) {
      const result=await applySuccessfulTopup(row.payload.data.reference);
      if(result.status==='unknown_reference')status='ignored';
      else if(result.status!=='succeeded')throw new ApiError(409,result.status==='mismatch'?'topup_verification_mismatch':'topup_not_successful_yet');
    } else if(['transfer.success','transfer.failed','transfer.reversed'].includes(row.event_type)&&row.payload.data.reference) {
      const {applyWithdrawalOutcome}=await import('./withdrawals.service.js');
      const result=await applyWithdrawalOutcome(row.payload.data.reference);
      if(result.status==='unknown_reference')status='ignored';
      else if(!['success','failed','reversed'].includes(result.status))throw new ApiError(409,'transfer_not_terminal_yet');
    } else if(row.event_type==='charge.dispute.create'&&row.payload.data.reference) {
      const intent=(await db.query<{user_id:string}>("SELECT user_id FROM payment_intents WHERE provider_reference=$1 AND status='succeeded'",[row.payload.data.reference])).rows[0];
      if(intent) {
        await db.query("UPDATE ledger_accounts SET is_frozen=true WHERE owner_user_id=$1 AND kind='user_wallet'",[intent.user_id]);
        console.error('[payments] dispute requires review',{reference:row.payload.data.reference});
      } else status='ignored';
    } else status='ignored';
    await db.query('UPDATE payment_webhook_events SET status=$2,processed_at=now(),error=NULL WHERE id=$1',[row.id,status]);
  } catch(error) {
    await db.query("UPDATE payment_webhook_events SET status='failed',error=$2 WHERE id=$1 AND status NOT IN ('processed','ignored')",[row.id,error instanceof ApiError?error.code:'processing_unavailable']);
    throw error;
  }
}
