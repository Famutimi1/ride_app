import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
const mobileRequire=createRequire(resolve('../mobile/package.json'));
const ts=mobileRequire('typescript') as {transpileModule:(text:string,options:object)=>{outputText:string};ModuleKind:{CommonJS:number};ScriptTarget:{ES2022:number}};
const moduleExports:Record<string,unknown>={};
runInNewContext(ts.transpileModule(readFileSync('../mobile/src/services/calling/NativeCallCoordinator.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:moduleExports,Date,Promise,Set,Error});
const id='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
interface Event {action:string;callId?:string;value?:boolean;createdAt?:number;}
interface Call {id:string;status:string;endedAt:string|null;}
interface Coordinator {handle:(event:Event)=>Promise<void>;reconcile:()=>Promise<void>;report:(call:Call|null)=>Promise<void>;dispose:()=>Promise<void>;}
function fixture(){
  let current:Call|null=null,online=true,listener:((event:Event)=>void)|null=null;
  let answerWait:Promise<void>|null=null,reportWait:Promise<void>|null=null;
  const pending:Event[]=[],log={answered:0,ended:0,pulses:0,ack:[] as string[],mute:[] as boolean[],held:[] as boolean[],reports:[] as string[],dismissed:[] as string[],disposed:0};
  const controller={
    async recoverIncoming(callId:string){if(!online)throw new Error('offline');if(!current||current.id===callId)current={id:callId,status:'ringing',endedAt:null};},
    async answerFromNative(callId:string){if(!online)throw new Error('offline');log.answered++;if(answerWait)await answerWait;current={id:callId,status:'connecting',endedAt:null};},
    async endFromNative(callId:string){log.ended++;current={id:callId,status:'ended',endedAt:new Date().toISOString()};},
    async pulse(){log.pulses++;},setMuted:(_id:string,value:boolean)=>log.mute.push(value),hold:(_id:string,value:boolean)=>log.held.push(value),
  };
  const bridge={
    async report(call:Call|null){log.reports.push(call?.status??'empty');if(reportWait)await reportWait;},async pending(){return [...pending];},
    async acknowledge(callId:string,action:string){log.ack.push(action);for(let i=pending.length-1;i>=0;i--)if(pending[i].callId===callId&&pending[i].action===action)pending.splice(i,1);},
    async dismiss(callId:string){log.dismissed.push(callId);},subscribe(fn:(event:Event)=>void){listener=fn;return ()=>{listener=null;};},async refreshToken(){},async dispose(){log.disposed++;},
  };
  const Constructor=moduleExports.NativeCallCoordinator as new(bridge:unknown,controller:unknown,current:()=>Call|null)=>Coordinator;
  const coordinator=new Constructor(bridge,controller,()=>current);
  return {coordinator,pending,log,setOnline:(value:boolean)=>{online=value;},setCurrent:(value:Call)=>{current=value;},get current(){return current;},setAnswerWait:(value:Promise<void>)=>{answerWait=value;},setReportWait:(value:Promise<void>)=>{reportWait=value;},emit:(event:Event)=>listener?.(event)};
}
const tick=()=>new Promise(done=>setImmediate(done));
test('cold-start answer stays queued until the authenticated controller can recover',async()=>{
  const f=fixture();f.pending.push({action:'answer',callId:id});f.setOnline(false);await f.coordinator.reconcile();assert.equal(f.pending.length,1);assert.equal(f.log.answered,0);
  f.setOnline(true);await f.coordinator.reconcile();assert.equal(f.log.answered,1);assert.equal(f.pending.length,0);await f.coordinator.dispose();
});
test('duplicate native answer callbacks do not race microphone preparation',async()=>{
  const f=fixture();let resume!:()=>void;f.setAnswerWait(new Promise<void>(done=>{resume=done;}));const first=f.coordinator.handle({action:'answer',callId:id});await tick();
  await f.coordinator.handle({action:'answer',callId:id});assert.equal(f.log.answered,1);resume();await first;await f.coordinator.dispose();
});
test('mute/hold callbacks do not acknowledge and erase a still-pending answer',async()=>{
  const f=fixture();f.pending.push({action:'answer',callId:id});f.setCurrent({id,status:'ringing',endedAt:null});
  await f.coordinator.handle({action:'mute',callId:id,value:true});await f.coordinator.handle({action:'hold',callId:id,value:true});
  await f.coordinator.handle({action:'interruption',callId:id,value:true});await f.coordinator.handle({action:'interruption',callId:id,value:false});
  await f.coordinator.handle({action:'hold',callId:id,value:false});
  assert.equal(f.pending.length,1);assert.deepEqual(f.log.mute,[true]);assert.deepEqual(f.log.held,[true,true,true,false]);await f.coordinator.dispose();
});
test('stale incoming UI is dismissed without replacing a different active call',async()=>{
  const f=fixture();f.setCurrent({id:other,status:'connected',endedAt:null});await f.coordinator.handle({action:'incoming',callId:id});
  assert.equal(f.current?.id,other);assert.deepEqual(f.log.dismissed,[id]);await f.coordinator.dispose();
});
test('native lifecycle reports are serialized so an old connecting update cannot resurrect an ended call',async()=>{
  const f=fixture();let resume!:()=>void;f.setReportWait(new Promise<void>(done=>{resume=done;}));
  const connecting=f.coordinator.report({id,status:'connecting',endedAt:null});await tick();const ending=f.coordinator.report({id,status:'ended',endedAt:new Date().toISOString()});
  await tick();assert.deepEqual(f.log.reports,['connecting']);resume();await Promise.all([connecting,ending]);assert.deepEqual(f.log.reports,['connecting','ended']);await f.coordinator.dispose();
});
test('native watchdog expiry ends the matching call through the shared controller',async()=>{
  const f=fixture();await f.coordinator.handle({action:'expired',callId:id});assert.equal(f.log.ended,1);assert.deepEqual(f.log.ack,['expired']);await f.coordinator.dispose();
});
test('native heartbeats renew calls independently of screen navigation',async()=>{
  const f=fixture();await f.coordinator.handle({action:'pulse',callId:id});assert.equal(f.log.pulses,1);await f.coordinator.dispose();
});
test('logout disposes the native bridge once and ignores late system events',async()=>{
  const f=fixture();await f.coordinator.dispose();await f.coordinator.dispose();f.emit({action:'answer',callId:id});await f.coordinator.handle({action:'answer',callId:id});assert.equal(f.log.answered,0);assert.equal(f.log.disposed,1);
});
test('old OS actions are discarded instead of retrying a previous session indefinitely',async()=>{
  const f=fixture();f.pending.push({action:'answer',callId:id,createdAt:Date.now()-121000});await f.coordinator.reconcile();assert.equal(f.pending.length,0);assert.equal(f.log.answered,0);await f.coordinator.dispose();
});
