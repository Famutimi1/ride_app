import { randomUUID } from 'node:crypto';
import { env } from '../../config/env';
import { db, inTransaction } from '../../shared/config/db';
import { ApiError } from '../../shared/errors';
import { adminId, maskedEmail } from '../../shared/utils/adminQuery';
import { auditInput, recordAdminRead, replayAdminOperation } from '../../shared/utils/adminAudit';
import { emailCanRetry, emailQueueHealth } from './emailQueue';
import { emailConfiguration, queueAdminEmail } from './email.service';
import { renderEmail } from './emailTemplates';
import { emailStatuses, emailTemplates, type EmailRow } from './email.types';
import { emailRuleEnabled, getEmailSettings } from './emailSettings.service';

type VersionedEmail=EmailRow&{version:string};
function present(row:VersionedEmail){
  return {id:row.id,userId:row.user_id,audience:row.audience,recipient:row.recipient?maskedEmail(row.recipient):'No email address',template:row.template,
    subject:row.subject,status:row.status,attempts:row.attempts,lastError:row.last_error,createdAt:row.created_at.toISOString(),updatedAt:row.updated_at.toISOString(),
    acceptedAt:row.accepted_at?.toISOString()??null,deliveredAt:row.delivered_at?.toISOString()??null,providerId:row.provider_id,version:row.version,canRetry:emailCanRetry(row)};
}

export async function listAdminEmails(input:Record<string,unknown>){
  if(Object.keys(input).some(key=>!['page','status','template','audience','userId','from','to'].includes(key)))throw new ApiError(400,'unsupported_email_filter');
  const text=(key:string)=>{const value=input[key];if(value===undefined||value==='')return null;if(typeof value!=='string'||value.length>160)throw new ApiError(400,'invalid_email_filter');return value;};
  const pageText=text('page')??'1';
  if(!/^[1-9]\d{0,4}$/.test(pageText))throw new ApiError(400,'invalid_page');
  const page=Number(pageText),status=text('status'),template=text('template'),audience=text('audience'),userId=text('userId');
  if((status&&!emailStatuses.includes(status as typeof emailStatuses[number]))||(template&&!emailTemplates.includes(template as typeof emailTemplates[number]))||(audience&&!['customer','admin'].includes(audience)))throw new ApiError(400,'invalid_email_filter');
  if(userId)adminId(userId);
  const date=(key:string)=>{const value=text(key);if(value&&!/^\d{4}-\d{2}-\d{2}$/.test(value))throw new ApiError(400,'invalid_email_date');if(value){const d=new Date(value);if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==value)throw new ApiError(400,'invalid_email_date');return `${value}T00:00:00+01:00`;}return null;};
  const from=date('from'),to=date('to');
  if(from&&to&&from>=to)throw new ApiError(400,'invalid_email_date_range');
  const values=[status,template,audience,userId,from,to];
  const where=`($1::text IS NULL OR status=$1) AND ($2::text IS NULL OR template=$2) AND ($3::text IS NULL OR audience=$3)
    AND ($4::uuid IS NULL OR user_id=$4) AND ($5::timestamptz IS NULL OR created_at>=$5) AND ($6::timestamptz IS NULL OR created_at<$6)`;
  const [records,count,summary]=await Promise.all([
    db.query<VersionedEmail>(`SELECT *,updated_at::text AS version FROM email_outbox WHERE ${where} ORDER BY created_at DESC,id DESC LIMIT 20 OFFSET $7`,[...values,(page-1)*20]),
    db.query<{total:string}>(`SELECT COUNT(*)::text AS total FROM email_outbox WHERE ${where}`,values),
    db.query<{status:string;count:string}>('SELECT status,COUNT(*)::text AS count FROM email_outbox GROUP BY status'),
  ]);
  return {items:records.rows.map(present),page,pageSize:20,total:Number(count.rows[0].total),summary:Object.fromEntries(summary.rows.map(row=>[row.status,Number(row.count)])),asOf:new Date().toISOString()};
}

export async function emailAdminConfiguration(){
  return {enabled:env.EMAIL_ENABLED,...emailConfiguration(),sender:env.EMAIL_FROM||null,replyTo:env.EMAIL_REPLY_TO||null,
    adminRecipients:env.EMAIL_ADMIN_RECIPIENTS.map(maskedEmail),apiKeyConfigured:Boolean(env.RESEND_API_KEY),webhookConfigured:Boolean(env.RESEND_WEBHOOK_SECRET),
    logoUrl:env.EMAIL_LOGO_URL||(env.EMAIL_DASHBOARD_URL?new URL('/brand/rakky-ride-logo.png',env.EMAIL_DASHBOARD_URL).toString():null),
    appUrl:env.EMAIL_DASHBOARD_URL?new URL('/open-app',env.EMAIL_DASHBOARD_URL).toString():null,dashboardUrl:env.EMAIL_DASHBOARD_URL||null,worker:await emailQueueHealth()};
}

