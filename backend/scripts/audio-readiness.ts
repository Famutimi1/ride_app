import { readFile } from 'node:fs/promises';
import { createPrivateKey } from 'node:crypto';
import { db } from '../src/shared/config/db';
import { env } from '../src/config/env';
import { nativeCallConfiguration } from '../src/modules/communication/callDevices.service';
import { audioCallsEnabled,audioConnectionMode } from '../src/modules/communication/call.service';
async function main(){
  const configured=nativeCallConfiguration();
  const checks:Record<string,boolean>={audioEnabled:audioCallsEnabled(),relayConfigured:audioConnectionMode()==='direct-and-relay',nativeEnabled:configured.nativeIncomingEnabled,pushTokenEncryption:Boolean(env.CALL_PUSH_TOKEN_KEY),migrations:false};
  try{
    const rows=(await db.query<{filename:string}>("SELECT filename FROM schema_migrations WHERE filename IN ('023_trip_communication.sql','024_trip_audio_calls.sql','025_native_call_delivery.sql')")).rows;
    checks.migrations=rows.length===3;
  }catch{/* A stopped/local-unmigrated database is reported without leaking its URL. */}
  finally{await db.end();}
  checks.fcm=false;
  if(configured.providers.fcm)try{
    const account=JSON.parse(await readFile(env.CALL_FCM_CREDENTIALS_FILE,'utf8')) as {type?:string;project_id?:string;client_email?:string;private_key?:string};
    checks.fcm=account.type==='service_account'&&account.project_id===env.CALL_FCM_PROJECT_ID&&Boolean(account.client_email?.endsWith('.gserviceaccount.com'))
      &&typeof account.private_key==='string'&&createPrivateKey(account.private_key).asymmetricKeyType==='rsa';
  }catch{}
  checks.apns=false;
  if(configured.providers.apns_voip)try{
    const key=createPrivateKey(await readFile(env.CALL_APNS_KEY_FILE,'utf8'));
    checks.apns=/^[A-Z0-9]{10}$/.test(env.CALL_APNS_TEAM_ID)&&/^[A-Z0-9]{10}$/.test(env.CALL_APNS_KEY_ID)
      &&key.asymmetricKeyType==='ec'&&key.asymmetricKeyDetails?.namedCurve==='prime256v1';
  }catch{}
  console.info(JSON.stringify({checks,connectionMode:audioConnectionMode(),readyForLocalDirectTesting:checks.audioEnabled&&checks.migrations&&audioConnectionMode()==='direct-only',readyForProviderTesting:checks.audioEnabled&&checks.relayConfigured&&checks.nativeEnabled&&checks.pushTokenEncryption&&checks.migrations&&(checks.fcm||checks.apns),
    note:'Read-only configuration check. TURN allocation, provider delivery, native entitlements and two-way sound still require device tests.'},null,2));
  if(process.argv.includes('--require-ready')&&(!checks.audioEnabled||!checks.relayConfigured||!checks.nativeEnabled||!checks.migrations||!checks.pushTokenEncryption||!(checks.fcm||checks.apns)))process.exitCode=1;
}
main().catch(()=>{console.error('Audio readiness could not be checked. No settings or database records were changed.');process.exitCode=1;});
