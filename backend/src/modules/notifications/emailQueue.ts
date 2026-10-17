import { randomUUID } from 'node:crypto';
import IORedis from 'ioredis';
import { Queue, Worker } from 'bullmq';
import { env } from '../../config/env';
import { db, inTransaction } from '../../shared/config/db';
import { observeWorker, queueHealth } from '../../shared/utils/queueHealth';
import type { EmailRow } from './email.types';
import { emailConfiguration, queueAdminEmail } from './email.service';
import { renderEmail } from './emailTemplates';
import { EmailProviderError, sendResendEmail } from './email.provider';
import { emailRuleEnabled, getEmailSettings } from './emailSettings.service';

let connection:IORedis|null=null;
let queue:Queue|null=null;
let worker:Worker|null=null;

export const emailRetryWindowMs=23*60*60*1000;
export function emailCanRetry(row:Pick<EmailRow,'status'|'retryable'|'first_attempt_at'>,now=Date.now()):boolean {
  return row.status==='failed'&&row.retryable&&(!row.first_attempt_at||now-row.first_attempt_at.getTime()<emailRetryWindowMs);
}

export async function processEmail(id:string):Promise<void>{
  if(!emailConfiguration().ready)return;
  const token=randomUUID();
  const row=await inTransaction(async client=>{
    const settings=await getEmailSettings(client,true);
    const selected=(await client.query<EmailRow>(`SELECT * FROM email_outbox WHERE id=$1
      AND (status IN ('queued','blocked') OR (status='sending' AND lease_until<now()))
      AND next_attempt_at<=now() FOR UPDATE SKIP LOCKED`,[id])).rows[0];
    if(!selected||!selected.recipient)return null;
    if(!emailRuleEnabled(settings,selected.control_key)){
      await client.query(`UPDATE email_outbox SET status=CASE WHEN first_attempt_at IS NULL THEN 'skipped' ELSE 'uncertain' END,
        retryable=false,last_error='disabled_in_email_preferences',lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=$1`,[id]);return null;
    }
    if(selected.first_attempt_at&&Date.now()-selected.first_attempt_at.getTime()>=emailRetryWindowMs){
      await client.query("UPDATE email_outbox SET status='uncertain',retryable=false,last_error='retry_window_expired',lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=$1",[id]);return null;
    }
    const suppressed=await client.query("SELECT 1 FROM email_outbox WHERE lower(recipient)=lower($1) AND status IN ('bounced','complained','suppressed') LIMIT 1",[selected.recipient]);
    if(suppressed.rowCount){await client.query("UPDATE email_outbox SET status='suppressed',retryable=false,last_error='recipient_suppressed',updated_at=now() WHERE id=$1",[id]);return null;}
    if(selected.user_id&&selected.audience==='customer'){
      const current=(await client.query<{email:string|null;is_active:boolean}>('SELECT email,is_active FROM users WHERE id=$1',[selected.user_id])).rows[0];
      if(!current?.is_active||current.email?.toLowerCase()!==selected.recipient.toLowerCase()){
        await client.query("UPDATE email_outbox SET status='skipped',retryable=false,last_error='recipient_changed_or_inactive',updated_at=now() WHERE id=$1",[id]);return null;
      }
    }else if(selected.audience==='customer'){
      await client.query("UPDATE email_outbox SET status='skipped',retryable=false,last_error='account_removed',updated_at=now() WHERE id=$1",[id]);return null;
    }
    if(selected.audience==='admin'&&!env.EMAIL_ADMIN_RECIPIENTS.includes(selected.recipient)){
      await client.query("UPDATE email_outbox SET status='skipped',retryable=false,last_error='admin_recipient_removed',updated_at=now() WHERE id=$1",[id]);return null;
    }
    const request=selected.request??{from:env.EMAIL_FROM,to:[selected.recipient],...(env.EMAIL_REPLY_TO?{reply_to:env.EMAIL_REPLY_TO}:{}),...renderEmail(selected.template,selected.payload),tags:[{name:'outbox_id',value:id}]};
    await client.query(`UPDATE email_outbox SET status='sending',lease_token=$2,lease_until=now()+interval '2 minutes',request=$3,
      first_attempt_at=COALESCE(first_attempt_at,now()),attempts=attempts+1,retryable=false,updated_at=now() WHERE id=$1`,[id,token,request]);
    return {...selected,request,attempts:selected.attempts+1};
  });
  if(!row)return;
  // Recheck after claiming so a preference change before provider dispatch also
  // takes effect. A provider request already in flight cannot be recalled.
  if(!emailRuleEnabled(await getEmailSettings(),row.control_key)){
    await db.query(`UPDATE email_outbox SET status=$3,retryable=false,last_error='disabled_in_email_preferences',lease_token=NULL,lease_until=NULL,updated_at=now()
      WHERE id=$1 AND lease_token=$2 AND status='sending'`,[id,token,row.first_attempt_at?'uncertain':'skipped']);return;
  }
  try{
    const providerId=await sendResendEmail(row.id,row.request);
    // A delivery callback can complete the record while the send response is in
    // flight. Never overwrite its terminal status or a different worker's claim.
    await db.query(`UPDATE email_outbox SET provider_id=COALESCE(provider_id,$3),status='accepted',accepted_at=COALESCE(accepted_at,now()),
      last_error=NULL,lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=$1 AND lease_token=$2 AND status='sending'`,[id,token,providerId]);
  }catch(error){
    const failure=error instanceof EmailProviderError?error:new EmailProviderError('provider_outcome_unknown',true,true);
    const retry=failure.retryable&&row.attempts<5;
    const status=retry?'queued':failure.ambiguous?'uncertain':'failed';
    const delay=Math.min(3600,30*2**(row.attempts-1))+Math.floor(Math.random()*15);
    await db.query(`UPDATE email_outbox SET status=$3,last_error=$4,retryable=$5,next_attempt_at=now()+($6*interval '1 second'),
      lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=$1 AND lease_token=$2 AND status='sending'`,[id,token,status,failure.code,failure.retryable&&!failure.ambiguous,delay]);
  }
}