export function emailTemplateCatalogue(){
  return emailTemplates.map(template=>({template,version:1,...renderEmail(template,{name:'Preview customer',userId:'00000000-0000-4000-8000-000000000000',accountType:template==='admin_signup'?'driver':'rider',occurredAt:new Date().toISOString(),
    services:template==='application_reviewed'?[{name:'Passenger rides',status:'approved'},{name:'Courier deliveries',status:'pending'}]:undefined,
    heading:'Your Rakky Ride account has an update',message:'Your account activity has been updated. Open the app for details.',
    dashboardPath:template==='admin_application'?'/admin/applications':'/admin/drivers'})}));
}

export async function adminEmailDetail(actorId:string,id:string){
  const row=(await db.query<VersionedEmail>('SELECT *,updated_at::text AS version FROM email_outbox WHERE id=$1',[id])).rows[0];
  if(!row)throw new ApiError(404,'email_not_found');
  await recordAdminRead(actorId,'email_detail_read','email',id);
  const rendered=row.request??renderEmail(row.template,row.payload);
  const allowed=emailRuleEnabled(await getEmailSettings(),row.control_key);
  return {...present(row),canRetry:allowed&&emailCanRetry(row),text:rendered.text,html:rendered.html};
}

export async function retryAdminEmail(actorId:string,id:string,input:Record<string,unknown>){
  const audit=auditInput(input.reason,input.requestKey);
  if(typeof input.expectedVersion!=='string')throw new ApiError(400,'email_version_required');
  return inTransaction(async client=>{
    const replay=await replayAdminOperation(client,actorId,'email_retry',audit.requestKey,{id,expectedVersion:input.expectedVersion,reason:audit.reason});
    if(replay.previous)return {id,auditId:replay.previous.id,replayed:true};
    const settings=await getEmailSettings(client,true);
    const row=(await client.query<VersionedEmail>('SELECT *,updated_at::text AS version FROM email_outbox WHERE id=$1 FOR UPDATE',[id])).rows[0];
    if(!row)throw new ApiError(404,'email_not_found');
    if(!emailRuleEnabled(settings,row.control_key))throw new ApiError(409,'email_type_disabled');
    if(row.version!==input.expectedVersion||!emailCanRetry(row))throw new ApiError(409,'email_retry_unavailable');
    if(!emailConfiguration().ready)throw new ApiError(409,'email_not_configured');
    await client.query("UPDATE email_outbox SET status='queued',attempts=0,retryable=false,next_attempt_at=now(),updated_at=now() WHERE id=$1",[id]);
    const record=await client.query<{id:string}>(`INSERT INTO admin_audit_log(actor_id,action,object_type,object_id,request_key,reason,metadata)
      VALUES($1,'email_retry','email',$2,$3,$4,$5) RETURNING id::text`,[actorId,id,audit.requestKey,audit.reason,{operationHash:replay.hash}]);
    return {id,auditId:record.rows[0].id,replayed:false};
  });
}

export async function testAdminEmail(actorId:string,input:Record<string,unknown>){
  const audit=auditInput(input.reason,input.requestKey);
  if(!emailConfiguration().ready||!env.EMAIL_ADMIN_RECIPIENTS.length)throw new ApiError(409,'email_test_not_configured');
  if(Object.keys(input).some(key=>!['reason','requestKey'].includes(key)))throw new ApiError(400,'test_recipient_not_allowed');
  return inTransaction(async client=>{
    const replay=await replayAdminOperation(client,actorId,'email_test',audit.requestKey,{reason:audit.reason},['super_admin']);
    if(replay.previous)return {auditId:replay.previous.id,replayed:true};
    if(!emailRuleEnabled(await getEmailSettings(client,true),'test'))throw new ApiError(409,'email_disabled_in_preferences');
    const count=(await client.query<{count:number}>("SELECT COUNT(*)::int AS count FROM admin_audit_log WHERE actor_id=$1 AND action='email_test' AND created_at>now()-interval '1 hour'",[actorId])).rows[0].count;
    if(count>=3)throw new ApiError(429,'email_test_rate_limited');
    await queueAdminEmail(client,{eventKey:`test:${randomUUID()}`,template:'test',payload:{name:'Rakky Ride administrator'}});
    const record=await client.query<{id:string}>(`INSERT INTO admin_audit_log(actor_id,action,object_type,request_key,reason,metadata)
      VALUES($1,'email_test','email',$2,$3,$4) RETURNING id::text`,[actorId,audit.requestKey,audit.reason,{operationHash:replay.hash}]);
    return {auditId:record.rows[0].id,replayed:false};
  });
}
