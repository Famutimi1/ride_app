import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

const mobileRequire=createRequire(resolve('../mobile/package.json'));
const ts=mobileRequire('typescript') as {transpileModule:(text:string,options:object)=>{outputText:string};ModuleKind:{CommonJS:number};ScriptTarget:{ES2022:number}};
const moduleExports:Record<string,unknown>={};
runInNewContext(ts.transpileModule(readFileSync('../mobile/src/services/calling/CallController.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:moduleExports,Date,Math,Promise,Error,setTimeout,clearTimeout});
interface Call {id:string;tripId:string;callerId:string;calleeId:string;media:string;videoValidUntil?:number;videoUpgrade?:{requestedBy:string;expiresAt:number}|null;status:string;version:number;generation:number;deviceRole:string;deadlineAt:string;connectedAt:string|null;endedAt:string|null;endReason:string|null;createdAt:string;}
interface Signal {callId:string;generation:number;kind:string;sdp?:string;}
interface Snapshot {call:Call|null;busy:boolean;muted:boolean;speaker:boolean;connected:boolean;error:string|null;playbackBlocked?:boolean;}
interface Controller {start:(id:string,kind?:'audio'|'video')=>Promise<void>;accept:()=>Promise<void>;refresh:()=>Promise<void>;pulse:()=>Promise<void>;receive:(signal:Signal)=>void;hangUp:()=>Promise<void>;mute:()=>void;speaker:()=>void;dispose:()=>void;answerFromNative:(id:string)=>Promise<void>;endFromNative:(id:string)=>Promise<void>;resumePlayback:()=>Promise<void>;audioOnly:()=>Promise<void>;pauseVideo:()=>void;requestVideo:()=>Promise<void>;acceptVideo:()=>Promise<void>;rejectVideo:()=>Promise<void>;}
const tick=()=>new Promise(done=>setImmediate(done));
const deferred=<T>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve};};
function fixture(role='caller',kind='audio'){
  let now=100000;
  let call:Call={id:'call',tripId:'trip',callerId:'rider',calleeId:'driver',media:kind,videoValidUntil:now+7000,status:'ringing',version:1,generation:1,deviceRole:role,deadlineAt:new Date(now+30000).toISOString(),connectedAt:null,endedAt:null,endReason:null,createdAt:new Date(now).toISOString()};
  let state:Snapshot={call:null,busy:false,muted:false,speaker:false,connected:false,error:null};
  let prepareFailure=false,offline=false,loseStart=false;
  let prepareWait:ReturnType<typeof deferred<unknown>>|null=null,turnWait:ReturnType<typeof deferred<unknown>>|null=null;
  let connection:((connected:boolean,failed:boolean)=>void)|null=null;
  let playback:((blocked:boolean)=>void)|undefined;
  let playbackDenied=false;
  let receiveWait:ReturnType<typeof deferred<unknown>>|null=null;
  let emit:((signal:{kind:string;sdp?:string})=>void)|null=null;
  const log={preparedVideo:0,stoppedVideo:0,prepared:[] as string[],closed:0,connected:0,offered:0,received:[] as Signal[],started:[] as string[],commands:[] as string[],muted:[] as boolean[],speakers:[] as boolean[],signals:[] as Signal[]};
  const media={
    connect:(_config:unknown,send:typeof emit,changed:typeof connection,blocked:typeof playback)=>{log.connected++;emit=send;connection=changed;playback=blocked;},
    prepareVideo:async()=>{log.preparedVideo++;if(prepareFailure)throw new Error('Camera denied');if(prepareWait)await prepareWait.promise;},
    stopVideo:()=>{log.stoppedVideo++;},
    resumePlayback:async()=>{if(playbackDenied)throw new Error('Tap Enable call audio');},
    offer:async()=>{log.offered++;emit?.({kind:'offer',sdp:'offer'});},
    receive:async(signal:Signal)=>{log.received.push(signal);if(receiveWait)await receiveWait.promise;},
    mute:(value:boolean)=>{log.muted.push(value);},speaker:(value:boolean)=>{log.speakers.push(value);},close:()=>{log.closed++;},
  };
  const api={
    active:async()=>{if(offline)throw new Error('offline');return call.endedAt?null:{...call};},
    get:async()=>{if(offline)throw new Error('offline');return {...call};},
    start:async(_trip:string,key:string)=>{log.started.push(key);if(loseStart){loseStart=false;throw new Error('response lost');}return {...call};},
    command:async(_id:string,action:string,version:number)=>{
      if(offline)throw new Error('offline');log.commands.push(action);assert.equal(version,call.version);
      if(action==='request-video'){call={...call,version:call.version+1,videoUpgrade:{requestedBy:call.deviceRole==='caller'?call.callerId:call.calleeId,expiresAt:now+30000}};return {...call};}
      if(action==='reject-video'){call={...call,version:call.version+1,videoUpgrade:null};return {...call};}
      if(action==='accept-video'){call={...call,media:'video',videoUpgrade:null,status:'connecting',generation:call.generation+1,version:call.version+1,videoValidUntil:now+7000};return {...call};}
      const negotiating=action==='accept'||action==='restart'||action==='audio';
      call={...call,version:call.version+1,generation:call.generation+(['restart','audio'].includes(action)?1:0),media:action==='audio'?'audio':call.media,status:action==='audio'&&call.status==='ringing'?'ringing':negotiating?'connecting':'ended',endedAt:negotiating?null:new Date(now).toISOString()};return {...call};
    },
    turn:async()=>turnWait?turnWait.promise:{iceTransportPolicy:'all',iceServers:[],expiresAt:(now+120000)/1000},
    lease:async(_id:string,_generation:number,connected:boolean)=>{if(offline)throw new Error('offline');if(connected)call={...call,status:'connected',connectedAt:new Date(now).toISOString(),version:call.version+1};return {...call};},
  };
  const Constructor=moduleExports.CallController as new(deps:unknown)=>Controller;
  const controller=new Constructor({api,now:()=>now,requestId:()=> 'request',changed:(value:Snapshot)=>{state=value;},signal:async(value:Signal)=>{log.signals.push(value);},prepare:async(mediaKind='audio')=>{log.prepared.push(mediaKind);if(prepareFailure)throw new Error('Microphone denied');if(prepareWait)await prepareWait.promise;return media;}});
  return {controller,log,get state(){return state;},get call(){return call;},setCall:(value:Partial<Call>)=>{call={...call,...value};},connect:()=>connection?.(true,false),disconnect:()=>connection?.(false,false),advance:(ms:number)=>{now+=ms;},deny:()=>{prepareFailure=true;},offline:(value=true)=>{offline=value;},loseStart:()=>{loseStart=true;},waitPrepare:()=>prepareWait=deferred(),waitTurn:()=>turnWait=deferred(),waitReceive:()=>receiveWait=deferred(),blockPlayback:()=>playback?.(true),denyPlayback:(value:boolean)=>{playbackDenied=value;}};
}

test('browser autoplay recovery stays in the active controller and stale callbacks cannot restore its prompt',async()=>{
  const f=fixture();await f.controller.start('trip');f.setCall({status:'connecting',version:2});await f.controller.refresh();
  f.blockPlayback();assert.equal(f.state.playbackBlocked,true);f.denyPlayback(true);await f.controller.resumePlayback();
  assert.equal(f.state.playbackBlocked,true);assert.match(f.state.error??'',/Enable call audio/);
  f.denyPlayback(false);await f.controller.resumePlayback();assert.equal(f.state.playbackBlocked,false);assert.equal(f.state.error,null);
  await f.controller.hangUp();f.blockPlayback();assert.equal(f.state.playbackBlocked,false);f.controller.dispose();
});

test('caller keeps its prepared microphone until acceptance and reports connection after media connects',async()=>{
  const f=fixture();await f.controller.start('trip');assert.equal(f.log.closed,0);assert.equal(f.state.call?.status,'ringing');assert.equal(f.log.offered,0);
  f.setCall({status:'connecting',version:2});await f.controller.refresh();assert.equal(f.log.connected,1);assert.equal(f.log.offered,1);assert.equal(f.state.connected,false);
  f.connect();await f.controller.pulse();assert.equal(f.state.connected,true);assert.equal(f.state.call?.status,'connected');f.controller.dispose();assert.equal(f.log.closed,1);
});
test('a lost initiate response retries with the identical request key',async()=>{
  const f=fixture();f.loseStart();await f.controller.start('trip');assert.deepEqual(f.log.started,['request','request']);assert.equal(f.log.closed,0);f.controller.dispose();
});
test('microphone denial never rings the other participant',async()=>{
  const f=fixture();f.deny();await f.controller.start('trip');assert.equal(f.log.started.length,0);assert.equal(f.state.call,null);assert.match(f.state.error??'',/Microphone denied/);
});
test('logout while microphone permission is pending closes the late stream and never starts a call',async()=>{
  const f=fixture();const wait=f.waitPrepare();const start=f.controller.start('trip');await tick();f.controller.dispose();wait.resolve(null);await start;assert.equal(f.log.closed,1);assert.equal(f.log.started.length,0);
});
test('incoming offer and ICE wait for TURN/media setup and are drained exactly once in order',async()=>{
  const f=fixture('receiver');await f.controller.refresh();const wait=f.waitTurn();const accepting=f.controller.accept();await tick();
  const offer={callId:'call',generation:1,kind:'offer',sdp:'peer-offer'},ice={callId:'call',generation:1,kind:'ice'};
  f.controller.receive(offer);f.controller.receive(ice);assert.equal(f.log.received.length,0);
  wait.resolve({iceTransportPolicy:'all',iceServers:[]});await accepting;await tick();assert.deepEqual(f.log.received,[offer,ice]);f.controller.dispose();
});
test('old calls and negotiation generations cannot deliver media signals',async()=>{
  const f=fixture();await f.controller.start('trip');f.setCall({status:'connecting',version:2});await f.controller.refresh();
  f.controller.receive({callId:'another-call',generation:1,kind:'offer'});f.controller.receive({callId:'call',generation:0,kind:'offer'});await tick();assert.equal(f.log.received.length,0);f.controller.dispose();
});
test('mute and speaker controls act on the media adapter',async()=>{
  const f=fixture();await f.controller.start('trip');f.controller.mute();f.controller.mute();f.controller.speaker();assert.deepEqual(f.log.muted,[true,false]);assert.deepEqual(f.log.speakers,[true]);f.controller.dispose();
});
test('hangup releases microphone immediately and retries server confirmation without restarting media',async()=>{
  const f=fixture();await f.controller.start('trip');f.offline();await f.controller.hangUp();assert.equal(f.log.closed,1);assert.ok(f.state.call?.endedAt);
  await f.controller.pulse();assert.equal(f.log.connected,0);f.offline(false);await f.controller.pulse();assert.deepEqual(f.log.commands,['cancel']);f.controller.dispose();
});
test('late TURN response cannot create media after hangup',async()=>{
  const f=fixture();await f.controller.start('trip');f.setCall({status:'connecting',version:2});const wait=f.waitTurn();const refresh=f.controller.refresh();await tick();await f.controller.hangUp();
  wait.resolve({iceTransportPolicy:'all',iceServers:[]});await refresh;assert.equal(f.log.connected,0);assert.equal(f.log.closed,1);f.controller.dispose();
});
test('unanswered calls stop at the server deadline',async()=>{
  const f=fixture();await f.controller.start('trip');f.advance(31000);await f.controller.pulse();assert.ok(f.state.call?.endedAt);assert.equal(f.log.closed,1);f.controller.dispose();
});
test('server loss releases local microphone instead of extending an unconfirmed call',async()=>{
  const f=fixture();await f.controller.start('trip');f.setCall({status:'connecting',version:2});await f.controller.refresh();f.offline();f.advance(21000);await f.controller.pulse();assert.equal(f.log.closed,1);assert.ok(f.state.call?.endedAt);f.controller.dispose();
});
test('a process reload ends an accepted call rather than reacquiring microphone without a gesture',async()=>{
  const f=fixture();f.setCall({status:'connecting',version:2});await f.controller.refresh();assert.deepEqual(f.log.commands,['end']);assert.equal(f.log.connected,0);f.controller.dispose();
});
test('relay credentials renew through a new negotiation before expiry',async()=>{
  const f=fixture();await f.controller.start('trip');f.setCall({status:'connecting',version:2});await f.controller.refresh();f.connect();await f.controller.pulse();
  f.setCall({deadlineAt:new Date(300000).toISOString()});f.advance(61000);await f.controller.pulse();
  assert.deepEqual(f.log.commands,['restart']);assert.equal(f.state.call?.generation,2);assert.equal(f.log.connected,2);f.controller.dispose();
});
test('a signal from the next authorized generation triggers reconciliation without losing the offer',async()=>{
  const f=fixture('receiver');await f.controller.refresh();await f.controller.accept();f.setCall({generation:2,version:3});
  const offer={callId:'call',generation:2,kind:'offer',sdp:'new-generation'};f.controller.receive(offer);await tick();
  assert.equal(f.state.call?.generation,2);assert.deepEqual(f.log.received,[offer]);f.controller.dispose();
});
test('a stalled media connection closes even while the API remains reachable',async()=>{
  const f=fixture();await f.controller.start('trip');f.setCall({status:'connecting',version:2});await f.controller.refresh();f.connect();await f.controller.pulse();
  f.disconnect();f.advance(16000);await f.controller.pulse();assert.ok(f.state.call?.endedAt);assert.equal(f.log.closed,1);f.controller.dispose();
});
test('a system answer recovers the incoming call and accepts it only once',async()=>{
  const f=fixture('receiver');await f.controller.answerFromNative('call');await f.controller.answerFromNative('call');
  assert.deepEqual(f.log.commands,['accept']);assert.equal(f.log.connected,1);f.controller.dispose();
});
test('a system end releases local media immediately during a network outage',async()=>{
  const f=fixture();await f.controller.start('trip');f.offline();await f.controller.endFromNative('call');assert.equal(f.log.closed,1);assert.ok(f.state.call?.endedAt);f.controller.dispose();
});
test('network handover retries negotiation with a bounded recovery budget',async()=>{
  const f=fixture();await f.controller.start('trip');f.setCall({status:'connecting',version:2});await f.controller.refresh();f.connect();await f.controller.pulse();
  f.disconnect();f.advance(4000);await f.controller.pulse();assert.equal(f.state.call?.generation,2);
  f.disconnect();f.advance(4000);await f.controller.pulse();assert.equal(f.state.call?.generation,3);
  f.disconnect();f.advance(4000);await f.controller.pulse();assert.equal(f.state.call?.generation,3);
  f.advance(12000);await f.controller.pulse();assert.ok(f.state.call?.endedAt);assert.equal(f.log.closed,1);f.controller.dispose();
});

test('video safety expiry stops capture and downgrades rather than silently re-enabling the camera',async()=>{
  const f=fixture('caller','video');await f.controller.start('trip','video');assert.deepEqual(f.log.prepared,['video']);
  f.setCall({status:'connecting',version:2,videoValidUntil:0});await f.controller.refresh();await tick();
  assert.ok(f.log.stoppedVideo>0);assert.ok(f.log.commands.includes('audio'));assert.equal(f.state.call?.media,'audio');f.controller.dispose();
});
test('native answer of a video invite obtains audio only and never requests a camera',async()=>{
  const f=fixture('receiver','video');await f.controller.answerFromNative('call');
  assert.deepEqual(f.log.prepared,['audio']);assert.deepEqual(f.log.commands,['audio','accept']);assert.equal(f.state.call?.media,'audio');f.controller.dispose();
});

test('a fresh video invitation resets the previous call camera-off state without granting camera access',async()=>{
  const f=fixture('receiver','video');await f.controller.refresh();await f.controller.audioOnly();await f.controller.hangUp();
  f.setCall({id:'second-call',media:'video',status:'ringing',version:1,generation:1,endedAt:null,videoValidUntil:107000});
  await f.controller.refresh();assert.equal(f.state.call?.media,'video');assert.deepEqual(f.log.prepared,[]);f.controller.dispose();
});

test('backgrounding during camera permission closes the late stream without placing a video call',async()=>{
  const f=fixture('caller','video'),wait=f.waitPrepare();const pending=f.controller.start('trip','video');await tick();
  f.controller.pauseVideo();wait.resolve(null);await pending;assert.equal(f.log.started.length,0);assert.equal(f.log.closed,1);f.controller.dispose();
});
test('a safety downgrade during camera permission answers audio using the latest call version',async()=>{
  const f=fixture('receiver','video');await f.controller.refresh();const wait=f.waitPrepare(),answer=f.controller.accept();await tick();
  f.setCall({media:'audio',version:2,generation:2});await f.controller.refresh();wait.resolve(null);await answer;
  assert.equal(f.state.call?.media,'audio');assert.ok(f.log.stoppedVideo>0);assert.deepEqual(f.log.commands,['accept']);f.controller.dispose();
});


test('a new generation discards queued old signals and does not wait for a stalled old operation',async()=>{
  const f=fixture('receiver');await f.controller.refresh();await f.controller.accept();
  const wait=f.waitReceive();
  f.controller.receive({callId:'call',generation:1,kind:'offer',sdp:'stalled-old-offer'});await tick();
  f.controller.receive({callId:'call',generation:1,kind:'ice'});
  f.setCall({generation:2,version:3});await f.controller.refresh();
  f.controller.receive({callId:'call',generation:2,kind:'offer',sdp:'current-offer'});await tick();
  assert.deepEqual(f.log.received.map(signal=>signal.sdp),['stalled-old-offer','current-offer']);
  wait.resolve(null);await tick();
  assert.equal(f.log.received.some(signal=>signal.kind==='ice'),false);f.controller.dispose();
});


async function activeAudio(role='caller'){
  const f=fixture(role);
  if(role==='caller'){await f.controller.start('trip');f.setCall({status:'connecting',version:2});await f.controller.refresh();}
  else{await f.controller.refresh();await f.controller.accept();}
  f.connect();await f.controller.pulse();return f;
}
test('requesting video keeps the same audio peer until the other participant accepts',async()=>{
  const f=await activeAudio();await f.controller.requestVideo();
  assert.equal(f.state.call?.media,'audio');assert.equal(f.state.connected,true);assert.equal(f.log.connected,1);assert.equal(f.log.preparedVideo,1);
  f.setCall({media:'video',videoUpgrade:null,status:'connecting',version:5,generation:2});await f.controller.refresh();
  assert.equal(f.log.connected,2);assert.equal(f.state.call?.media,'video');assert.equal(f.log.prepared.length,1);f.controller.dispose();
});
test('rejecting a video request releases the staged camera and preserves the ongoing audio call',async()=>{
  const f=await activeAudio();await f.controller.requestVideo();await f.controller.rejectVideo();
  assert.equal(f.state.call?.media,'audio');assert.equal(f.state.connected,true);assert.equal(f.log.closed,0);assert.ok(f.log.stoppedVideo>0);assert.equal(f.state.call?.videoUpgrade,null);f.controller.dispose();
});
test('receiving a video request never opens a camera until explicitly accepted',async()=>{
  const f=await activeAudio('receiver');f.setCall({videoUpgrade:{requestedBy:'rider',expiresAt:130000},version:4});await f.controller.refresh();
  assert.equal(f.log.preparedVideo,0);await f.controller.acceptVideo();assert.equal(f.log.preparedVideo,1);assert.equal(f.state.call?.media,'video');assert.equal(f.log.closed,0);f.controller.dispose();
});
test('camera denial during an upgrade preserves audio and does not send an upgrade request',async()=>{
  const f=await activeAudio();f.deny();await f.controller.requestVideo();assert.equal(f.state.call?.media,'audio');assert.equal(f.state.connected,true);
  assert.equal(f.log.commands.includes('request-video'),false);assert.equal(f.log.closed,0);assert.match(f.state.error??'',/Camera denied/);f.controller.dispose();
});
test('an unexpected server video transition cannot acquire a camera without local upgrade consent',async()=>{
  const f=await activeAudio();f.setCall({media:'video',status:'connecting',version:4,generation:2});await f.controller.refresh();await tick();
  assert.equal(f.log.preparedVideo,0);assert.equal(f.state.call?.media,'audio');assert.ok(f.log.commands.includes('audio'));f.controller.dispose();
});


test('cancelling while camera permission is pending never sends a video request or stops audio',async()=>{
  const f=await activeAudio(),wait=f.waitPrepare();const request=f.controller.requestVideo();await tick();
  f.controller.pauseVideo();wait.resolve(null);await request;
  assert.equal(f.log.commands.includes('request-video'),false);assert.equal(f.state.call?.media,'audio');assert.equal(f.state.connected,true);assert.equal(f.log.closed,0);f.controller.dispose();
});
test('an expired video request releases the camera and keeps the audio peer',async()=>{
  const f=await activeAudio();await f.controller.requestVideo();f.advance(31000);await f.controller.refresh();await tick();
  assert.equal(f.state.call?.videoUpgrade,null);assert.equal(f.state.call?.media,'audio');assert.equal(f.log.closed,0);assert.ok(f.log.stoppedVideo>0);f.controller.dispose();
});
