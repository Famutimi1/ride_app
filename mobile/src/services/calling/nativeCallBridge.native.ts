import { NativeModules,Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';
import Constants from 'expo-constants';
import type { AxiosRequestConfig } from 'axios';
import { apiClient } from '@/lib/apiClient';
import { tokenStore } from '@/lib/secureTokenStore';
import { API_BASE_URL } from '@/services/api';
import { notificationInstallationId } from '@/services/notificationService';
import type { AudioCall } from './callTypes';
import type { NativeCallBridge,NativeCallEvent } from './nativeCallTypes';
interface NativeCalls {
  addListener:(name:'nativeCall',handler:(event:NativeCallEvent)=>void)=>{remove:()=>void};
  isEnabled:()=>boolean;configure:(url:string,registrationId:string)=>Promise<void>;
  getPushToken:()=>Promise<string|null>;getPendingEvents:()=>Promise<NativeCallEvent[]>;
  acknowledgeEvent:(id:string,action:string)=>Promise<void>;reportIncoming:(id:string,tripId:string,deadline:number)=>Promise<void>;
  updateDeadline:(id:string,deadline:number)=>Promise<void>;startMedia:(id:string,deadline:number)=>Promise<void>;
  end:(id:string)=>Promise<void>;clear:()=>Promise<void>;
}
let activeOwner:number|null=null;
const PHONE_CALL_FOREGROUND_SERVICE_TYPE=4;
export async function createNativeCallBridge(generation:number):Promise<NativeCallBridge|null>{
  const native=requireOptionalNativeModule<NativeCalls>('RakkyNativeCalls');
  if(!native?.isEnabled()||!NativeModules.RNCallKeep)return null;
  const config:AxiosRequestConfig&{_sessionGeneration:number}={_sessionGeneration:generation};
  const current=()=>tokenStore.getSessionGeneration()===generation;
  const capabilities=(await apiClient.get<{nativeIncomingEnabled:boolean;providers:{fcm:boolean;apns_voip:boolean}}>('/calls/config',config)).data;
  const provider=Platform.OS==='ios'?'apns_voip':'fcm';
  if(!capabilities.nativeIncomingEnabled||!capabilities.providers[provider]||!current())return null;
  const CallKeep=(await import('react-native-callkeep')).default;
  const {RTCAudioSession}=await import('react-native-webrtc');
  let disposed=false,deviceId:string|null=null,lastToken:string|null=null;
  const bootEvents:NativeCallEvent[]=[];
  const listeners=new Set<(event:NativeCallEvent)=>void>();
  const emit=(event:NativeCallEvent)=>{
    if(disposed||!current())return;
    const captured={...event,createdAt:event.createdAt??Date.now()};
    if(event.callId&&['incoming','answer','end','expired','failed'].includes(event.action)){
      if(!bootEvents.some(value=>value.callId===event.callId&&value.action===event.action))bootEvents.push(captured);
    }
    listeners.forEach(handler=>handler(captured));
  };
  const normalize=(id:string)=>id.toLowerCase();
  const answered=new Set<string>(),reported=new Set<string>(),mediaStarted=new Set<string>();
  const subscriptions:{remove:()=>void}[]=[];
  const registerToken=async()=>{
    if(disposed||!current())return;
    const token=await native.getPushToken();
    if(!token||token===lastToken||disposed||!current())return;
    const result=(await apiClient.post<{deviceId:string}>('/calls/devices',{provider,token,protocol:1,
      installationId:await notificationInstallationId(),appVersion:Constants.expoConfig?.version??'unknown'},config)).data;
    if(disposed||!current())return;
    activeOwner=generation;deviceId=result.deviceId;
    await native.configure(API_BASE_URL,deviceId);
    lastToken=token;
  };
  try{
    await CallKeep.setup({ios:{appName:'Rakky Ride',supportsVideo:false,maximumCallGroups:'1',maximumCallsPerCallGroup:'1',includesCallsInRecents:false},
      android:{selfManaged:true,alertTitle:'Trip calls',alertDescription:'Enable trip audio calls.',cancelButton:'Cancel',okButton:'Continue',additionalPermissions:[],
        foregroundService:{channelId:'trip_call_active',channelName:'Active trip call',notificationTitle:'Rakky Ride audio call',foregroundServiceType:PHONE_CALL_FOREGROUND_SERVICE_TYPE}}});
    if(Platform.OS==='android')CallKeep.setAvailable(true);
    await registerToken();
    if(!deviceId||!current()){if(activeOwner===generation)await native.clear();return null;}
    const onAnswer=({callUUID}:{callUUID:string})=>{const callId=normalize(callUUID);answered.add(callId);emit({action:'answer',callId});};
    subscriptions.push(CallKeep.addEventListener('answerCall',onAnswer));
    subscriptions.push(CallKeep.addEventListener('endCall',({callUUID})=>emit({action:'end',callId:normalize(callUUID)})));
    subscriptions.push(CallKeep.addEventListener('didPerformSetMutedCallAction',({callUUID,muted})=>emit({action:'mute',callId:normalize(callUUID),value:muted})));
    subscriptions.push(CallKeep.addEventListener('didToggleHoldCallAction',({callUUID,hold})=>emit({action:'hold',callId:normalize(callUUID),value:hold})));
    subscriptions.push(CallKeep.addEventListener('didActivateAudioSession',()=>{RTCAudioSession.audioSessionDidActivate();emit({action:'interruption',value:false});}));
    subscriptions.push(CallKeep.addEventListener('didDeactivateAudioSession',()=>{RTCAudioSession.audioSessionDidDeactivate();emit({action:'interruption',value:true});}));
    subscriptions.push(CallKeep.addEventListener('checkReachability',()=>CallKeep.setReachable()));
    subscriptions.push(CallKeep.addEventListener('createIncomingConnectionFailed',({callUUID})=>emit({action:'failed',callId:normalize(callUUID)})));
    subscriptions.push(native.addListener('nativeCall',event=>{
      if(event.action==='token')void registerToken().catch(()=>undefined);
      else if(event.action==='tokenInvalidated'){
        if(deviceId)void apiClient.delete(`/calls/devices/${deviceId}`,config).catch(()=>undefined);
        lastToken=null;
      }else emit(event);
    }));
    const initial=await CallKeep.getInitialEvents();
    // Cold-launch answer/end events may predate React mounting. Keep them until
    // an authenticated controller subscribes; do not mark a call answered here.
    for(const event of initial??[]){
      if(event.name==='RNCallKeepPerformAnswerCallAction')bootEvents.push({action:'answer',callId:normalize((event.data as {callUUID:string}).callUUID),createdAt:Date.now()});
      if(event.name==='RNCallKeepPerformEndCallAction')bootEvents.push({action:'end',callId:normalize((event.data as {callUUID:string}).callUUID),createdAt:Date.now()});
    }
    CallKeep.clearInitialEvents();
    return {
      async report(call:AudioCall|null){
        if(disposed||!current())return;
        if(!call)return;
        const id=call.id,deadline=Date.parse(call.deadlineAt);
        if(call.endedAt||call.deviceRole==='observer'){
          if(reported.has(id)||answered.has(id))CallKeep.reportEndCallWithUUID(id,call.deviceRole==='observer'?4:2);
          await native.end(id);reported.delete(id);answered.delete(id);mediaStarted.delete(id);return;
        }
        if(!reported.has(id)){
          reported.add(id);
          if(call.deviceRole==='caller')CallKeep.startCall(id,id,'Trip participant','generic',false);
          else await native.reportIncoming(id,call.tripId,deadline);
        }
        await native.updateDeadline(id,deadline);
        if(call.status==='connecting'||call.status==='connected'){
          if(call.deviceRole==='receiver'&&!answered.has(id)){answered.add(id);CallKeep.answerIncomingCall(id);}
          if(!mediaStarted.has(id)){mediaStarted.add(id);await native.startMedia(id,deadline);}
        }
        if(call.status==='connected'){
          if(Platform.OS==='android')CallKeep.setCurrentCallActive(id);
          else if(call.deviceRole==='caller')CallKeep.reportConnectedOutgoingCallWithUUID(id);
        }
      },
      async pending(){return [...await native.getPendingEvents(),...bootEvents];},
      async acknowledge(id,action){await native.acknowledgeEvent(id,action);for(let i=bootEvents.length-1;i>=0;i--)if(bootEvents[i].callId===id&&bootEvents[i].action===action)bootEvents.splice(i,1);},
      async dismiss(id){CallKeep.reportEndCallWithUUID(id,2);await native.end(id);},
      subscribe(handler){listeners.add(handler);return ()=>{listeners.delete(handler);};},
      refreshToken:registerToken,
      async dispose(){
        if(disposed)return;disposed=true;subscriptions.forEach(subscription=>subscription.remove());listeners.clear();
        if(activeOwner===generation){activeOwner=null;await native.clear();}
        if(deviceId)await apiClient.delete(`/calls/devices/${deviceId}`,config).catch(()=>undefined);
      },
    };
  }catch(error){subscriptions.forEach(subscription=>subscription.remove());if(activeOwner===generation){activeOwner=null;await native.clear().catch(()=>undefined);}throw error;}
}
