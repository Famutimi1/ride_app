import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { env } from '../../config/env';
import { db } from '../../shared/config/db';
import { ApiError } from '../../shared/errors';
import type { EmailStatus } from './email.types';

export function verifyEmailWebhook(body:Buffer,headers:{id?:string;timestamp?:string;signature?:string},secret:string,now=Date.now()):void{
  if(!secret.startsWith('whsec_')||!headers.id||headers.id.length>160||!headers.timestamp||!/^\d+$/.test(headers.timestamp)||!headers.signature||headers.signature.length>2048||Math.abs(now/1000-Number(headers.timestamp))>300)throw new ApiError(400,'invalid_email_webhook');
  const expected=createHmac('sha256',Buffer.from(secret.slice(6),'base64')).update(`${headers.id}.${headers.timestamp}.`).update(body).digest();
  const valid=headers.signature.split(' ').some(part=>{
    const [version,signature]=part.split(',');
    if(version!=='v1'||!signature)return false;
    const bytes=Buffer.from(signature,'base64');
    return bytes.length===expected.length&&timingSafeEqual(bytes,expected);
  });
  if(!valid)throw new ApiError(400,'invalid_email_webhook');
}

const statuses:Record<string,EmailStatus>={'email.sent':'accepted','email.delivered':'delivered','email.delivery_delayed':'delayed','email.bounced':'bounced','email.complained':'complained','email.suppressed':'suppressed','email.failed':'failed'};

export async function receiveEmailWebhook(req:Request,res:Response):Promise<void>{
  if(!env.RESEND_WEBHOOK_SECRET)throw new ApiError(503,'email_webhook_unconfigured');
  if(!Buffer.isBuffer(req.body))throw new ApiError(400,'invalid_email_webhook');
  const id=req.get('svix-id');
  verifyEmailWebhook(req.body,{id,timestamp:req.get('svix-timestamp'),signature:req.get('svix-signature')},env.RESEND_WEBHOOK_SECRET);
  let event:{type?:string;created_at?:string;data?:{email_id?:string;to?:string[];tags?:Record<string,string>}};
  try{event=JSON.parse(req.body.toString('utf8'));}catch{throw new ApiError(400,'invalid_email_webhook');}
  if(!event||typeof event!=='object'||typeof event.type!=='string')throw new ApiError(400,'invalid_email_webhook');
  const status=statuses[event.type];
  if(!status){res.json({received:true});return;}
  const providerId=event.data?.email_id,tag=event.data?.tags?.outbox_id;
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const at=typeof event.created_at==='string'?new Date(event.created_at):null;
  if(typeof providerId!=='string'||!uuid.test(providerId)||!at||!Number.isFinite(at.getTime()))throw new ApiError(400,'invalid_email_event');
  const outboxId=typeof tag==='string'&&uuid.test(tag)?tag:null;
  const recipient=Array.isArray(event.data?.to)&&event.data.to.length===1&&typeof event.data.to[0]==='string'?event.data.to[0].toLowerCase():null;
  // The signed outbox tag resolves callbacks arriving before the API response.
  // Terminal negative outcomes take precedence even when callbacks arrive late.
  await db.query(`UPDATE email_outbox SET provider_id=COALESCE(provider_id,$1),status=$3,
    accepted_at=COALESCE(accepted_at,now()),delivered_at=CASE WHEN $3='delivered' THEN COALESCE(delivered_at,$4) ELSE delivered_at END,
    provider_event_at=GREATEST(COALESCE(provider_event_at,$4),$4),provider_event_id=$5,
    retryable=false,last_error=CASE WHEN $3 IN ('bounced','complained','suppressed','failed') THEN $3 ELSE NULL END,
    lease_token=NULL,lease_until=NULL,updated_at=now()
    WHERE (provider_id=$1 OR (id=$2 AND request IS NOT NULL AND first_attempt_at IS NOT NULL AND lower(recipient)=$6 AND (provider_id IS NULL OR provider_id=$1)))
    AND provider_event_id IS DISTINCT FROM $5
    AND status NOT IN ('complained','bounced','suppressed')
    AND ($3 IN ('complained','bounced','suppressed') OR ((provider_event_at IS NULL OR provider_event_at<=$4)
      AND (status<>'delivered' OR $3='delivered') AND (status<>'failed' OR $3 IN ('failed','delivered'))))`,
  [providerId,outboxId,status,at,id,recipient]);
  res.json({received:true});
}
