import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

const requireMobile=createRequire(resolve('../mobile/package.json'));
const ts=requireMobile('typescript') as {transpileModule:(text:string,options:object)=>{outputText:string};ModuleKind:{CommonJS:number};ScriptTarget:{ES2022:number}};
interface Signal {kind:string;sdp?:string;candidate?:unknown;}
interface Media {
  connect:(configuration:unknown,send:(value:Signal)=>void,state:(connected:boolean,failed:boolean)=>void,blocked:(value:boolean)=>void)=>void;
  offer:()=>Promise<void>;receive:(signal:Signal)=>Promise<void>;mute:(value:boolean)=>void;hold:(value:boolean)=>void;
  prepareVideo:(changed:(value:unknown)=>void)=>Promise<void>;stopVideo:()=>void;resumePlayback:()=>Promise<void>;close:()=>void;
}
function fixture(){
  let stopped=0,cameraStopped=0,removed=0,blocked=false,permissionError:Error|null=null;
  const constraints:unknown[]=[],sent:Signal[]=[],states:unknown[]=[],playback:boolean[]=[],ice:unknown[]=[];
  const mic={kind:'audio',enabled:true,stop:()=>{stopped++;}};
  const camera={kind:'video',enabled:true,stop:()=>{cameraStopped++;}};
  const localTracks=[mic];
  class Stream {
    tracks:unknown[]=[];
    addTrack(track:unknown){this.tracks.push(track);}
    getTracks(){return this.tracks;}
    getAudioTracks(){return this.tracks.filter(track=>(track as {kind:string}).kind==='audio');}
    getVideoTracks(){return this.tracks.filter(track=>(track as {kind:string}).kind==='video');}
    removeTrack(track:unknown){this.tracks=this.tracks.filter(value=>value!==track);}
  }
  const audio={autoplay:false,hidden:false,muted:false,srcObject:null as Stream|null,setAttribute(){},pause(){},
    play:async()=>{if(blocked)throw new Error('autoplay blocked');},remove:()=>{removed++;}};
  class Peer {
    static latest:Peer;
    events=new Map<string,(value?:unknown)=>void>();remoteDescription:unknown=null;connectionState='new';closed=false;
    constructor(public configuration:unknown){Peer.latest=this;}
    addEventListener(name:string,fn:(event?:unknown)=>void){this.events.set(name,fn);}
    addTrack(){}
    close(){this.closed=true;}
    async createOffer(){return {type:'offer',sdp:'offer'};}
    async createAnswer(){return {type:'answer',sdp:'answer'};}
    async setLocalDescription(){}
    async setRemoteDescription(value:unknown){this.remoteDescription=value;}
    async addIceCandidate(value:unknown){ice.push(value);}
  }
  const exports:Record<string,unknown>={};
  const context={exports,Error,Promise,window:{isSecureContext:true},RTCPeerConnection:Peer,MediaStream:Stream,
    navigator:{mediaDevices:{getUserMedia:async(value:unknown)=>{
      constraints.push(value);if(permissionError)throw permissionError;
      if((value as {video:unknown}).video&&(value as {audio:unknown}).audio!==false)localTracks.push(camera);
      const captured=(value as {audio:unknown}).audio===false?[camera]:localTracks;
      return {id:'local',getAudioTracks:()=>captured.filter(track=>track.kind==='audio'),getVideoTracks:()=>captured.filter(track=>track.kind==='video'),getTracks:()=>captured,addTrack:(track:typeof camera)=>{captured.push(track);},removeTrack:(track:unknown)=>{const index=captured.indexOf(track as typeof mic);if(index>=0)captured.splice(index,1);}};
    }}},document:{createElement:()=>audio,body:{appendChild(){}}}};
  runInNewContext(ts.transpileModule(readFileSync('../mobile/src/services/calling/audioMedia.web.ts','utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
  }).outputText,context);
  const prepare=exports.prepareAudioMedia as (kind?:'audio'|'video',changed?:(value:{local:unknown;remote:unknown})=>void)=>Promise<Media>;
  return {prepare,available:exports.audioMediaAvailable as ()=>boolean,context,Peer,audio,mic,constraints,sent,states,playback,ice,
    connect:async()=>{const media=await prepare();media.connect({iceTransportPolicy:'all',iceServers:[]},value=>sent.push(value),(...value)=>states.push(value),value=>playback.push(value));return media;},
    setBlocked:(value:boolean)=>{blocked=value;},deny:()=>{permissionError=new Error('denied');permissionError.name='NotAllowedError';},
    camera,get cameraStopped(){return cameraStopped;},get stopped(){return stopped;},get removed(){return removed;}};
}
test('browser media requires a secure context and maps microphone denial without starting a peer',async()=>{
  const f=fixture();f.context.window.isSecureContext=false;assert.equal(f.available(),false);
  await assert.rejects(f.prepare(),/HTTPS or localhost/);assert.equal(f.constraints.length,0);
  f.context.window.isSecureContext=true;f.deny();await assert.rejects(f.prepare(),/Allow microphone/);
  assert.equal(f.Peer.latest,undefined);
});
test('browser audio negotiates direct/TURN candidates, queues ICE, and plays remote audio',async()=>{
  const f=fixture();const prepared=await f.prepare();assert.equal(f.mic.enabled,false);
  prepared.connect({iceTransportPolicy:'all',iceServers:[{urls:['stun:turn.example.test:3478']},{urls:['turn:turn.example.test:3478'],username:'short',credential:'lived'}]},
    value=>f.sent.push(value),(...value)=>f.states.push(value),value=>f.playback.push(value));
  assert.equal(f.mic.enabled,true);assert.equal(JSON.stringify(f.constraints[0]),'{"audio":true,"video":false}');
  assert.equal((f.Peer.latest.configuration as {iceTransportPolicy:string}).iceTransportPolicy,'all');
  const candidate={candidate:'candidate:1 1 udp 100 198.51.100.1 50000 typ srflx',sdpMid:'0',sdpMLineIndex:0};
  f.Peer.latest.events.get('icecandidate')?.({candidate});await prepared.receive({kind:'ice',candidate});assert.equal(f.ice.length,0);
  await prepared.receive({kind:'offer',sdp:'remote'});assert.equal(f.ice.length,1);
  await prepared.receive({kind:'offer',sdp:'remote'});assert.equal(f.sent.filter(value=>value.kind==='answer').length,2);
  f.Peer.latest.events.get('track')?.({track:{kind:'audio'}});await new Promise(done=>setImmediate(done));
  assert.equal(f.audio.srcObject?.tracks.length,1);assert.equal(f.playback.at(-1),false);
  f.Peer.latest.connectionState='connected';f.Peer.latest.events.get('connectionstatechange')?.();
  assert.deepEqual(f.states.at(-1),[true,false]);prepared.close();
});
test('autoplay denial offers a user-gesture retry; hold, mute and cleanup control actual media',async()=>{
  const f=fixture(),media=await f.connect();f.setBlocked(true);
  f.Peer.latest.events.get('track')?.({track:{kind:'audio'}});await new Promise(done=>setImmediate(done));
  assert.equal(f.playback.at(-1),true);f.setBlocked(false);await media.resumePlayback();assert.equal(f.playback.at(-1),false);
  media.mute(true);media.hold(true);media.hold(false);assert.equal(f.mic.enabled,false);assert.equal(f.audio.muted,false);
  media.mute(false);assert.equal(f.mic.enabled,true);media.close();media.close();
  assert.equal(f.stopped,1);assert.equal(f.removed,1);assert.equal(f.audio.srcObject,null);assert.equal(f.Peer.latest.closed,true);
});
test('late events from an old negotiation cannot attach audio or change the active connection',async()=>{
  const f=fixture(),media=await f.connect(),old=f.Peer.latest;
  media.connect({iceTransportPolicy:'all',iceServers:[]},value=>f.sent.push(value),(...value)=>f.states.push(value),value=>f.playback.push(value));
  old.connectionState='failed';old.events.get('connectionstatechange')?.();old.events.get('track')?.({track:{kind:'audio'}});
  assert.equal(f.states.length,0);assert.equal(f.audio.srcObject?.tracks.length,0);assert.equal(old.closed,true);media.close();
});

