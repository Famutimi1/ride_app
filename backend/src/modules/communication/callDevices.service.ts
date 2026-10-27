import { createCipheriv,createDecipheriv,createHash,randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { db,inTransaction } from '../../shared/config/db';
import { env } from '../../config/env';
import { ApiError } from '../../shared/errors';
import { callSession } from './call.service';
export type CallPushProvider='fcm'|'apns_voip';
export function nativeCallConfiguration(){
  const enabled=env.COMMUNICATION_NATIVE_CALLS_ENABLED&&Boolean(env.CALL_PUSH_TOKEN_KEY);
  return {protocol:1,nativeIncomingEnabled:enabled,providers:{
    fcm:enabled&&Boolean(env.CALL_FCM_PROJECT_ID&&env.CALL_FCM_CREDENTIALS_FILE&&existsSync(env.CALL_FCM_CREDENTIALS_FILE)),
    apns_voip:enabled&&Boolean(env.CALL_APNS_KEY_ID&&env.CALL_APNS_TEAM_ID&&env.CALL_APNS_KEY_FILE&&existsSync(env.CALL_APNS_KEY_FILE)),
  }};
}
function encryptionKey(){
  const key=Buffer.from(env.CALL_PUSH_TOKEN_KEY,'base64');
  if(key.length!==32)throw new ApiError(503,'native_calling_unavailable');return key;
}
export function encryptCallPushToken(token:string){
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',encryptionKey(),iv);
  const body=Buffer.concat([cipher.update(token,'utf8'),cipher.final()]);
  return Buffer.concat([iv,cipher.getAuthTag(),body]).toString('base64');
}
export function decryptCallPushToken(ciphertext:string){
  const value=Buffer.from(ciphertext,'base64');
  const decipher=createDecipheriv('aes-256-gcm',encryptionKey(),value.subarray(0,12));
  decipher.setAuthTag(value.subarray(12,28));
  return Buffer.concat([decipher.update(value.subarray(28)),decipher.final()]).toString('utf8');
}
export async function registerCallDevice(userId:string,sessionId:string,input:unknown){
  callSession(sessionId);
  const value=input as {provider?:unknown;token?:unknown;installationId?:unknown;appVersion?:unknown;protocol?:unknown}|null;
  if(!value||!['fcm','apns_voip'].includes(String(value.provider))||typeof value.token!=='string'||value.token.length<32||value.token.length>4096
    ||/\s/.test(value.token)||typeof value.installationId!=='string'||!/^[a-zA-Z0-9_-]{8,160}$/.test(value.installationId)
    ||typeof value.appVersion!=='string'||value.appVersion.length>40||value.protocol!==1)throw new ApiError(400,'invalid_call_device');
  const provider=value.provider as CallPushProvider;
  if(provider==='apns_voip'&&!/^[0-9a-f]{64,512}$/i.test(value.token))throw new ApiError(400,'invalid_call_device');
  const config=nativeCallConfiguration();
  if(!config.providers[provider])throw new ApiError(503,'native_calling_unavailable');
  const tokenHash=createHash('sha256').update(value.token).digest('hex');
  const ciphertext=encryptCallPushToken(value.token);
  return inTransaction(async client=>{
    // Token and installation locks prevent concurrent rotation/account transfer
    // from leaving a stale eligible registration. No raw token is a lock key.
    for(const key of [`call-token:${provider}:${tokenHash}`,`call-install:${provider}:${value.installationId}`].sort())
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[key]);
    await client.query(`UPDATE push_devices SET enabled=false,revoked_at=now(),revocation_reason='installation_rebound',updated_at=now()
      WHERE provider=$1 AND device_identifier=$2 AND user_id<>$3 AND enabled`,[provider,value.installationId,userId]);
    await client.query(`DELETE FROM push_devices WHERE provider=$1 AND user_id=$2 AND device_identifier=$3 AND call_token_hash<>$4`,[provider,userId,value.installationId,tokenHash]);
    const row=(await client.query<{id:string}>(`INSERT INTO push_devices(user_id,provider,platform,device_identifier,app_version,call_token_ciphertext,call_token_hash,session_id,call_protocol)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,1) ON CONFLICT(provider,call_token_hash) DO UPDATE SET
        user_id=EXCLUDED.user_id,device_identifier=EXCLUDED.device_identifier,app_version=EXCLUDED.app_version,
        call_token_ciphertext=EXCLUDED.call_token_ciphertext,session_id=EXCLUDED.session_id,call_protocol=1,
        enabled=true,revoked_at=NULL,revocation_reason=NULL,last_seen_at=now(),updated_at=now() RETURNING id`,
      [userId,provider,provider==='fcm'?'android':'ios',value.installationId,value.appVersion,ciphertext,tokenHash,sessionId])).rows[0];
    return {deviceId:row.id,protocol:1};
  });
}
export async function revokeCallDevice(userId:string,sessionId:string,id:string){
  if(!/^[0-9a-f-]{36}$/i.test(id))throw new ApiError(404,'call_device_not_found');
  await db.query(`UPDATE push_devices SET enabled=false,revoked_at=COALESCE(revoked_at,now()),revocation_reason='session_logout',updated_at=now()
    WHERE id=$1 AND user_id=$2 AND session_id=$3 AND provider<>'expo'`,[id,userId,sessionId]);
  return {success:true};
}
