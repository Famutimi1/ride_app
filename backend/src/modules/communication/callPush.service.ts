import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { db } from '../../shared/config/db';
import { env } from '../../config/env';
import { ApiError } from '../../shared/errors';
import { decryptCallPushToken,nativeCallConfiguration,type CallPushProvider } from './callDevices.service';
import { callPushProvider,type CallInvite } from './callPush.providers';
import { commandCall } from './call.service';
interface Delivery {id:string;call_id:string;device_id:string;attempts:number;}
interface InviteRow {id:string;trip_id:string;status:string;deadline_at:Date;user_id:string;provider:CallPushProvider;call_token_ciphertext:string;eligible:boolean;push_allowed:boolean;}
const eligibleSession=`d.enabled AND d.revoked_at IS NULL AND u.is_active AND EXISTS(SELECT 1 FROM refresh_tokens r
  WHERE r.user_id=d.user_id AND r.session_id=d.session_id AND r.session_scope='app' AND r.revoked_at IS NULL AND r.expires_at>now())`;
export function createInviteTicket(callId:string,deviceId:string,deadline:Date){
  return jwt.sign({tokenType:'native_call_invite',callId,deviceId,exp:Math.floor(deadline.getTime()/1000)},env.JWT_ACCESS_SECRET,
    {algorithm:'HS256',audience:'rakky-native-call-status',issuer:'rakky-calls'});
}
function inviteClaims(input:unknown){
  const ticket=(input as {ticket?:unknown}|null)?.ticket;
  if(typeof ticket!=='string'||ticket.length>2048)throw new ApiError(401,'invalid_call_invite');
  let claims:jwt.JwtPayload;
  try{
    const value=jwt.verify(ticket,env.JWT_ACCESS_SECRET,{algorithms:['HS256'],audience:'rakky-native-call-status',issuer:'rakky-calls'});
    if(typeof value==='string'||value.tokenType!=='native_call_invite'||typeof value.callId!=='string'||typeof value.deviceId!=='string'
      ||![value.callId,value.deviceId].every(id=>/^[0-9a-f-]{36}$/i.test(id)))throw new Error();
    claims=value;
  }catch{throw new ApiError(401,'invalid_call_invite');}
  return claims;
}
export async function inviteStatus(input:unknown){
  const claims=inviteClaims(input);
  const row=(await db.query<{id:string;status:string;deadline_at:Date;eligible:boolean}>(`SELECT c.id,c.status,c.deadline_at,(${eligibleSession}) AS eligible
    FROM call_sessions c JOIN push_devices d ON d.id=$2 AND d.user_id=c.callee_id JOIN users u ON u.id=d.user_id
    WHERE c.id=$1`,[claims.callId,claims.deviceId])).rows[0];
  const authorized=Boolean(env.COMMUNICATION_NATIVE_CALLS_ENABLED&&row?.eligible&&row.status==='ringing'&&row.deadline_at.getTime()>Date.now());
  return {callId:claims.callId,authorized,status:authorized?'ringing':'unavailable',expiresAt:authorized?row!.deadline_at.getTime():0};
}
/** The short-lived push grant can dismiss only its own unanswered invite. It
 * cannot accept, join media, end an accepted call, or act as an access token. */
export async function declineNativeInvite(input:unknown){
  const claims=inviteClaims(input);
  const row=(await db.query<{id:string;callee_id:string;session_id:string;version:number;status:string;eligible:boolean}>(`SELECT c.id,c.callee_id,c.version,c.status,d.session_id,(${eligibleSession}) AS eligible
    FROM call_sessions c JOIN push_devices d ON d.id=$2 AND d.user_id=c.callee_id JOIN users u ON u.id=d.user_id WHERE c.id=$1`,[claims.callId,claims.deviceId])).rows[0];
  if(!env.COMMUNICATION_NATIVE_CALLS_ENABLED||!row?.eligible||row.status!=='ringing')return {dismissed:false};
  try{await commandCall(row.callee_id,row.session_id,row.id,'decline',{version:row.version});return {dismissed:true};}
  catch(error){if(error instanceof ApiError&&error.status===409)return {dismissed:false};throw error;}
}
export async function processCallPushDeliveries(){
  const lease=randomUUID();
  const tasks=(await db.query<Delivery>(`UPDATE call_push_deliveries SET lease_token=$1,lease_until=now()+interval '15 seconds',attempts=attempts+1
    WHERE id IN(SELECT id FROM call_push_deliveries WHERE status='pending' AND available_at<=now()
      AND (lease_until IS NULL OR lease_until<now()) ORDER BY id LIMIT 5 FOR UPDATE SKIP LOCKED)
    RETURNING id,call_id,device_id,attempts`,[lease])).rows;
  let sent=0,skipped=0,failed=0;
  // Bound provider latency across devices; a slow device must not consume the
  // entire 30-second ring window for every later recipient.
  for(let i=0;i<tasks.length;i+=5)await Promise.all(tasks.slice(i,i+5).map(async task=>{
    const complete=async(status:string,code:string|null)=>db.query(`UPDATE call_push_deliveries SET status=$3,error_code=$4,lease_token=NULL,lease_until=NULL
      WHERE id=$1 AND lease_token=$2 AND status='pending'`,[task.id,lease,status,code]);
    try{
      const row=(await db.query<InviteRow>(`SELECT c.id,c.trip_id,c.status,c.deadline_at,d.user_id,d.provider,d.call_token_ciphertext,(${eligibleSession}) AS eligible,
        COALESCE((SELECT p.push_enabled FROM notification_preferences p WHERE p.user_id=d.user_id),true) AS push_allowed
        FROM call_sessions c JOIN push_devices d ON d.id=$2 AND d.user_id=c.callee_id JOIN users u ON u.id=d.user_id WHERE c.id=$1`,[task.call_id,task.device_id])).rows[0];
      if(!row||!row.eligible||!row.push_allowed||row.status!=='ringing'||row.deadline_at.getTime()<=Date.now()+1000||!nativeCallConfiguration().providers[row.provider]){
        await complete('skipped','invite_ineligible');skipped++;return;
      }
      const invite:CallInvite={type:'rakky_call_invite',callId:row.id,tripId:row.trip_id,registrationId:task.device_id,
        expiresAt:String(row.deadline_at.getTime()),ticket:createInviteTicket(row.id,task.device_id,row.deadline_at)};
      const result=await callPushProvider.send(row.provider,decryptCallPushToken(row.call_token_ciphertext),invite);
      if(result.invalid)await db.query(`UPDATE push_devices SET enabled=false,revoked_at=now(),revocation_reason='device_not_registered',updated_at=now() WHERE id=$1`,[task.device_id]);
      if(result.ok){await complete('sent',null);sent++;return;}
      if(!result.retry){await complete('failed',result.code??'provider_rejected');failed++;return;}
      throw new Error('provider_unavailable');
    }catch{
      await db.query(`UPDATE call_push_deliveries SET available_at=now()+make_interval(secs=>$3),lease_token=NULL,lease_until=NULL,error_code='provider_unavailable'
        WHERE id=$1 AND lease_token=$2 AND status='pending'`,[task.id,lease,Math.min(8,2**Math.min(task.attempts,3))]);failed++;
    }
  }));
  return {sent,skipped,failed};
}
