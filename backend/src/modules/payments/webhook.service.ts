import type { Request, Response } from 'express';
import { db } from '../../shared/config/db';
import { gateway } from './gateway';
import { applySuccessfulTopup } from './topups.service';
import { enqueueWebhook } from './paymentQueue';

interface PaystackEvent {event:string;data:{reference?:string;transfer_code?:string;id?:number}}
export async function receivePaystackWebhook(req:Request,res:Response) {
  const raw=req.body as Buffer;
  const header=typeof req.headers['x-paystack-signature']==='string'?req.headers['x-paystack-signature']:undefined;
  if (!Buffer.isBuffer(raw)||!gateway.verifyWebhookSignature(raw,header)) return void res.sendStatus(401);
  let event:PaystackEvent;
  try { event=JSON.parse(raw.toString('utf8')) as PaystackEvent; } catch { return void res.sendStatus(400); }
  if (!event.event || !event.data) return void res.sendStatus(400);
  const key=`${event.event}:${event.data.reference??event.data.transfer_code??event.data.id??''}`;
  const result=await db.query(`INSERT INTO payment_webhook_events(provider,dedupe_key,event_type,payload)
    VALUES('paystack',$1,$2,$3) ON CONFLICT(provider,dedupe_key) DO NOTHING RETURNING id`,[key,event.event,event]);
  res.sendStatus(200);
  if (result.rowCount) void enqueueWebhook(key).catch((error)=>console.error('[payments] webhook enqueue failed',error));
}
export async function processWebhook(key:string) {
  const row=(await db.query<{id:string;event_type:string;payload:PaystackEvent;status:string}>('SELECT * FROM payment_webhook_events WHERE provider=$1 AND dedupe_key=$2',['paystack',key])).rows[0];
  if (!row || row.status==='processed'||row.status==='ignored') return;
  try {
    let status='processed';
    if (row.event_type==='charge.success' && row.payload.data.reference) await applySuccessfulTopup(row.payload.data.reference);
    else if (row.event_type.startsWith('transfer.') && row.payload.data.reference) {
      const {applyWithdrawalOutcome}=await import('./withdrawals.service.js');
      await applyWithdrawalOutcome(row.payload.data.reference,row.event_type.slice('transfer.'.length));
    } else if (row.event_type==='charge.dispute.create' && row.payload.data.reference) {
      const intent=(await db.query<{user_id:string}>('SELECT user_id FROM payment_intents WHERE provider_reference=$1',[row.payload.data.reference])).rows[0];
      if (intent) await db.query("UPDATE ledger_accounts SET is_frozen=true WHERE owner_user_id=$1 AND kind='user_wallet'",[intent.user_id]);
      console.error('[payments] dispute requires review', {reference:row.payload.data.reference});
    } else status='ignored';
    await db.query('UPDATE payment_webhook_events SET status=$2,processed_at=now(),error=NULL WHERE id=$1',[row.id,status]);
  } catch(error) {
    await db.query("UPDATE payment_webhook_events SET status='failed',error=$2 WHERE id=$1",[row.id,error instanceof Error?error.message:'processing_failed']);
    throw error;
  }
}