export async function recoverEmails(){
  if(!emailConfiguration().ready||!queue)return;
  if(env.EMAIL_ADMIN_RECIPIENTS.length){
    await inTransaction(async client=>{
      await getEmailSettings(client,true);
      const pending=(await client.query<EmailRow>("SELECT * FROM email_outbox WHERE status='waiting_admin' ORDER BY created_at LIMIT 100 FOR UPDATE SKIP LOCKED")).rows;
      for(const row of pending){
        await queueAdminEmail(client,{userId:row.user_id??undefined,eventKey:row.event_key,template:row.template,payload:row.payload});
        await client.query("UPDATE email_outbox SET status='skipped',last_error='admin_recipients_resolved',updated_at=now() WHERE id=$1",[row.id]);
      }
    });
  }
  const pending=(await db.query<{id:string}>(`SELECT id FROM email_outbox WHERE
    (status IN ('queued','blocked') AND next_attempt_at<=now()) OR (status='sending' AND lease_until<now()) ORDER BY created_at LIMIT 200`)).rows;
  for(const row of pending)await queue.add('deliver',{id:row.id},{jobId:`email-${row.id}`,removeOnComplete:true,removeOnFail:true});
}

export async function startEmailWorkers(){
  if(worker)return;
  connection=new IORedis(env.REDIS_URL,{maxRetriesPerRequest:null});
  queue=new Queue('transactional-emails',{connection,prefix:env.TRIP_QUEUE_PREFIX});
  worker=new Worker('transactional-emails',async job=>{if(job.name==='deliver')await processEmail(String(job.data.id));else await recoverEmails();},{connection,prefix:env.TRIP_QUEUE_PREFIX,concurrency:2});
  observeWorker(queue,worker,connection);
  worker.on('error',()=>console.error('[email] worker unavailable'));
  await worker.waitUntilReady();
  await queue.upsertJobScheduler('email-recovery',{every:15_000},{name:'recover'});
  await recoverEmails();
}
export async function stopEmailWorkers(){await worker?.close();worker=null;await queue?.close();queue=null;await connection?.quit();connection=null;}
export async function emailQueueHealth(){return queueHealth('Transactional email worker',queue,connection??undefined);}