test('video requires explicit camera capture, renders remote video and stops the camera without stopping audio',async()=>{
  const f=fixture(),frames:{local:unknown;remote:unknown}[]=[];const media=await f.prepare('video',value=>frames.push(value));
  assert.equal(f.camera.enabled,false);assert.ok((f.constraints[0] as {video:unknown}).video);
  media.connect({iceTransportPolicy:'all',iceServers:[]},()=>undefined,()=>undefined,()=>undefined);
  assert.equal(f.camera.enabled,true);assert.equal(f.mic.enabled,true);
  f.Peer.latest.events.get('track')?.({track:{kind:'video',stop(){}}});assert.ok(frames.at(-1)?.remote);
  media.stopVideo();assert.equal(f.cameraStopped,1);assert.equal(f.mic.enabled,true);assert.equal(frames.at(-1)?.local,null);
  media.close();assert.equal(f.stopped,1);assert.equal(f.cameraStopped,1);
});


test('an offer finishing after reconnect cannot configure or signal the replacement peer',async()=>{
  const f=fixture(),media=await f.prepare();
  const connect=()=>media.connect({iceTransportPolicy:'all',iceServers:[]},value=>f.sent.push(value),()=>undefined,()=>undefined);
  connect();const old=f.Peer.latest;
  let finish!:(value:{type:string;sdp:string})=>void;
  old.createOffer=()=>new Promise(resolve=>{finish=resolve;});
  const pending=media.offer();connect();let descriptions=0;
  f.Peer.latest.setLocalDescription=async()=>{descriptions++;};
  finish({type:'offer',sdp:'old-offer'});await pending;
  assert.equal(descriptions,0);assert.equal(f.sent.length,0);media.close();
});

