import { UserFacingError } from '@/utils/userMessage';
import type { AudioMedia,CallSignal,TurnConfiguration,CallMedia,VideoFrames } from './callTypes';

export function mediaPermissionsPending(){return false;}

export function audioMediaAvailable(){
  return typeof window!=='undefined'&&window.isSecureContext===true
    &&typeof RTCPeerConnection!=='undefined'&&typeof navigator.mediaDevices?.getUserMedia==='function';
}

/** Browser media uses the same authorized call/signaling lifecycle as native. */
export async function prepareAudioMedia(kind:CallMedia='audio',onVideo?:(frames:VideoFrames)=>void):Promise<AudioMedia>{
  if(!audioMediaAvailable())throw new UserFacingError('Use a supported browser on HTTPS or localhost to make audio calls.');
  let stream:MediaStream;
  try{stream=await navigator.mediaDevices.getUserMedia({audio:true,video:kind==='video'?{width:{ideal:640},height:{ideal:360},frameRate:{ideal:15,max:20},facingMode:'user'}:false});}
  catch(error){
    const name=error instanceof Error?error.name:'';
    throw new UserFacingError(name==='NotAllowedError'?(kind==='video'?'Allow camera and microphone access for video, or choose an audio call.':'Allow microphone access in your browser to make a call.'):
      name==='NotFoundError'?'Connect a microphone before making a call.':'Could not open your microphone. Check your browser and device settings.');
  }
  stream.getTracks().forEach(track=>{track.enabled=false;});
  const audio=document.createElement('audio');
  audio.autoplay=true;audio.hidden=true;audio.setAttribute('playsinline','');
  document.body.appendChild(audio);
  let pc:RTCPeerConnection|null=null,closed=false,muted=false,held=false,playAttempt=0;
  let pending:NonNullable<CallSignal['candidate']>[]=[];
  let send:((value:Omit<CallSignal,'callId'|'generation'>)=>void)|null=null;
  let playback:((blocked:boolean)=>void)|undefined;
  let remoteOffer:string|null=null,cachedAnswer:string|null=null;
  let videoOperation=0,negotiatingVideo=kind==='video';
  let videoStopped=kind!=='video',facing:'user'|'environment'='user',flipping=false;
  let remoteVideo:MediaStream|null=null;
  const frames=()=>onVideo?.({local:videoStopped?null:stream,remote:videoStopped?null:remoteVideo,localMirrored:facing==='user'});
  const stopVideo=()=>{
    videoStopped=true;videoOperation++;
    (stream.getVideoTracks?.()??[]).forEach(track=>{track.stop();stream.removeTrack(track);});
    remoteVideo?.getTracks().forEach(track=>track.stop());remoteVideo=null;frames();
  };
  const observeCamera=(track:MediaStreamTrack)=>track.addEventListener?.('ended',()=>{
    if(!closed&&!videoStopped&&stream.getVideoTracks().includes(track)){stopVideo();onVideo?.({local:null,remote:null,unavailable:true});}
  });
  (stream.getVideoTracks?.()??[]).forEach(observeCamera);
  frames();
  const play=async()=>{
    const active=pc,attempt=++playAttempt;
    if(closed||!active||!audio.srcObject)return;
    try{
      await audio.play();
      if(!closed&&pc===active&&attempt===playAttempt)playback?.(false);
    }catch{
      if(!closed&&pc===active&&attempt===playAttempt){playback?.(true);throw new UserFacingError('Tap Enable call audio to hear the other participant.');}
    }
  };
  // A reconnect can replace the peer while an SDP/ICE promise is pending.
  // Every continuation stays bound to the peer that started that operation.
  const isCurrent=(active:RTCPeerConnection)=>!closed&&pc===active;
  const flushIce=async(active:RTCPeerConnection)=>{
    if(!isCurrent(active)||!active.remoteDescription)return;
    const queued=pending;pending=[];
    for(const candidate of queued){if(!isCurrent(active))return;await active.addIceCandidate(candidate);}
  };
  return {
    connect(configuration:TurnConfiguration,signal,state,onPlaybackBlocked){
      if(closed)throw new UserFacingError('Call already closed.');
      pc?.close();pending=[];remoteOffer=null;cachedAnswer=null;send=signal;
      negotiatingVideo=!videoStopped&&configuration.media!=='audio';playback=onPlaybackBlocked;
      audio.pause();audio.srcObject=null;playAttempt++;playback?.(false);
      const active=new RTCPeerConnection({iceServers:configuration.iceServers,iceTransportPolicy:configuration.iceTransportPolicy});
      pc=active;
      const remote=new MediaStream();audio.srcObject=remote;audio.muted=held;remoteVideo=new MediaStream();frames();
      active.addEventListener('icecandidate',event=>{
        if(!closed&&pc===active&&event.candidate)signal({kind:'ice',candidate:{candidate:event.candidate.candidate,
          sdpMid:event.candidate.sdpMid??null,sdpMLineIndex:event.candidate.sdpMLineIndex??null}});
      });
      active.addEventListener('connectionstatechange',()=>{
        if(!closed&&pc===active&&['connected','disconnected','failed'].includes(active.connectionState))
          state(active.connectionState==='connected',active.connectionState==='failed');
      });
      active.addEventListener('track',event=>{
        if(closed||pc!==active)return;
        if(event.track.kind==='video'){if(negotiatingVideo){remoteVideo?.addTrack(event.track);frames();}return;}
        if(event.track.kind!=='audio')return;
        remote.addTrack(event.track);
        void play().catch(()=>undefined);
      });
      stream.getTracks().forEach(track=>{track.enabled=track.kind==='audio'?!muted&&!held:negotiatingVideo&&!held;if(track.kind==='audio'||negotiatingVideo)active.addTrack(track,stream);});
    },
    async offer(){
      const active=pc,signal=send;if(!active||closed)return;
      try{
        const offer=await active.createOffer();if(!isCurrent(active))return;
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
    hold(value){held=value;stream.getAudioTracks().forEach(track=>{track.enabled=!muted&&!value;});audio.muted=value;},
    async prepareVideo(changed){
      const operation=++videoOperation;
      let camera:MediaStream;
      try{camera=await navigator.mediaDevices.getUserMedia({audio:false,video:{width:{ideal:640},height:{ideal:360},frameRate:{ideal:15,max:20},facingMode:'user'}});}
      catch{throw new UserFacingError('Could not open your camera. Allow camera access or keep the audio call.');}
      camera.getTracks().forEach(track=>{track.enabled=false;});
      if(closed||operation!==videoOperation||!camera.getVideoTracks().length){camera.getTracks().forEach(track=>track.stop());throw new UserFacingError('Keep the app or tab visible to switch to video.');}
      camera.getVideoTracks().forEach(track=>{stream.addTrack(track);observeCamera(track);});
      videoStopped=false;facing='user';onVideo=changed;frames();
    },
    stopVideo,
    async flipCamera(){
      if(closed||videoStopped||flipping||!pc)return;
      const active=pc;flipping=true;let replacement:MediaStream|null=null;
      try{
        const target=facing==='user'?'environment':'user';
        replacement=await navigator.mediaDevices.getUserMedia({audio:false,video:{width:{ideal:640},height:{ideal:360},frameRate:{ideal:15,max:20},facingMode:{exact:target}}});
        if(!isCurrent(active)||videoStopped){replacement.getTracks().forEach(track=>track.stop());return;}
        const old=stream.getVideoTracks()[0],next=replacement.getVideoTracks()[0];
        const sender=active.getSenders().find(item=>item.track?.kind==='video');
        if(!sender||!next)throw new UserFacingError('Camera switching is unavailable.');
        await sender.replaceTrack(next);
        if(!isCurrent(active)||videoStopped){next.stop();return;}
        if(old)stream.removeTrack(old);old?.stop();stream.addTrack(next);observeCamera(next);facing=target;frames();
      }catch{replacement?.getTracks().forEach(track=>track.stop());throw new UserFacingError('Could not switch cameras on this device.');}
      finally{flipping=false;}
    },
    // Browser output is selected through browser/OS settings, not a phone route.
    speaker(){},
    resumePlayback:play,
    close(){
      if(closed)return;
      closed=true;stopVideo();playAttempt++;pc?.close();pc=null;pending=[];
      stream.getTracks().forEach(track=>track.stop());audio.pause();audio.srcObject=null;audio.remove();
    },
  };
}
