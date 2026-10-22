import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { notificationAudience } from './notificationAudience';

const mobileRequire=createRequire(resolve('../mobile/package.json'));
const compiler=mobileRequire('typescript') as {
  transpileModule:(source:string,options:object)=>{outputText:string};
  ModuleKind:{CommonJS:number};ScriptTarget:{ES2022:number};
};
interface Permission {granted:boolean;canAskAgain:boolean;status:string;ios?:{status:number};unavailableReason?:string}
interface Service {
  getNotificationPermission:()=>Promise<Permission>;
  requestNotificationPermission:()=>Promise<Permission>;
  registerCurrentDevice:(request:boolean)=>Promise<string|null>;
  currentDeviceRegistrationId:()=>Promise<string|null>;
  revokeCurrentDevice:()=>Promise<void>;
  notificationPermissionMessage:(permission:Permission)=>string;
}
function harness(options:{platform?:string;native?:boolean;expoGo?:boolean;isDevice?:boolean;loadFails?:boolean;initial?:Permission;answer?:Permission;deviceId?:string}={}){
  let permission=options.initial??{granted:false,canAskAgain:true,status:'undetermined'};
  const calls:string[]=[];
  const storedValues=new Map<string,string>();
  if(options.deviceId)storedValues.set('rakky-notification-device-registration-id',options.deviceId);
  const native={
    AndroidImportance:{MAX:5,HIGH:4,DEFAULT:3,LOW:2},
    IosAuthorizationStatus:{PROVISIONAL:3,EPHEMERAL:4},
    setNotificationHandler:()=>undefined,
    setNotificationChannelAsync:async()=>{calls.push('channel');},
    getPermissionsAsync:async()=>permission,
    requestPermissionsAsync:async()=>{calls.push('request');permission=options.answer??{granted:true,canAskAgain:true,status:'granted'};return permission;},
    getExpoPushTokenAsync:async()=>{calls.push('token');return{data:'ExponentPushToken[test-only-token]'};},
  };
  const mocks:Record<string,unknown>={
    '@/utils/notificationAudience': { notificationAudience },
    'expo-constants':{__esModule:true,default:{executionEnvironment:options.expoGo?'storeClient':'bare',expoConfig:{extra:{eas:{projectId:'test-project'}},version:'test'}}},
    'expo-device':{isDevice:options.isDevice??true},
    'expo-modules-core':{requireOptionalNativeModule:()=>options.native===false?null:{}},
    // Web has no native storage methods. Calling one must fail this regression test.
    'expo-secure-store':options.platform==='web'?{}:{
      getItemAsync:async(key:string)=>storedValues.get(key)??null,
      setItemAsync:async(key:string,value:string)=>{storedValues.set(key,value);},
      deleteItemAsync:async(key:string)=>{storedValues.delete(key);},
    },
    'react-native':{Platform:{OS:options.platform??'android'}},
    '@/lib/apiClient':{apiClient:{
      post:async()=>{calls.push('register');return{data:{deviceId:'test-device'}};},
      delete:async(path:string)=>{calls.push(`revoke:${path}`);},
    }},
  };
  const source=readFileSync(resolve('../mobile/src/services/notificationService.ts'),'utf8');
  const code=compiler.transpileModule(source,{compilerOptions:{module:compiler.ModuleKind.CommonJS,target:compiler.ScriptTarget.ES2022}}).outputText;
  const exports:Record<string,unknown>={};
  runInNewContext(code,{exports,require:(name:string)=>{
    if(name==='expo-notifications'){calls.push('load');if(options.loadFails)throw new Error('Missing native module');return native;}
    if(name in mocks)return mocks[name];
    throw new Error(`Unexpected import: ${name}`);
  }});
  return{service:exports as unknown as Service,calls};
}

test('browser logout cleanup skips native push storage and revocation',async()=>{
  const{service,calls}=harness({platform:'web'});
  assert.equal(await service.currentDeviceRegistrationId(),null);
  await service.revokeCurrentDevice();
  assert.deepEqual(calls,[]);
});

