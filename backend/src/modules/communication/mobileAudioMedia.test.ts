import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
const requireMobile=createRequire(resolve('../mobile/package.json'));
const ts=requireMobile('typescript') as {transpileModule:(text:string,options:object)=>{outputText:string};ModuleKind:{CommonJS:number};ScriptTarget:{ES2022:number}};
interface Signal {kind:string;sdp?:string;candidate?:unknown;}
interface Media {connect:(config:unknown,send:(signal:Signal)=>void,state:(connected:boolean,failed:boolean)=>void)=>void;offer:()=>Promise<void>;receive:(signal:Signal)=>Promise<void>;mute:(muted:boolean)=>void;speaker:(enabled:boolean)=>void;hold:(held:boolean)=>void;prepareVideo:(changed:(value:unknown)=>void)=>Promise<void>;stopVideo:()=>void;flipCamera:()=>Promise<void>;close:()=>void;}
function fixture(available=true,denied:'camera'|'microphone'|null=null){
  const tracks=denied==='microphone'?[]:[{kind:'audio',enabled:true,stop:()=>{stopped++;}}];let stopped=0,cameraStopped=0,flipped=0,released=0,started=0,ended=0,loaded=0;
  const camera={kind:'video',enabled:true,stop:()=>{cameraStopped++;},_switchCamera:()=>{flipped++;}};
  class Stream {id='remote';tracks:{kind:string}[]=[];addTrack(track:{kind:string}){this.tracks.push(track);}getTracks(){return this.tracks;}getVideoTracks(){return this.tracks.filter(track=>track.kind==='video');}release(){}toURL(){return 'remote';}}
  const speakers:boolean[]=[],constraints:unknown[]=[],sent:Signal[]=[],added:unknown[]=[];
  const remoteTrack={enabled:true};
  class Peer {
    static latest:Peer;
    remoteDescription:unknown=null;connectionState='new';closed=false;
    events=new Map<string,(value:unknown)=>void>();
    constructor(public configuration:unknown){Peer.latest=this;}
    close(){this.closed=true;}
    addEventListener(name:string,fn:(value:unknown)=>void){this.events.set(name,fn);}
    addTrack(track:unknown){added.push(track);}
    getReceivers(){return [{track:remoteTrack}];}
    async createOffer(){return {type:'offer',sdp:'offer'};}
    async createAnswer(){return {type:'answer',sdp:'answer'};}
    async setLocalDescription(_value:unknown){}
    async setRemoteDescription(value:unknown){this.remoteDescription=value;}
    async addIceCandidate(value:unknown){ice.push(value);}
  }
  const ice:unknown[]=[];
  const manager={start:()=>{started++;},stop:()=>{ended++;},setForceSpeakerphoneOn:(value:boolean)=>{speakers.push(value);}};
  const moduleExports:Record<string,unknown>={};
  const code=ts.transpileModule(readFileSync('../mobile/src/services/calling/audioMedia.native.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  runInNewContext(code,{exports:moduleExports,Promise,Error,require:(name:string)=>{
    if(name==='react-native')return {NativeModules:available?{WebRTCModule:{},InCallManager:{}}:{},Platform:{OS:'ios',Version:26}};
    loaded++;
    if(name==='react-native-webrtc')return {RTCPeerConnection:Peer,MediaStream:Stream,mediaDevices:{getUserMedia:async(value:unknown)=>{constraints.push(value);if((value as {video:unknown}).video&&denied!=='camera'&&(value as {audio:unknown}).audio!==false)tracks.push(camera);const captured=(value as {audio:unknown}).audio===false?(denied==='camera'?[]:[camera]):tracks;return {id:'local',getAudioTracks:()=>captured.filter(track=>track.kind==='audio'),getVideoTracks:()=>captured.filter(track=>track.kind==='video'),getTracks:()=>captured,addTrack:(track:typeof camera)=>{captured.push(track);},removeTrack:(track:unknown)=>{const index=captured.indexOf(track as typeof camera);if(index>=0)captured.splice(index,1);},release:()=>{released++;}};}}};
    if(name==='react-native-incall-manager')return manager;
    throw new Error(`Unexpected module ${name}`);
  }});
  return {prepare:moduleExports.prepareAudioMedia as (kind?:'audio'|'video',changed?:(value:unknown)=>void)=>Promise<Media>,available:moduleExports.audioMediaAvailable as ()=>boolean,
    tracks,remoteTrack,constraints,speakers,sent,added,ice,Peer,camera,get cameraStopped(){return cameraStopped;},get flipped(){return flipped;},get stopped(){return stopped;},get released(){return released;},get started(){return started;},get ended(){return ended;},get loaded(){return loaded;}};
}
test('native adapter requests audio only, keeps tracks disabled before acceptance and releases all resources',async()=>{
  const f=fixture();const media=await f.prepare();assert.equal(JSON.stringify(f.constraints[0]),'{"audio":true,"video":false}');assert.equal(f.tracks[0].enabled,false);
  media.connect({iceServers:[],iceTransportPolicy:'relay'},value=>f.sent.push(value),()=>undefined);
  assert.equal((f.Peer.latest.configuration as {iceTransportPolicy:string}).iceTransportPolicy,'relay');
  assert.equal(f.tracks[0].enabled,true);assert.equal(f.added.length,1);assert.equal(f.started,1);
  media.mute(true);assert.equal(f.tracks[0].enabled,false);media.mute(false);assert.equal(f.tracks[0].enabled,true);
  media.speaker(true);assert.equal(f.speakers.at(-1),true);await media.offer();assert.equal(f.sent[0].kind,'offer');
  media.close();media.close();assert.equal(f.stopped,1);assert.equal(f.released,1);assert.equal(f.ended,1);assert.equal(f.Peer.latest.closed,true);
});
test('ICE waits for the remote description and repeated offers reuse the cached answer',async()=>{
  const f=fixture();const media=await f.prepare();media.connect({iceServers:[],iceTransportPolicy:'relay'},value=>f.sent.push(value),()=>undefined);
  const candidate={candidate:'relay-candidate',sdpMid:null,sdpMLineIndex:0};await media.receive({kind:'ice',candidate});assert.equal(f.ice.length,0);
  await media.receive({kind:'offer',sdp:'remote'});assert.equal(f.ice.length,1);assert.equal(f.sent.at(-1)?.kind,'answer');
  await media.receive({kind:'offer',sdp:'remote'});assert.equal(f.sent.filter(s=>s.kind==='answer').length,2);media.close();
});
test('direct and relayed ICE candidates reach the peer and native ICE retains TURN fallback',async()=>{
  const f=fixture();const media=await f.prepare();
  const configuration={iceTransportPolicy:'all',iceServers:[
    {urls:['stun:turn.example.test:3478']},
    {urls:['turn:turn.example.test:3478?transport=udp','turns:turn.example.test:443?transport=tcp'],username:'expires:call:user',credential:'short-lived'},
  ]};
  media.connect(configuration,value=>f.sent.push(value),()=>undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(f.Peer.latest.configuration)),configuration);
  const candidates=[
    'candidate:1 1 udp 2130706431 192.168.1.2 50000 typ host',
    'candidate:2 1 udp 1694498815 198.51.100.2 50001 typ srflx raddr 192.168.1.2 rport 50000',
    'candidate:3 1 udp 16777215 203.0.113.2 49160 typ relay raddr 198.51.100.2 rport 50001',
  ].map(candidate=>({candidate,sdpMid:'0',sdpMLineIndex:0}));
  for(const candidate of candidates){
    f.Peer.latest.events.get('icecandidate')?.({candidate});
    await media.receive({kind:'ice',candidate});
  }
  assert.equal(f.ice.length,0);
  await media.receive({kind:'offer',sdp:'remote'});
  assert.deepEqual(JSON.parse(JSON.stringify(f.sent.filter(value=>value.kind==='ice').map(value=>value.candidate))),candidates);
  assert.deepEqual(f.ice,candidates);media.close();
});
test('missing native modules report unavailable without importing the native packages',async()=>{
  const f=fixture(false);assert.equal(f.available(),false);await assert.rejects(f.prepare(),/updated development build/);assert.equal(f.loaded,0);
});
test('system hold pauses sending and playback without losing the user mute setting',async()=>{
  const f=fixture();const media=await f.prepare();media.connect({iceServers:[],iceTransportPolicy:'relay'},()=>undefined,()=>undefined);
  media.mute(true);media.hold(true);assert.equal(f.tracks[0].enabled,false);assert.equal(f.remoteTrack.enabled,false);
  media.hold(false);assert.equal(f.tracks[0].enabled,false);assert.equal(f.remoteTrack.enabled,true);
  media.mute(false);assert.equal(f.tracks[0].enabled,true);media.close();
});