test('an incoming offer finishing after reconnect cannot answer on the replacement peer',async()=>{
  const f=fixture(),media=await f.prepare();
  const connect=()=>media.connect({iceTransportPolicy:'all',iceServers:[]},value=>f.sent.push(value),()=>undefined,()=>undefined);
  connect();const old=f.Peer.latest;let finish!:()=>void;
  old.setRemoteDescription=()=>new Promise(resolve=>{finish=resolve;});
  const pending=media.receive({kind:'offer',sdp:'old-remote'});connect();let answers=0;
  f.Peer.latest.createAnswer=async()=>{answers++;return {type:'answer',sdp:'replacement-answer'};};
  finish();await pending;
  assert.equal(answers,0);assert.equal(f.sent.length,0);media.close();
});


test('upgrading stages a disabled camera without replacing the microphone or sending video on an audio peer',async()=>{
  const f=fixture(),media=await f.prepare();
  const connect=(kind:string)=>media.connect({media:kind,iceTransportPolicy:'all',iceServers:[]},()=>undefined,()=>undefined,()=>undefined);
  connect('audio');await media.prepareVideo(()=>undefined);
  assert.equal(f.constraints.length,2);assert.equal((f.constraints[1] as {audio:unknown}).audio,false);
  assert.equal(f.camera.enabled,false);assert.equal(f.mic.enabled,true);
  connect('audio');assert.equal(f.camera.enabled,false,'reconnecting audio must not transmit the staged camera');
  connect('video');assert.equal(f.camera.enabled,true);media.stopVideo();assert.equal(f.cameraStopped,1);
  media.close();assert.equal(f.stopped,1);
});
