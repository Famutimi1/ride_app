import { db, inTransaction } from '../../shared/config/db';
import { ApiError } from '../../shared/errors';
import { auditInput, replayAdminOperation } from '../../shared/utils/adminAudit';
import type { EmailClient, EmailPayload, EmailTemplate } from './email.types';

export const emailControls=[
  {key:'welcome_rider',label:'Rider welcome',group:'Welcome & signup',description:'Welcome email after a rider completes registration.'},
  {key:'welcome_driver',label:'Driver welcome',group:'Welcome & signup',description:'Welcome and onboarding steps for a new driver.'},
  {key:'admin_signup',label:'Admin signup alerts',group:'Welcome & signup',description:'Notify administrators about new riders and drivers.'},
  {key:'application_received',label:'Application received',group:'Driver applications',description:'Confirm receipt of a driver application to the applicant.'},
  {key:'admin_application',label:'Admin application alerts',group:'Driver applications',description:'Notify administrators that an application is ready to review.'},
  {key:'driver_approved',label:'Application approved',group:'Driver applications',description:'Send decisions where all requested services are approved.'},
  {key:'driver_rejected',label:'Application needs attention',group:'Driver applications',description:'Send decisions where all requested services are rejected.'},
  {key:'driver_service_updates',label:'Mixed decisions & service changes',group:'Driver applications',description:'Send partial decisions, suspensions and other service updates.'},
  {key:'wallet_updates',label:'Top-ups & refunds',group:'Account activity',description:'Confirm wallet top-ups and refunds.'},
  {key:'withdrawal_updates',label:'Withdrawal updates',group:'Account activity',description:'Notify drivers about requested payouts and their outcomes.'},
  {key:'trip_receipts',label:'Trip receipt notifications',group:'Account activity',description:'Notify customers and drivers when trip or return receipts are ready.'},
  {key:'support_updates',label:'Support case updates',group:'Account activity',description:'Confirm support cases and notify customers of status changes.'},
] as const;
export type EmailControlKey=typeof emailControls[number]['key'];
export type EmailRules=Record<EmailControlKey,boolean>;
export interface EmailSettings {enabled:boolean;rules:EmailRules;version:number;updatedAt:Date}
const projection='enabled,rules,version,updated_at AS "updatedAt"';

/** Acquire this before locking outbox rows. Writers use the same order. */
export async function getEmailSettings(client:EmailClient=db,lock=false):Promise<EmailSettings>{
  const row=(await client.query<EmailSettings>(`SELECT ${projection} FROM email_settings WHERE id=true${lock?' FOR SHARE':''}`)).rows[0];
  if(!row)throw new ApiError(503,'email_settings_unavailable');
  return row;
}
export function emailControlKey(template:EmailTemplate,payload:EmailPayload):EmailControlKey|'test'{
  if(template==='activity_update'){
    if(payload.appPath==='/account/support')return 'support_updates';
    if(payload.appPath==='/account/driver-wallet')return 'withdrawal_updates';
    if(payload.appPath==='/account/trips'||payload.appPath==='/account/driver-trips')return 'trip_receipts';
    return 'wallet_updates';
  }
  if(template==='application_reviewed'){
    const services=payload.services??[];
    if(services.length&&services.every(service=>service.status==='approved'))return 'driver_approved';
    if(services.length&&services.every(service=>service.status==='rejected'))return 'driver_rejected';
    return 'driver_service_updates';
  }
  return template;
}
export function emailRuleEnabled(settings:EmailSettings,key:string):boolean{
  return settings.enabled&&(key==='test'||settings.rules[key as EmailControlKey]===true);
}
export async function emailSettingsView(){return {...await getEmailSettings(),controls:emailControls};}

export async function saveEmailSettings(actorId:string,input:Record<string,unknown>){
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['enabled','rules','expectedVersion','reason','requestKey'].includes(key)))throw new ApiError(400,'invalid_email_settings');
  const audit=auditInput(input.reason,input.requestKey);
  const rules=input.rules;
  if(typeof input.enabled!=='boolean'||!Number.isSafeInteger(input.expectedVersion)||Number(input.expectedVersion)<1||!rules||typeof rules!=='object'||Array.isArray(rules))throw new ApiError(400,'invalid_email_settings');
  const values=rules as Record<string,unknown>;
  if(Object.keys(values).length!==emailControls.length||emailControls.some(control=>typeof values[control.key]!=='boolean'))throw new ApiError(400,'invalid_email_rules');
  const nextRules=Object.fromEntries(emailControls.map(control=>[control.key,values[control.key]])) as EmailRules;
  const enabled=input.enabled;
  return inTransaction(async client=>{
    const replay=await replayAdminOperation(client,actorId,'email_settings_updated',audit.requestKey,{enabled,rules:nextRules,expectedVersion:input.expectedVersion,reason:audit.reason},['super_admin']);
    if(replay.previous){
      const saved=(await client.query<{settings:EmailSettings}>("SELECT metadata->'settings' AS settings FROM admin_audit_log WHERE id=$1",[replay.previous.id])).rows[0];
      return {settings:saved.settings,auditId:replay.previous.id,replayed:true};
    }
    const before=(await client.query<EmailSettings>(`SELECT ${projection} FROM email_settings WHERE id=true FOR UPDATE`)).rows[0];
    if(!before)throw new ApiError(503,'email_settings_unavailable');
    if(before.version!==input.expectedVersion)throw new ApiError(409,'email_settings_changed');
    const after=(await client.query<EmailSettings>(`UPDATE email_settings SET enabled=$1,rules=$2,version=version+1,updated_by=$3,updated_at=clock_timestamp() WHERE id=true RETURNING ${projection}`,[enabled,nextRules,actorId])).rows[0];
    const disabled=emailControls.filter(control=>!nextRules[control.key]).map(control=>control.key);
    const skipped=await client.query(`UPDATE email_outbox SET
      status=CASE WHEN first_attempt_at IS NULL THEN 'skipped' ELSE 'uncertain' END,
      last_error=CASE WHEN first_attempt_at IS NULL THEN 'disabled_in_email_preferences' ELSE 'disabled_with_prior_attempt' END,
      retryable=false,updated_at=clock_timestamp()
      WHERE status IN ('queued','blocked','waiting_email','waiting_admin') AND (NOT $1::boolean OR control_key=ANY($2::text[]))`,[enabled,disabled]);
    const snapshot=(value:EmailSettings)=>({emailEnabled:value.enabled,...value.rules,version:value.version});
    const record=(await client.query<{id:string}>(`INSERT INTO admin_audit_log(actor_id,action,object_type,request_key,reason,metadata)
      VALUES($1,'email_settings_updated','email_settings',$2,$3,$4) RETURNING id::text`,[actorId,audit.requestKey,audit.reason,{operationHash:replay.hash,before:snapshot(before),after:snapshot(after),settings:after,skipped:skipped.rowCount}])).rows[0];
    return {settings:after,auditId:record.id,replayed:false};
  });
}