test('native video captures only on request, can flip, and releases camera while preserving microphone',async()=>{
  const f=fixture(),media=await f.prepare('video');assert.equal(f.camera.enabled,false);
  media.connect({iceServers:[],iceTransportPolicy:'all'},()=>undefined,()=>undefined);assert.equal(f.camera.enabled,true);
  await media.flipCamera();assert.equal(f.flipped,1);media.stopVideo();assert.equal(f.cameraStopped,1);assert.equal(f.tracks[0].enabled,true);
  media.close();assert.equal(f.stopped,1);assert.equal(f.cameraStopped,1);
});


test('an offer finishing after reconnect cannot configure or signal the replacement peer',async()=>{
  const f=fixture(),media=await f.prepare();
  const connect=()=>media.connect({iceTransportPolicy:'all',iceServers:[]},value=>f.sent.push(value),()=>undefined);
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
  const connect=()=>media.connect({iceTransportPolicy:'all',iceServers:[]},value=>f.sent.push(value),()=>undefined);
  connect();const old=f.Peer.latest;let finish!:()=>void;
  old.setRemoteDescription=()=>new Promise(resolve=>{finish=resolve;});
  const pending=media.receive({kind:'offer',sdp:'old-remote'});connect();let answers=0;
  f.Peer.latest.createAnswer=async()=>{answers++;return {type:'answer',sdp:'replacement-answer'};};
  finish();await pending;
  assert.equal(answers,0);assert.equal(f.sent.length,0);media.close();
});


