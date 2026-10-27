import { UserFacingError, userErrorMessage } from '@/utils/userMessage';
import type { AudioCall,AudioMedia,CallApi,CallSignal,CallSnapshot,CallMedia,VideoFrames } from './callTypes';

interface Dependencies {
  api:CallApi;prepare:(media?:CallMedia,video?:(frames:VideoFrames)=>void)=>Promise<AudioMedia>;signal:(value:CallSignal)=>Promise<void>;
  requestId:()=>string;changed:(state:CallSnapshot)=>void;now?:()=>number;
}
const terminal=(call:AudioCall)=>Boolean(call.endedAt);
/** Owns microphone/peer lifetime independently of navigation and display role. */
export class CallController {
  private state:CallSnapshot={call:null,busy:false,muted:false,speaker:false,connected:false,error:null,playbackBlocked:false};
  private media:AudioMedia|null=null;
  private epoch=0;
  private disposed=false;
  private negotiation=0;
  private mediaReady=false;
  private signals:CallSignal[]=[];
  private serial:Promise<void>=Promise.resolve();
  private pumping=false;
  private ending:AudioCall|null=null;
  private lastServerContact=0;
  private lastOffer=0;
  private offer:CallSignal|null=null;
  private renewRelayAt=Infinity;
  private disconnectedAt:number|null=null;
  private held=false;
  private recoveryAttempts=0;
  private videoTimer:ReturnType<typeof setTimeout>|null=null;
  private mediaKind:CallMedia='audio';
  private videoDisabled=false;
  private downgrading=false;
  private videoEpoch=0;
  private upgradePhase:'preparing'|'waiting'|'accepting'|null=null;
  private upgradeTimer:ReturnType<typeof setTimeout>|null=null;
  private clearUpgradeTimer(){if(this.upgradeTimer!==null){clearTimeout(this.upgradeTimer);this.upgradeTimer=null;}}
  private clearVideoTimer(){if(this.videoTimer!==null){clearTimeout(this.videoTimer);this.videoTimer=null;}}
  private stopVideo(){this.clearVideoTimer();this.clearUpgradeTimer();this.upgradePhase=null;this.videoDisabled=true;this.videoEpoch++;this.media?.stopVideo?.();this.update({localVideo:null,remoteVideo:null,videoStopped:true});}
  private videoCallback(){
    const epoch=this.epoch,videoEpoch=++this.videoEpoch;
    return (frames:VideoFrames)=>{
      if(epoch!==this.epoch||videoEpoch!==this.videoEpoch||this.disposed||this.videoDisabled)return;
      if(frames.unavailable){this.stopVideo();void this.audioOnly();return;}
      this.update({localVideo:frames.local,remoteVideo:frames.remote,localVideoMirrored:frames.localMirrored!==false});
    };
  }
  private prepare(kind:CallMedia){
    this.mediaKind=kind;this.videoDisabled=false;
    this.update({videoStopped:kind!=='video',...(kind==='video'?{speaker:true}:{})});
    return this.deps.prepare(kind,this.videoCallback());
  }
  constructor(private deps:Dependencies){}
  private now(){return this.deps.now?.()??Date.now();}
  private update(patch:Partial<CallSnapshot>){if(!this.disposed){this.state={...this.state,...patch};this.deps.changed(this.state);}}
  private stopMedia(){this.clearVideoTimer();this.clearUpgradeTimer();this.upgradePhase=null;this.videoEpoch++;this.videoDisabled=false;this.mediaKind='audio';this.epoch++;this.media?.close();this.media=null;this.negotiation=0;this.mediaReady=false;this.signals=[];this.offer=null;this.serial=Promise.resolve();this.renewRelayAt=Infinity;this.disconnectedAt=null;this.held=false;this.recoveryAttempts=0;this.update({connected:false,muted:false,speaker:false,playbackBlocked:false,localVideo:null,remoteVideo:null,videoStopped:true});}
  private error(error:unknown){this.update({error:userErrorMessage(error, 'Could not connect your call.')});}
  async start(tripId:string,kind:CallMedia='audio'){
    if(this.disposed||this.state.busy||this.ending||this.state.call&&!terminal(this.state.call))return;
    this.stopMedia();const epoch=this.epoch;this.update({call:null,busy:true,error:null});
    let prepared:AudioMedia|null=null;
    try{
      prepared=await this.prepare(kind);
      if(this.disposed||epoch!==this.epoch){prepared.close();return;}
      this.media=prepared;
      if(kind==='video'&&this.videoDisabled)throw new UserFacingError('Keep the app or tab visible to start video. You can choose audio instead.');
      const requestId=this.deps.requestId();
      const call=await this.deps.api.start(tripId,requestId,kind).catch(()=>this.deps.api.start(tripId,requestId,kind));
      if(this.disposed||epoch!==this.epoch){void this.deps.api.command(call.id,'end',call.version).catch(()=>undefined);return;}
      await this.apply(call);
    }catch(error){if(epoch===this.epoch){this.stopMedia();this.error(error);}}
    finally{if(!this.disposed)this.update({busy:false});}
  }
  async accept(){
    const call=this.state.call;if(!call||call.status!=='ringing'||call.deviceRole!=='receiver'||this.state.busy)return;
    const epoch=this.epoch;this.update({busy:true,error:null});
    try{
      const prepared=await this.prepare(call.media);
      if(this.disposed||epoch!==this.epoch){prepared.close();return;}
      this.media=prepared;
      const answer=async(latest:AudioCall)=>{
        if(this.disposed||epoch!==this.epoch)return;
        // Permission dialogs can outlive a safety downgrade or another device's answer.
        if(latest.media==='audio'||this.videoDisabled){
          prepared.stopVideo?.();
          if(latest.media==='video'&&!terminal(latest)&&latest.deviceRole==='receiver')latest=await this.deps.api.command(latest.id,'audio',latest.version);
          this.mediaKind='audio';
        }
        if(latest.status==='ringing'&&latest.deviceRole==='receiver')latest=await this.deps.api.command(latest.id,'accept',latest.version);
        if(!this.disposed&&epoch===this.epoch)await this.apply(latest);
      };
      try{await answer(await this.deps.api.get(call.id));}
      catch{if(!this.disposed&&epoch===this.epoch)await answer(await this.deps.api.get(call.id));}
    }catch(error){if(epoch===this.epoch){this.stopMedia();this.error(error);await this.refresh().catch(()=>undefined);}}
    finally{this.update({busy:false});}
  }
  async hangUp(){
    const call=this.state.call;
    this.stopMedia();
    if(!call||terminal(call))return;
    this.ending=call;
    this.update({call:{...call,status:'ended',endedAt:new Date(this.now()).toISOString(),endReason:'end'},busy:false});
    await this.finishEnding();
  }
  private async finishEnding(){
    const call=this.ending;if(!call)return;
    try{
      const latest=await this.deps.api.get(call.id);
      const action=latest.status==='ringing'?(latest.deviceRole==='receiver'?'decline':'cancel'):'end';
      const result=terminal(latest)?latest:await this.deps.api.command(call.id,action,latest.version);
      if(this.ending?.id===call.id){this.ending=null;this.update({call:result});}
    }catch{this.update({error:'Call ended on this device. Confirming with the server…'});}
  }
  async refresh(){
    if(this.disposed||this.ending)return;
    const existing=this.state.call;
    const call=existing&&!terminal(existing)?await this.deps.api.get(existing.id):await this.deps.api.active();
    if(this.disposed||this.ending)return;
    this.lastServerContact=this.now();
    if(call)await this.apply(call);
    else if(existing&&!terminal(existing)){this.stopMedia();this.update({call:null});}
  }
  async recoverIncoming(id:string){
    if(this.disposed||this.ending)return;
    const current=this.state.call;
    if(current&&!terminal(current)&&current.id!==id)return;
    const call=await this.deps.api.get(id);
    if(this.disposed||this.ending)return;
    await this.apply(call);
  }
  async answerFromNative(id:string){
    await this.recoverIncoming(id);
    if(this.state.busy)throw new UserFacingError('call_not_ready');
    // OS audio answer must never silently grant camera consent.
    if(this.state.call?.id===id&&this.state.call.media==='video')await this.audioOnly();
    if(this.state.call?.id===id)await this.accept();
  }
  async endFromNative(id:string){
    if(this.state.call?.id!==id)await this.recoverIncoming(id);
    if(this.state.call?.id===id)await this.hangUp();
  }
  private async apply(call:AudioCall){
    if(this.disposed||this.ending)return;
    const existing=this.state.call;
    if(existing?.id===call.id&&(existing.version>call.version||terminal(existing)&&!terminal(call)))return;
    if(existing?.id!==call.id){if(existing)this.stopMedia();this.update({error:null});}
    this.lastServerContact=this.now();this.update({call});
    if(terminal(call)||call.deviceRole==='observer'){this.stopMedia();return;}
    if(call.media==='audio'&&this.mediaKind==='video'){this.stopVideo();this.mediaKind='audio';}
    this.clearUpgradeTimer();
    if(call.media==='audio'){
      if(this.upgradePhase==='waiting'&&!call.videoUpgrade||call.status!=='connected'&&this.upgradePhase)this.stopVideo();
      if(call.videoUpgrade){
        const remaining=Math.min(30000,call.videoUpgrade.expiresAt-this.now());
        if(remaining<=0){this.stopVideo();void this.rejectVideo();}
        else this.upgradeTimer=setTimeout(()=>{this.stopVideo();void this.rejectVideo();},remaining);
      }
    }
    if(call.media==='video'&&call.status!=='ringing'&&this.media&&this.mediaKind==='audio'){
      // Only an explicit local request/accept may reuse the staged camera.
      if(!this.upgradePhase||this.videoDisabled){this.stopVideo();void this.audioOnly();return;}
      this.upgradePhase=null;this.mediaKind='video';this.update({videoStopped:false,speaker:true});
    }
    if(call.media==='video'){
      this.clearVideoTimer();
      const remaining=Math.min(7000,(call.videoValidUntil??0)-this.now());
      if(remaining<=0){this.stopVideo();if(!this.downgrading)void this.audioOnly();return;}
      this.videoTimer=setTimeout(()=>{this.stopVideo();void this.audioOnly();},remaining);
      // Once a local safety check stops capture, server refreshes cannot restart it.
      if(this.videoDisabled){if(!this.downgrading)void this.audioOnly();return;}
    }
    if(call.status==='ringing')return;
    if(this.negotiation===call.generation)return;
    this.negotiation=call.generation;this.mediaReady=false;this.serial=Promise.resolve();const epoch=this.epoch;
    const current=()=>!this.disposed&&epoch===this.epoch&&this.state.call?.id===call.id&&this.state.call.generation===call.generation&&this.negotiation===call.generation;
    try{
      if(!this.media){
        // A reloaded process cannot silently reacquire the microphone for an
        // already accepted call. End it and let the user place a fresh call.
        await this.hangUp();return;
      }
      const configuration=await this.deps.api.turn(call.id);
      if(!current())return;
      if(configuration.media&&configuration.media!==call.media){await this.refresh();return;}
      this.update({connected:false});
      this.renewRelayAt=configuration.expiresAt*1000-60000;
      this.media.connect(configuration,signal=>{
        if(!current())return;
        const payload={...signal,callId:call.id,generation:call.generation};
        if(payload.kind==='offer'){this.offer=payload;this.lastOffer=this.now();}
        void this.deps.signal(payload).catch(()=>undefined);
      },(connected,failed)=>{
        if(!current())return;
        this.update({connected});
        if(connected)this.disconnectedAt=null;
        else this.disconnectedAt??=this.now();
        if(connected)this.offer=null;
        if(failed)this.disconnectedAt??=this.now();
      },blocked=>{
        if(current())this.update({playbackBlocked:blocked});
      });
      this.mediaReady=true;
      this.disconnectedAt=null;
      this.media.mute(this.state.muted);this.media.speaker(this.state.speaker);
      this.media.hold?.(this.held);
      if(call.deviceRole==='caller')await this.media.offer();
      if(!current())return;
      const queued=this.signals;this.signals=[];for(const signal of queued)this.receive(signal);
    }catch(error){if(current()){this.error(error);await this.hangUp();}}
  }
  receive(signal:CallSignal){
    const call=this.state.call;
    if(!this.disposed&&!this.ending&&call&&!terminal(call)&&call.id===signal.callId&&signal.generation>call.generation){
      if(this.signals.length<64)this.signals.push(signal);
      void this.stateChanged(call.id);return;
    }
    if(this.disposed||this.ending||!call||terminal(call)||call.id!==signal.callId||call.generation!==signal.generation||call.deviceRole==='observer')return;
    // Permission/relay setup may still be resolving when the first offer/ICE
    // arrives. Queue and serialize before touching the peer connection.
    if(!this.media||!this.mediaReady||this.negotiation!==call.generation){if(this.signals.length<64)this.signals.push(signal);return;}
    const media=this.media,epoch=this.epoch;
    const current=()=>!this.disposed&&epoch===this.epoch&&this.state.call?.id===signal.callId&&this.state.call.generation===signal.generation&&this.negotiation===signal.generation;
    this.serial=this.serial.then(async()=>{if(current())await media.receive(signal);}).catch(error=>{if(current()){this.error(error);void this.hangUp();}});
  }
  async pulse(){
    if(this.pumping||this.disposed)return;
    this.pumping=true;
    try{
      if(this.ending){await this.finishEnding();return;}
      await this.refresh();
      const call=this.state.call;
      if(call&&!terminal(call)&&call.deviceRole!=='observer'){
        if(this.now()>Date.parse(call.deadlineAt)){await this.hangUp();return;}
        if(this.disconnectedAt!==null&&this.now()-this.disconnectedAt>15000){await this.hangUp();return;}
        if(call.deviceRole==='caller'&&this.disconnectedAt!==null&&this.now()-this.disconnectedAt>=3000&&this.recoveryAttempts<2){
          this.recoveryAttempts++;
          await this.apply(await this.deps.api.command(call.id,'restart',call.version));return;
        }
        if(call.deviceRole==='caller'&&call.status==='connected'&&this.now()>=this.renewRelayAt){
          await this.apply(await this.deps.api.command(call.id,'restart',call.version));return;
        }
        if(call.status!=='ringing')await this.apply(await this.deps.api.lease(call.id,call.generation,this.state.connected));
        if(this.offer&&this.now()-this.lastOffer>=3000){this.lastOffer=this.now();await this.deps.signal(this.offer);}
      }
    }catch{
      if(this.media&&this.now()-this.lastServerContact>20000){this.error(new Error('Connection lost. The call has ended.'));await this.hangUp();}
    }finally{this.pumping=false;}
  }
  async stateChanged(id:string){if(!this.disposed&&(!this.state.call||terminal(this.state.call)||this.state.call.id===id))await this.refresh().catch(()=>undefined);}
  async resumePlayback(){
    const media=this.media,epoch=this.epoch;
    try{
      await media?.resumePlayback?.();
      if(epoch===this.epoch&&!this.disposed)this.update({playbackBlocked:false,error:null});
    }catch(error){if(epoch===this.epoch)this.error(error);}
  }
  mute(){const muted=!this.state.muted;this.media?.mute(muted);this.update({muted});}
  setMuted(id:string,muted:boolean){if(this.state.call?.id!==id)return;this.media?.mute(muted);this.update({muted});}
  hold(id:string,held:boolean){if(this.state.call?.id!==id)return;this.held=held;this.media?.hold?.(held);if(held&&(this.state.call.media==='video'||this.state.call.videoUpgrade||this.upgradePhase))void this.audioOnly();}
  async requestVideo(){await this.upgradeVideo(false);}
  async acceptVideo(){await this.upgradeVideo(true);}
  private async upgradeVideo(accept:boolean){
    const call=this.state.call,media=this.media;
    if(!call||terminal(call)||call.media!=='audio'||call.status!=='connected'||call.deviceRole==='observer'||this.state.busy||!media)return;
    const own=call.deviceRole==='caller'?call.callerId:call.calleeId;
    if(accept?(!call.videoUpgrade||call.videoUpgrade.requestedBy===own):Boolean(call.videoUpgrade))return;
    const epoch=this.epoch;
    this.upgradePhase=accept?'accepting':'preparing';this.videoDisabled=false;this.update({busy:true,error:null});
    const frames=this.videoCallback(),videoEpoch=this.videoEpoch;
    const current=()=>!this.disposed&&epoch===this.epoch&&videoEpoch===this.videoEpoch&&this.state.call?.id===call.id;
    try{
      if(!media.prepareVideo)throw new UserFacingError('Update the app to switch this call to video.');
      await media.prepareVideo(frames);
      if(!current()){media.stopVideo?.();return;}
      const latest=await this.deps.api.get(call.id);
      if(!current())return;
      if(latest.media!=='audio'||latest.status!=='connected'||latest.generation!==call.generation
        ||(accept?(!latest.videoUpgrade||latest.videoUpgrade.requestedBy===own||latest.videoUpgrade.expiresAt<=this.now()):Boolean(latest.videoUpgrade)))
        throw new UserFacingError('The call changed. Keep audio and try again.');
      this.upgradePhase=accept?'accepting':'waiting';
      let result:AudioCall;
      try{result=await this.deps.api.command(call.id,accept?'accept-video':'request-video',latest.version);}
      catch(error){
        const recovered=await this.deps.api.get(call.id);
        if((accept&&recovered.media==='video')||(!accept&&recovered.videoUpgrade?.requestedBy===own))result=recovered;else throw error;
      }
      if(current())await this.apply(result);
    }catch(error){if(current()){this.stopVideo();this.error(error);await this.refresh().catch(()=>undefined);}}
    finally{if(epoch===this.epoch)this.update({busy:false});}
  }
  async rejectVideo(){
    this.stopVideo();
    const call=this.state.call;if(!call||terminal(call)||call.media!=='audio'||!call.videoUpgrade||call.deviceRole==='observer')return;
    const epoch=this.epoch;
    try{
      const latest=await this.deps.api.get(call.id);
      const result=latest.media==='audio'&&latest.videoUpgrade?await this.deps.api.command(call.id,'reject-video',latest.version):latest;
      if(epoch===this.epoch)await this.apply(result);
    }catch(error){if(epoch===this.epoch)this.error(error);}
  }
  async audioOnly(){
    this.stopVideo();
    if(this.downgrading)return;
    const call=this.state.call;
    if(call?.media==='audio'&&call.videoUpgrade){await this.rejectVideo();return;}
    if(!call||terminal(call)||call.media!=='video'||call.deviceRole==='observer')return;
    this.downgrading=true;
    try{await this.apply(await this.deps.api.command(call.id,'audio',call.version));}
    catch(error){this.error(error);await this.refresh().catch(()=>undefined);}
    finally{this.downgrading=false;}
  }
  pauseVideo(){if(this.upgradePhase||this.mediaKind==='video'||this.state.call?.media==='video'){this.stopVideo();if(this.state.call?.media==='video')void this.audioOnly();else if(this.state.call?.videoUpgrade)void this.rejectVideo();}}
  async flipCamera(){try{if(this.state.call?.media==='video'&&!this.videoDisabled)await this.media?.flipCamera?.();}catch(error){this.error(error);}}
  speaker(){const speaker=!this.state.speaker;this.media?.speaker(speaker);this.update({speaker});}
  dispose(){if(this.disposed)return;const call=this.state.call;this.stopMedia();this.disposed=true;if(call&&!terminal(call)&&call.deviceRole!=='observer')void this.deps.api.command(call.id,'end',call.version).catch(()=>undefined);}
}