test('native logout cleanup still revokes and removes the saved push registration',async(t)=>{
  for(const platform of ['android','ios'])await t.test(platform,async()=>{
    const{service,calls}=harness({platform,deviceId:'saved-device'});
    assert.equal(await service.currentDeviceRegistrationId(),'saved-device');
    await service.revokeCurrentDevice();
    assert.deepEqual(calls,['revoke:/notifications/devices/saved-device']);
    assert.equal(await service.currentDeviceRegistrationId(),null);
    await service.revokeCurrentDevice();
    assert.equal(calls.length,1);
  });
});

test('notification permission distinguishes unsupported environments from blocked OS permission',async(t)=>{
  for(const scenario of [
    {options:{platform:'web'},reason:'browser',message:/web app/},
    {options:{expoGo:true},reason:'expo_go',message:/Expo Go/},
    {options:{native:false},reason:'native_module_missing',message:/updated Rakky Ride build/},
    {options:{loadFails:true},reason:'module_load_failed',message:/could not start/},
  ])await t.test(scenario.reason,async()=>{
    const{service,calls}=harness(scenario.options);
    const state=await service.requestNotificationPermission();
    assert.equal(state.granted,false);
    assert.equal(state.canAskAgain,false);
    assert.equal(state.unavailableReason,scenario.reason);
    assert.match(service.notificationPermissionMessage(state),scenario.message);
    assert.ok(!calls.includes('request'));
    assert.ok(!calls.includes('register'));
    if(scenario.reason!=='module_load_failed')assert.ok(!calls.includes('load'));
  });
});

test('Android creates channels before requesting permission and registers only after consent',async()=>{
  const{service,calls}=harness();
  assert.equal(await service.registerCurrentDevice(true),'test-device');
  assert.ok(calls.indexOf('channel')<calls.indexOf('request'));
  assert.ok(calls.indexOf('request')<calls.indexOf('token'));
  assert.ok(calls.indexOf('token')<calls.indexOf('register'));
});

test('denied or permanently blocked permission never registers a device or bypasses consent',async()=>{
  const denied=harness({answer:{granted:false,canAskAgain:true,status:'denied'}});
  assert.equal(await denied.service.registerCurrentDevice(true),null);
  assert.ok(denied.calls.includes('request'));
  assert.ok(!denied.calls.includes('token'));
  const blocked=harness({initial:{granted:false,canAskAgain:false,status:'denied'}});
  assert.equal(await blocked.service.registerCurrentDevice(true),null);
  assert.ok(!blocked.calls.includes('request'));
  assert.ok(!blocked.calls.includes('token'));
  assert.match(blocked.service.notificationPermissionMessage(await blocked.service.getNotificationPermission()),/device settings/);
});

test('emulator signup can request OS permission without attempting remote push registration',async()=>{
  const{service,calls}=harness({isDevice:false});
  assert.equal(await service.registerCurrentDevice(true),null);
  assert.ok(calls.includes('request'));
  assert.equal((await service.getNotificationPermission()).granted,true);
  assert.ok(!calls.includes('token'));
  assert.ok(!calls.includes('register'));
});

test('startup checks never prompt and granted permission is not requested twice',async()=>{
  const pending=harness();
  assert.equal(await pending.service.registerCurrentDevice(false),null);
  assert.ok(!pending.calls.includes('request'));
  const granted=harness({initial:{granted:true,canAskAgain:true,status:'granted'}});
  assert.equal(await granted.service.registerCurrentDevice(true),'test-device');
  assert.ok(!granted.calls.includes('request'));
});

test('iOS provisional authorization remains usable without repeatedly prompting',async()=>{
  const{service,calls}=harness({platform:'ios',initial:{granted:false,canAskAgain:true,status:'undetermined',ios:{status:3}}});
  assert.equal((await service.requestNotificationPermission()).granted,true);
  assert.ok(!calls.includes('request'));
  assert.ok(!calls.includes('channel'));
});