test('native video does not mount a remote renderer until its stream contains a video track',async()=>{
  const f=fixture(),frames:{local:unknown;remote:unknown}[]=[];
  const media=await f.prepare('video',value=>frames.push(value as {local:unknown;remote:unknown}));
  media.connect({iceServers:[],iceTransportPolicy:'all'},()=>undefined,()=>undefined);
  assert.equal(frames.at(-1)?.remote,null,'RTCView must not bind to an empty stream');
  f.Peer.latest.events.get('track')?.({track:{kind:'video',stop(){}}});
  assert.ok(frames.at(-1)?.remote,'publish the populated stream for its first renderer mount');
  media.connect({iceServers:[],iceTransportPolicy:'all'},()=>undefined,()=>undefined);
  assert.equal(frames.at(-1)?.remote,null,'a replacement peer waits for its own track');media.close();
});


test('upgrading stages a disabled camera without replacing the microphone or sending video on an audio peer',async()=>{
  const f=fixture(),media=await f.prepare();
  const connect=(kind:string)=>media.connect({media:kind,iceTransportPolicy:'all',iceServers:[]},()=>undefined,()=>undefined);
  connect('audio');await media.prepareVideo(()=>undefined);
  assert.equal(f.constraints.length,2);assert.equal((f.constraints[1] as {audio:unknown}).audio,false);
  assert.equal(f.camera.enabled,false);assert.equal(f.tracks[0].enabled,true);
  connect('audio');assert.equal(f.camera.enabled,false,'reconnecting audio must not transmit the staged camera');
  connect('video');assert.equal(f.camera.enabled,true);media.stopVideo();assert.equal(f.cameraStopped,1);
  media.close();assert.equal(f.stopped,1);
});


test('native partial permission grants cannot silently start a video-only or audio-only video call',async()=>{
  const camera=fixture(true,'camera');await assert.rejects(camera.prepare('video'),/Allow camera/);
  assert.equal(camera.stopped,1);assert.equal(camera.Peer.latest,undefined);
  const microphone=fixture(true,'microphone');await assert.rejects(microphone.prepare('video'),/Allow microphone/);
  assert.equal(microphone.cameraStopped,1);assert.equal(microphone.Peer.latest,undefined);
});
