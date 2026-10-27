import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { randomUUID,randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir,readFile,writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname,join,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { AddressInfo } from 'node:net';

const run=promisify(execFile),serial=process.argv[process.argv.indexOf('--serial')+1];
if(!/^emulator-\d+$/.test(serial??''))throw new Error('Select an Android emulator with --serial emulator-5554. Physical devices are deliberately excluded.');
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const sdk=process.env.ANDROID_HOME??join(homedir(),'Library/Android/sdk');
const executable=existsSync(join(sdk,'platform-tools/adb'))?join(sdk,'platform-tools/adb'):'adb';
const app='com.rackyride.app',output=join(root,'docs/testing/trip-audio-calls');
const manifest=await readFile(join(root,'mobile/android/app/src/main/AndroidManifest.xml'),'utf8');
if(!/NATIVE_CALLS_ENABLED[^>]*android:value="true"/.test(manifest))throw new Error('Rebuild the Android test APK after running RAKKY_NATIVE_CALLS_ENABLED=true npx expo prebuild --platform android --no-install. This smoke test requires native calling enabled in the test build.');
const adb=async(...args:string[])=>(await run(executable,['-s',serial,...args],{encoding:'buffer',maxBuffer:16*1024*1024,timeout:60000})).stdout;
const shell=async(command:string)=>(await adb('shell',command)).toString();
const quote=(value:string)=>"'"+value.replaceAll("'","'\\''")+"'";
const delay=(ms:number)=>new Promise(done=>setTimeout(done,ms));
const callId=randomUUID(),registrationId=randomUUID(),ticket=randomBytes(32).toString('base64url');
const requests:{path:string;valid:boolean}[]=[];
let expiresAt=0;
const server=createServer(async(req,res)=>{
  let body='';for await(const chunk of req)body+=String(chunk);
  let valid=false;try{valid=(JSON.parse(body) as {ticket?:string}).ticket===ticket;}catch{}
  requests.push({path:req.url??'',valid});
  res.writeHead(valid?200:401,{'Content-Type':'application/json'});
  res.end(JSON.stringify(req.url?.endsWith('invite-status')?{callId,authorized:valid,status:'ringing',expiresAt}:{dismissed:valid}));
});
await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
const port=(server.address() as AddressInfo).port;
const checks:Record<string,boolean>={};
try{
  await mkdir(output,{recursive:true});
  checks.debug_apk_installed=(await adb('install','-r',join(root,'mobile/android/app/build/outputs/apk/debug/app-debug.apk'))).toString().includes('Success');
  const installed=await shell(`dumpsys package ${app}`);
  checks.camera_permission_declared=installed.includes('android.permission.CAMERA');
  checks.microphone_permission_declared=installed.includes('android.permission.RECORD_AUDIO');
  // Give a slow emulator enough time for OS UI inspection within the native
  // handler's 60-second bound. This fixture does not change backend ring time.
  expiresAt=Date.now()+59000;
  await adb('reverse',`tcp:${port}`,`tcp:${port}`);
  await adb('shell','am','force-stop',app);
  const payload={type:'rakky_call_invite',callId,tripId:randomUUID(),registrationId,ticket,expiresAt:String(expiresAt)};
  await shell(['am','broadcast','-a','com.rackyride.calls.TEST_INCOMING','-n',`${app}/expo.modules.rakkycalls.RakkyCallDebugReceiver`,'--es','baseUrl',`http://127.0.0.1:${port}`,'--es','payload',JSON.stringify(payload)].map(quote).join(' '));
  let logs='';
  for(let i=0;i<20;i++){
    await delay(500);logs=(await adb('logcat','-d','-v','brief','VoiceConnectionService:D','RNCallKeep:D','*:S')).toString();
    if(logs.includes(callId)&&logs.includes('onCreateIncomingConnection'))break;
  }
  checks.native_status_validated_before_ringing=requests.some(value=>value.path.endsWith('invite-status')&&value.valid);
  checks.telecom_received_call=logs.includes(callId)&&logs.includes('onCreateIncomingConnection');
  const services=await shell(`dumpsys activity services ${app}`);
  checks.phone_call_foreground_service_active=services.includes('VoiceConnectionService')&&services.includes('isForeground=true');
  const notification=await shell('dumpsys notification --noredact');
  checks.native_call_notification=notification.includes(app)&&notification.includes('CallStyle');
  await adb('shell','input','keyevent','KEYCODE_WAKEUP');
  const ui=async()=>{
    await adb('shell','uiautomator','dump','/sdcard/rakky-call-smoke.xml');
    return (await adb('shell','cat','/sdcard/rakky-call-smoke.xml')).toString();
  };
  let xml=await ui();
  if(!xml.includes('Decline')){await adb('shell','cmd','statusbar','expand-notifications');await delay(1000);xml=await ui();}
  await writeFile(join(output,'android-native-incoming.png'),await adb('exec-out','screencap','-p'));
  checks.incoming_ui_visible=xml.includes('Trip participant')&&xml.includes('Answer')&&xml.includes('Decline');
  for(const node of xml.matchAll(/<node\b[^>]+>/g)){
    if(!/\b(?:text|content-desc)="[^"]*[Dd]ecline/.test(node[0]))continue;
    const bounds=node[0].match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
    if(bounds){await adb('shell','input','tap',String(Math.floor((Number(bounds[1])+Number(bounds[3]))/2)),String(Math.floor((Number(bounds[2])+Number(bounds[4]))/2)));break;}
  }
  await delay(1000);
  checks.decline_reached_scoped_native_endpoint=requests.some(value=>value.path.endsWith('native-decline')&&value.valid);
  await writeFile(join(output,'android-native-smoke.json'),JSON.stringify({results:checks,scope:'Synthetic native handler/UI test on Android emulator; provider wakeup, real backend authentication, TURN media and physical devices are separate checks.'},null,2)+'\n');
  console.info(JSON.stringify(checks,null,2));
  if(Object.values(checks).some(value=>!value))process.exitCode=1;
}finally{
  await adb('shell','am','broadcast','-a','com.rackyride.calls.TEST_CLEAR','-n',`${app}/expo.modules.rakkycalls.RakkyCallDebugReceiver`).catch(()=>undefined);
  await adb('reverse','--remove',`tcp:${port}`).catch(()=>undefined);
  server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));
}
