import { UserFacingError } from '@/utils/userMessage';
import { AppState,NativeModules,PermissionsAndroid,Platform } from 'react-native';
import type { MediaStream,RTCPeerConnection } from 'react-native-webrtc';
import type { AudioMedia,CallSignal,TurnConfiguration,CallMedia,VideoFrames } from './callTypes';

let permissionRequests=0;
export function mediaPermissionsPending(){return permissionRequests>0;}
async function waitForForeground(){
  if(!AppState?.currentState||AppState.currentState==='active')return;
  await new Promise<void>((resolve,reject)=>{
    const subscription=AppState.addEventListener('change',status=>{if(status==='active'){clearTimeout(timer);subscription.remove();resolve();}});
    const timer=setTimeout(()=>{subscription.remove();reject(new UserFacingError('Return to the app to use your camera or microphone.'));},2000);
    if(AppState.currentState==='active'){clearTimeout(timer);subscription.remove();resolve();}
  });
}
export function audioMediaAvailable(){return Boolean(NativeModules.WebRTCModule&&NativeModules.InCallManager);}
export async function prepareAudioMedia(kind:CallMedia='audio',onVideo?:(frames:VideoFrames)=>void):Promise<AudioMedia> {
  if(!audioMediaAvailable())throw new UserFacingError('Install the updated development build to use audio calls.');
  // Loading is guarded so an older development client can still run messaging.
  const {mediaDevices,RTCPeerConnection:Peer,MediaStream:Stream}=await import('react-native-webrtc');
  const manager=(await import('react-native-incall-manager')).default;
  const capture=async(constraints:Parameters<typeof mediaDevices.getUserMedia>[0])=>{
    permissionRequests++;let captured:MediaStream|null=null;
    try{
      captured=await mediaDevices.getUserMedia(constraints);
      captured.getTracks().forEach(track=>{track.enabled=false;});
      await waitForForeground();return captured;
    }catch(error){captured?.getTracks().forEach(track=>track.stop());captured?.release();throw error;}
    finally{permissionRequests--;}
  };
  const stream:MediaStream=await capture({audio:true,video:kind==='video'?{width:640,height:360,frameRate:15,facingMode:'user'}:false});
  let pc:RTCPeerConnection|null=null,closed=false,muted=false,held=false;
  let send:((value:Omit<CallSignal,'callId'|'generation'>)=>void)|null=null;
  let pending:NonNullable<CallSignal['candidate']>[]=[];
  let remoteOffer:string|null=null,cachedAnswer:string|null=null;
  let videoOperation=0,negotiatingVideo=kind==='video';
  let frontCamera=true;
  let videoStopped=kind!=='video',remoteVideo:MediaStream|null=null;
  // RTCView binds its video track when streamURL is first set. Publishing an
  // empty stream mounts a black renderer that does not rebind when a track arrives.
  const frames=()=>onVideo?.({local:videoStopped?null:stream,remote:videoStopped||!remoteVideo?.getVideoTracks().length?null:remoteVideo,localMirrored:frontCamera});
  const stopVideo=()=>{
    videoStopped=true;videoOperation++;
    (stream.getVideoTracks?.()??[]).forEach(track=>{track.stop();stream.removeTrack(track);});
    remoteVideo?.getTracks().forEach(track=>track.stop());remoteVideo?.release();remoteVideo=null;frames();
  };
  const observeCamera=(track:ReturnType<MediaStream['getVideoTracks']>[number])=>track.addEventListener?.('ended',()=>{
    if(!closed&&!videoStopped&&stream.getVideoTracks().includes(track)){stopVideo();onVideo?.({local:null,remote:null,unavailable:true});}
  });
  (stream.getVideoTracks?.()??[]).forEach(observeCamera);
  if(!stream.getAudioTracks().length||(kind==='video'&&!stream.getVideoTracks().length)){
    const message=!stream.getAudioTracks().length?'Allow microphone access to make a call.':'Allow camera access for video, or choose an audio call.';
    stream.getTracks().forEach(track=>track.stop());stream.release();throw new UserFacingError(message);
  }
  frames();
  // Permission is acquired before ringing/accepting; tracks stay disabled until
  // both parties have agreed to connect.
  stream.getTracks().forEach(track=>{track.enabled=false;});
  if(Platform.OS==='android'&&Number(Platform.Version)>=31){
    // Nearby-device access is optional: denial retains earpiece/speaker calling.
    permissionRequests++;
    try{await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT).catch(()=>undefined);await waitForForeground();}
    catch(error){stream.getTracks().forEach(track=>track.stop());stream.release();throw error;}
    finally{permissionRequests--;}
  }
  // A reconnect can replace the peer while an SDP/ICE promise is pending.
  // Every continuation stays bound to the peer that started that operation.
  const isCurrent=(active:InstanceType<typeof Peer>)=>!closed&&pc===active;
  const flushIce=async(active:InstanceType<typeof Peer>)=>{
    if(!isCurrent(active)||!active.remoteDescription)return;
    const queued=pending;pending=[];
    for(const candidate of queued){if(!isCurrent(active))return;await active.addIceCandidate(candidate);}
  };
  const transport:AudioMedia={
    connect(configuration:TurnConfiguration,signal,state){
      if(closed)throw new UserFacingError('Call already closed.');
      pc?.close();pending=[];remoteOffer=null;cachedAnswer=null;send=signal;
      negotiatingVideo=!videoStopped&&configuration.media!=='audio';
      manager.start({media:negotiatingVideo?'video':'audio'});manager.setForceSpeakerphoneOn(negotiatingVideo);
      // Let ICE prefer direct routes and use TURN when needed. Honor a legacy
      // relay-only server response during a rolling backend/mobile update.
      pc=new Peer({iceServers:configuration.iceServers,iceTransportPolicy:configuration.iceTransportPolicy});
      const active=pc;
      remoteVideo?.release();remoteVideo=videoStopped?null:new Stream();frames();
      active.addEventListener('track',event=>{if(!closed&&pc===active&&event.track?.kind==='video'&&negotiatingVideo){remoteVideo?.addTrack(event.track);frames();}});
      active.addEventListener('icecandidate',event=>{if(!closed&&pc===active&&event.candidate)signal({kind:'ice',candidate:{candidate:event.candidate.candidate,sdpMid:event.candidate.sdpMid??null,sdpMLineIndex:event.candidate.sdpMLineIndex??null}});});
      active.addEventListener('connectionstatechange',()=>{if(!closed&&pc===active&&['connected','disconnected','failed'].includes(active.connectionState))state(active.connectionState==='connected',active.connectionState==='failed');});
      stream.getTracks().forEach(track=>{track.enabled=track.kind==='audio'?!muted&&!held:negotiatingVideo&&!held;if(track.kind==='audio'||negotiatingVideo)active.addTrack(track,stream);});
    },
    async offer(){
      const active=pc,signal=send;if(!active||closed)return;
      try{
        const offer=await active.createOffer({offerToReceiveAudio:true,offerToReceiveVideo:negotiatingVideo});if(!isCurrent(active))return;
        await active.setLocalDescription(offer);if(!isCurrent(active))return;
        signal?.({kind:'offer',sdp:offer.sdp});
      }catch(error){if(isCurrent(active))throw error;}
    },
    async receive(value){
      const active=pc,signal=send;if(!active||closed)return;
      try{
        if(value.kind==='ice'){
          if(active.remoteDescription)await active.addIceCandidate(value.candidate);
          else if(pending.length<64&&value.candidate)pending.push(value.candidate);
        }else if(value.kind==='offer'){
          if(remoteOffer===value.sdp&&cachedAnswer){signal?.({kind:'answer',sdp:cachedAnswer});return;}
          await active.setRemoteDescription({type:'offer',sdp:value.sdp!});if(!isCurrent(active))return;
          await flushIce(active);if(!isCurrent(active))return;
          const answer=await active.createAnswer();if(!isCurrent(active))return;
          await active.setLocalDescription(answer);if(!isCurrent(active))return;
          remoteOffer=value.sdp!;cachedAnswer=answer.sdp??null;signal?.({kind:'answer',sdp:answer.sdp});
        }else if(!active.remoteDescription){
          await active.setRemoteDescription({type:'answer',sdp:value.sdp!});if(!isCurrent(active))return;
          await flushIce(active);
        }
      }catch(error){if(isCurrent(active))throw error;}
    },
    mute(value){muted=value;stream.getAudioTracks().forEach(track=>{track.enabled=!value&&!held;});},
    hold(value){held=value;stream.getAudioTracks().forEach(track=>{track.enabled=!muted&&!value;});pc?.getReceivers().forEach(receiver=>{if(receiver.track)receiver.track.enabled=!value;});},
    async prepareVideo(changed){
      const operation=++videoOperation;
      let camera:MediaStream;
      try{camera=await capture({audio:false,video:{width:640,height:360,frameRate:15,facingMode:'user'}});}
      catch{throw new UserFacingError('Could not open your camera. Allow camera access or keep the audio call.');}
      camera.getTracks().forEach(track=>{track.enabled=false;});
      if(closed||operation!==videoOperation||!camera.getVideoTracks().length){camera.getTracks().forEach(track=>track.stop());camera.release();throw new UserFacingError('Keep the app visible to switch to video.');}
      camera.getVideoTracks().forEach(track=>{stream.addTrack(track);observeCamera(track);});
      camera.release(false);videoStopped=false;frontCamera=true;onVideo=changed;frames();
    },
    stopVideo,
    async flipCamera(){if(!closed&&!videoStopped){(stream.getVideoTracks?.()??[]).forEach(track=>track._switchCamera());frontCamera=!frontCamera;frames();}},
    speaker(value){manager.setForceSpeakerphoneOn(value);},
    close(){if(closed)return;closed=true;stopVideo();pc?.close();pc=null;pending=[];stream.getTracks().forEach(track=>track.stop());stream.release();manager.stop();},
  };
  return transport;
}
