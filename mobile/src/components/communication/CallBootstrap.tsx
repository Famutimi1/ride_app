import { AppMessage } from '@/components/common/AppMessage';
import { useEffect } from 'react';
import { AppState,Modal,Platform,View } from 'react-native';
import { useRouter,usePathname } from 'expo-router';
import { uuid } from 'expo-modules-core';
import { useAuthStore } from '@/store/authStore';
import { useCallStore } from '@/store/callStore';
import { useTripStore } from '@/store/tripStore';
import { tokenStore } from '@/lib/secureTokenStore';
import { getSocket,SOCKET_EVENTS } from '@/services/socket';
import { audioMediaAvailable,prepareAudioMedia,mediaPermissionsPending } from '@/services/calling/audioMedia';
import { callApiForGeneration } from '@/services/calling/callService';
import { CallController } from '@/services/calling/CallController';
import { createNativeCallBridge } from '@/services/calling/nativeCallBridge';
import { NativeCallCoordinator } from '@/services/calling/NativeCallCoordinator';
import type { CallSignal } from '@/services/calling/callTypes';
import { Button,Text } from '@/components/common';
import { nativeWindTheme,useTheme } from '@/constants/theme';

/** One controller per account, above the navigation stack and role switching. */
export function CallBootstrap(){
  const userId=useAuthStore(state=>state.session?.user.id);
  const call=useCallStore(state=>state.call);
  const busy=useCallStore(state=>state.busy);
  const nativeReady=useCallStore(state=>state.backgroundCallsReady);
  const callError=useCallStore(state=>state.error);
  const router=useRouter(),pathname=usePathname(),theme=useTheme();
  useEffect(()=>{
    if(!userId||!audioMediaAvailable())return;
    const socket=getSocket();
    let mounted=true,nativeStarting=false,lastNativeAttempt=0;
    let nativeCoordinator:NativeCallCoordinator|null=null;
    let backgroundDeadline:ReturnType<typeof setTimeout>|null=null;
    const clearBackgroundDeadline=()=>{if(backgroundDeadline!==null){clearTimeout(backgroundDeadline);backgroundDeadline=null;}};
    const generation=tokenStore.getSessionGeneration();
    const controller=new CallController({
      api:callApiForGeneration(generation),prepare:prepareAudioMedia,requestId:()=>uuid.v4(),
      changed:snapshot=>{useCallStore.setState(snapshot);if(nativeCoordinator)void nativeCoordinator.report(snapshot.call);},
      signal:value=>new Promise<void>((resolve,reject)=>{
        if(!socket.connected)return reject(new Error('Call connection unavailable.'));
        socket.timeout(4000).emit(SOCKET_EVENTS.CALL_SIGNAL,value,(error:Error|null,result?:{ok:boolean;error?:string})=>{
          if(error||!result?.ok)reject(new Error(result?.error??'Call signaling timed out.'));else resolve();
        });
      }),
    });
    useCallStore.setState({controller,call:null,error:null,busy:false,muted:false,speaker:false,connected:false,backgroundCallsReady:false,playbackBlocked:false,localVideo:null,remoteVideo:null,videoStopped:true});
    const startNative=async()=>{
      if(!mounted||nativeCoordinator||nativeStarting||Date.now()-lastNativeAttempt<30000)return;
      nativeStarting=true;lastNativeAttempt=Date.now();
      try{
        const bridge=await createNativeCallBridge(generation);
        if(!bridge)return;
        if(!mounted||tokenStore.getSessionGeneration()!==generation){await bridge.dispose();return;}
        nativeCoordinator=new NativeCallCoordinator(bridge,controller,()=>useCallStore.getState().call);
        useCallStore.setState({backgroundCallsReady:true});
        await nativeCoordinator.reconcile();
        await nativeCoordinator.report(useCallStore.getState().call);
      }catch{/* Keep the verified foreground path when native setup is unavailable. */}
      finally{nativeStarting=false;}
    };
    const pulse=()=>{
      if(!mounted)return;
      if(Platform.OS==='web'||nativeCoordinator||AppState.currentState==='active'||AppState.currentState===null){
        void controller.pulse();
        if(nativeCoordinator)void nativeCoordinator.reconcile().catch(()=>undefined);
        else void startNative();
      }
    };
    const state=(value:{id?:string})=>{if(typeof value?.id==='string')void controller.stateChanged(value.id);};
    const signal=(value:CallSignal)=>controller.receive(value);
    socket.on(SOCKET_EVENTS.CALL_STATE,state);socket.on(SOCKET_EVENTS.CALL_SIGNAL,signal);socket.on('connect',pulse);
    const listener=AppState.addEventListener('change',status=>{
      // Keep foreground-only builds safe. Only a configured native call session
      // can retain media and renew its lease after the app backgrounds.
      const permissionDialog=Platform.OS!=='web'&&mediaPermissionsPending();
      if(status==='active')clearBackgroundDeadline();
      if(status!=='active'&&!permissionDialog)controller.pauseVideo();
      if(Platform.OS!=='web'&&status==='background'&&!nativeCoordinator){
        if(permissionDialog){
          // System permission activities temporarily pause the Android app.
          // Preserve audio briefly; capture remains disabled until foreground.
          clearBackgroundDeadline();backgroundDeadline=setTimeout(()=>{if(AppState.currentState!=='active'){controller.pauseVideo();void controller.hangUp();}},15000);
        }else void controller.hangUp();
      }else pulse();
    });
    const leavePage=()=>{void controller.hangUp();};
    const visibility=()=>{if(document.hidden)controller.pauseVideo();};
    if(Platform.OS==='web')document.addEventListener('visibilitychange',visibility);
    if(Platform.OS==='web')window.addEventListener('pagehide',leavePage);
    const unsubscribe=useAuthStore.subscribe(next=>{if(next.session?.user.id!==userId)controller.dispose();});
    const stopTripSafety=useTripStore.subscribe(next=>{
      const active=useCallStore.getState().call;
      if(active?.media==='video'&&next.trip?.id===active.tripId&&!['driver_assigned','driver_arrived'].includes(next.trip.status))void controller.audioOnly();
    });
    let lastPulse=0;
    const timer=setInterval(()=>{const video=useCallStore.getState().call?.media==='video';if(Date.now()-lastPulse>=(video?1000:5000)){lastPulse=Date.now();pulse();}},1000);pulse();
    return ()=>{
      mounted=false;clearBackgroundDeadline();unsubscribe();stopTripSafety();clearInterval(timer);listener.remove();socket.off(SOCKET_EVENTS.CALL_STATE,state);socket.off(SOCKET_EVENTS.CALL_SIGNAL,signal);socket.off('connect',pulse);
      if(Platform.OS==='web'){window.removeEventListener('pagehide',leavePage);document.removeEventListener('visibilitychange',visibility);}
      controller.dispose();if(nativeCoordinator)void nativeCoordinator.dispose();useCallStore.setState({controller:null,call:null,error:null,busy:false,connected:false,muted:false,speaker:false,backgroundCallsReady:false,playbackBlocked:false,localVideo:null,remoteVideo:null,videoStopped:true});
    };
  },[userId]);
  if(!call||call.endedAt||call.deviceRole==='observer')return null;
  const ownId=call.deviceRole==='caller'?call.callerId:call.calleeId;
  if(call.videoUpgrade&&call.videoUpgrade.requestedBy!==ownId)return <Modal transparent visible animationType="fade" onRequestClose={()=>{void useCallStore.getState().controller?.rejectVideo();}}>
    <View className="flex-1 justify-center px-xl" style={[nativeWindTheme[theme.scheme],{backgroundColor:theme.colors.overlay}]}>
      <View className="rounded-xl bg-surface p-xl">
        <Text variant="h2">Switch to video?</Text>
        <Text color="textMuted" className="mt-sm mb-lg">Your trip participant requested video. Accept to use your camera. You can keep talking on audio.</Text>
        {callError?<AppMessage message={callError} className="mb-md" />:null}
        <Button label="Accept video" loading={busy} onPress={()=>{void useCallStore.getState().controller?.acceptVideo();}}/>
        <Button label="Keep audio" variant="secondary" className="mt-sm" disabled={busy} onPress={()=>{void useCallStore.getState().controller?.rejectVideo();}}/>
      </View>
    </View>
  </Modal>;
  if(pathname.includes('trip-call'))return null;
  const incoming=call.status==='ringing'&&call.deviceRole==='receiver';
  const open=()=>router.push({pathname:'/trip-call',params:{tripId:call.tripId}});
  if(incoming&&nativeReady&&call.media!=='video')return null;
  if(!incoming)return <View className="absolute bottom-8 left-xl right-xl rounded-xl bg-surface p-md border border-border">
    <Button label={call.status==='connected'?call.media==='video'?'Return to video call':'Return to audio call':'Return to call'} size="sm" onPress={open}/>
  </View>;
  return <Modal transparent visible animationType="fade" onRequestClose={()=>{void useCallStore.getState().controller?.hangUp();}}>
    <View className="flex-1 justify-center px-xl" style={[nativeWindTheme[theme.scheme],{backgroundColor:theme.colors.overlay}]}>
      <View className="rounded-xl bg-surface p-xl">
        <Text variant="h2">{call.media==='video'?'Incoming video call':'Incoming trip call'}</Text>
        <Text color="textMuted" className="mt-sm mb-lg">Your trip participant is calling. {Platform.OS==='web'?'Keep this browser tab open during your call.':'Keep the app open during your call.'}</Text>
        <Button label={call.media==='video'?'Answer with video':'Answer'} loading={busy} onPress={()=>{open();void useCallStore.getState().controller?.accept();}}/>
        {call.media==='video'?<Button label="Answer with audio" variant="secondary" className="mt-sm" disabled={busy} onPress={()=>{open();void (async()=>{const controller=useCallStore.getState().controller;await controller?.audioOnly();if(useCallStore.getState().call?.media==='audio')await controller?.accept();})();}}/>:null}
        <Button label="Decline" variant="destructive" className="mt-sm" onPress={()=>{void useCallStore.getState().controller?.hangUp();}}/>
      </View>
    </View>
  </Modal>;
}
