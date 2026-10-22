import { env } from '../../config/env';
import { ApiError } from '../../shared/errors';
import type { EmailClient, EmailPayload, EmailTemplate } from './email.types';
import { renderEmail } from './emailTemplates';
import type { CreateNotificationInput } from './notifications.types';
import { emailControlKey, emailRuleEnabled, getEmailSettings } from './emailSettings.service';
import { isAppAccountRole } from '../auth/auth.types';

export function normalizedEmail(value:unknown):string|null {
  if(value===undefined||value===null||value==='')return null;
  if(typeof value!=='string')throw new ApiError(400,'invalid_email');
  const email=value.trim().toLowerCase();
  if(!email||email.length>160||/[\u0000-\u0020\u007f]/.test(email)||!/^[^@<>]+@[^@<>]+\.[^@<>]+$/.test(email))throw new ApiError(400,'invalid_email');
  return email;
}

export function emailConfiguration(){
  const missing:string[]=[];
  if(!env.EMAIL_ENABLED)missing.push('EMAIL_ENABLED');
  if(!env.RESEND_API_KEY)missing.push('RESEND_API_KEY');
  if(!env.EMAIL_FROM)missing.push('EMAIL_FROM');
  if(!env.EMAIL_DASHBOARD_URL)missing.push('EMAIL_DASHBOARD_URL');
  return {ready:missing.length===0,missing};
}

export async function queueEmail(client:EmailClient,input:{userId?:string|null;eventKey:string;recipientKey:string;recipient:string|null;audience:'customer'|'admin';template:EmailTemplate;payload:EmailPayload}){
  const settings=await getEmailSettings(client,true);
  const key=emailControlKey(input.template,input.payload);
  const allowed=emailRuleEnabled(settings,key);
  const status=!allowed?'skipped':!input.recipient?(input.audience==='admin'?'waiting_admin':'waiting_email'):emailConfiguration().ready?'queued':'blocked';
  await client.query(`INSERT INTO email_outbox(user_id,event_key,recipient_key,recipient,audience,template,payload,subject,status,control_key,last_error)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(event_key,recipient_key) DO NOTHING`,
  [input.userId??null,input.eventKey,input.recipientKey,input.recipient,input.audience,input.template,input.payload,renderEmail(input.template,input.payload).subject,status,key,allowed?null:'disabled_in_email_preferences']);
}

export async function queueAdminEmail(client:EmailClient,input:{userId?:string;eventKey:string;template:EmailTemplate;payload:EmailPayload}){
  const recipients=env.EMAIL_ADMIN_RECIPIENTS;
  for(const recipient of recipients.length?recipients:[null])await queueEmail(client,{...input,audience:'admin',recipient,recipientKey:recipient??'administrators-unconfigured'});
}

export async function queueCustomerEmail(client:EmailClient,userId:string,eventKey:string,template:EmailTemplate,payload:Omit<EmailPayload,'name'>){
  const user=(await client.query<{full_name:string;email:string|null;is_active:boolean;role:string}>('SELECT full_name,email,is_active,role FROM users WHERE id=$1',[userId])).rows[0];
  if(!user||!user.is_active||!isAppAccountRole(user.role))return;
  await queueEmail(client,{userId,eventKey,template,payload:{...payload,name:user.full_name},audience:'customer',recipient:user.email,recipientKey:userId});
}

export async function queueSignupEmails(client:EmailClient,user:{id:string;full_name:string;email:string|null},accountType:'rider'|'driver'){
  const payload:EmailPayload={name:user.full_name,userId:user.id,accountType,occurredAt:new Date().toISOString(),dashboardPath:`/admin/${accountType==='driver'?'drivers':'riders'}/${user.id}`};
  await queueEmail(client,{userId:user.id,eventKey:`signup:${user.id}`,recipientKey:user.id,recipient:user.email,audience:'customer',template:accountType==='driver'?'welcome_driver':'welcome_rider',payload:{...payload,dashboardPath:undefined}});
  await queueAdminEmail(client,{userId:user.id,eventKey:`signup:${user.id}`,template:'admin_signup',payload});
}

/** Resolve only a pending welcome: historical application/financial mail must not
 * suddenly be delivered when a phone-only customer adds an address months later. */
export async function resolveWelcomeEmail(client:EmailClient,userId:string,email:string|null){
  if(!email)return;
  await client.query(`UPDATE email_outbox SET recipient=$2,status=$3,updated_at=now() WHERE user_id=$1 AND status='waiting_email' AND template IN ('welcome_rider','welcome_driver') AND request IS NULL`,[userId,email,emailConfiguration().ready?'queued':'blocked']);
}

export async function queueApplicationSubmitted(client:EmailClient,userId:string,version:string){
  await queueCustomerEmail(client,userId,`application:${userId}:${version}`,'application_received',{});
  const user=(await client.query<{full_name:string}>('SELECT full_name FROM users WHERE id=$1',[userId])).rows[0];
  if(user)await queueAdminEmail(client,{userId,eventKey:`application:${userId}:${version}`,template:'admin_application',payload:{name:user.full_name,userId,dashboardPath:`/admin/applications/${userId}`}});
}

/** Mirror selected committed events, never arbitrary notification text. Typed
 * contact addresses are not a security identity, so details stay in the app. */
export async function queueActivityEmail(client:EmailClient,input:CreateNotificationInput){
  const messages:Record<string,{heading:string;message:string}>={
    topup_succeeded:{heading:'Your Rakky Ride top-up is confirmed',message:'Your top-up has been confirmed. Open your wallet in the app for the amount and receipt.'},
    refund_posted:{heading:'A refund was added to your Rakky Ride wallet',message:'A refund has been posted to your wallet. Open the app to review the transaction.'},
    withdrawal_requested:{heading:'Your Rakky Ride withdrawal was requested',message:'We received your withdrawal request. It is being processed; this is not a confirmation of payout.'},
    withdrawal_succeeded:{heading:'Your Rakky Ride withdrawal is complete',message:'Your payout has been confirmed. Review the transaction in the app.'},
    withdrawal_failed:{heading:'An update on your Rakky Ride withdrawal',message:'Your payout could not be completed or was reversed. Review your earnings and withdrawal status in the app.'},
    trip_completed:{heading:'Your Rakky Ride trip receipt is ready',message:'Your trip has been completed. Open Rakky Ride for the final fare, payment method and receipt.'},
    courier_returned:{heading:'Your Rakky Ride return receipt is ready',message:'The package return has been completed. Open Rakky Ride for the final receipt and payment details.'},
  };
  const content=messages[input.type]??(input.type.startsWith('support_')?{heading:'Your Rakky Ride support case has an update',message:'Your support case was received or updated. Open support in the app to review the current status.'}:null);
  if(!content)return;
  const appPath=input.type.startsWith('support_')?'/account/support':input.type==='trip_completed'||input.type==='courier_returned'?(input.eventKey.endsWith(':driver')?'/account/driver-trips':'/account/trips'):input.type.startsWith('withdrawal_')?'/account/driver-wallet':'/account/payment';
  await queueCustomerEmail(client,input.userId,`activity:${input.eventKey}`,'activity_update',{...content,appPath,reference:typeof input.data?.referenceId==='string'?input.data.referenceId:typeof input.data?.tripId==='string'?input.data.tripId:typeof input.data?.careId==='string'?input.data.careId:undefined});
}
