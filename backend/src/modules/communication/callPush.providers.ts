import { connect } from 'node:http2';
import { readFile } from 'node:fs/promises';
import jwt from 'jsonwebtoken';
import { GoogleAuth } from 'google-auth-library';
import { env } from '../../config/env';
import type { CallPushProvider } from './callDevices.service';
export interface CallInvite {type:'rakky_call_invite';callId:string;tripId:string;registrationId:string;ticket:string;expiresAt:string;}
export interface PushResult {ok:boolean;invalid?:boolean;retry?:boolean;code?:string;}
let googleAuth:GoogleAuth|undefined;
async function sendFcm(token:string,invite:CallInvite):Promise<PushResult>{
  if(!/^[a-z][a-z0-9-]{4,62}$/.test(env.CALL_FCM_PROJECT_ID))return {ok:false,code:'fcm_configuration'};
  googleAuth??=new GoogleAuth({keyFilename:env.CALL_FCM_CREDENTIALS_FILE,scopes:['https://www.googleapis.com/auth/firebase.messaging']});
  const access=await googleAuth.getAccessToken();
  if(!access)return {ok:false,code:'fcm_credentials'};
  const ttl=Math.max(0,Math.min(30,Math.floor((Number(invite.expiresAt)-Date.now())/1000)));
  if(ttl<1)return {ok:false,code:'invite_expired'};
  const response=await fetch(`https://fcm.googleapis.com/v1/projects/${env.CALL_FCM_PROJECT_ID}/messages:send`,{
    method:'POST',headers:{Authorization:`Bearer ${access}`,'Content-Type':'application/json'},signal:AbortSignal.timeout(3000),
    body:JSON.stringify({message:{token,data:invite,android:{priority:'HIGH',ttl:`${ttl}s`,collapse_key:`call:${invite.callId}`}}}),
  });
  if(response.ok)return {ok:true};
  const body=await response.json().catch(()=>null) as {error?:{details?:{errorCode?:string}[]}}|null;
  const invalid=body?.error?.details?.some(detail=>detail.errorCode==='UNREGISTERED')??false;
  return {ok:false,invalid,retry:response.status===429||response.status>=500,code:invalid?'device_unregistered':`fcm_http_${response.status}`};
}
async function sendApns(token:string,invite:CallInvite):Promise<PushResult>{
  const key=await readFile(env.CALL_APNS_KEY_FILE,'utf8');
  const authorization=jwt.sign({iss:env.CALL_APNS_TEAM_ID},key,{algorithm:'ES256',keyid:env.CALL_APNS_KEY_ID,expiresIn:'50m'});
  return new Promise(resolve=>{
    const session=connect(env.CALL_APNS_SANDBOX?'https://api.sandbox.push.apple.com':'https://api.push.apple.com');
    let done=false;
    const finish=(result:PushResult)=>{if(done)return;done=true;clearTimeout(timer);session.destroy();resolve(result);};
    const timer=setTimeout(()=>finish({ok:false,retry:true,code:'apns_timeout'}),3000);
    session.on('error',()=>finish({ok:false,retry:true,code:'apns_connection'}));
    const request=session.request({':method':'POST',':path':`/3/device/${token}`,authorization:`bearer ${authorization}`,
      'apns-topic':`${env.CALL_APNS_BUNDLE_ID}.voip`,'apns-push-type':'voip','apns-priority':'10','apns-expiration':'0','apns-id':invite.callId});
    let status=0,body='';
    request.on('response',headers=>{status=Number(headers[':status']);});
    request.on('data',(chunk:Buffer)=>{if(body.length<2048)body+=chunk.toString();});
    request.on('error',()=>finish({ok:false,retry:true,code:'apns_request'}));
    request.on('end',()=>{
      let reason='';try{reason=String((JSON.parse(body) as {reason?:string}).reason??'');}catch{}
      const invalid=status===410||['BadDeviceToken','DeviceTokenNotForTopic','Unregistered'].includes(reason);
      finish({ok:status===200,invalid,retry:status===429||status>=500,code:status===200?undefined:invalid?'device_unregistered':`apns_http_${status}`});
    });
    request.end(JSON.stringify({aps:{'content-available':1},...invite}));
  });
}
export const callPushProvider={send:(provider:CallPushProvider,token:string,invite:CallInvite)=>provider==='fcm'?sendFcm(token,invite):sendApns(token,invite)};
