import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

// Exercise the actual mobile store/helpers using the installed Zustand and TS.
// Only native storage and network I/O are controlled; no application DB is used.
const mobileRequire=createRequire(resolve('../mobile/package.json'));
const compiler=mobileRequire('typescript') as {transpileModule:(text:string,options:object)=>{outputText:string};ModuleKind:{CommonJS:number};ScriptTarget:{ES2022:number}};
const {createStore}=mobileRequire('zustand/vanilla') as {createStore:(initializer:unknown)=>unknown};
interface Message {id:string;recordId?:string;tripId:string;senderId:string;senderRole:'rider'|'driver';text:string;sentAt:number;sequence?:string;localStatus?:string;attempts?:number;retryAt?:number}
interface Receipts {tripId:string;version:string;rider:{deliveredSequence:string;readSequence:string};driver:{deliveredSequence:string;readSequence:string}}
interface Conversation {draft:string;details:unknown;messages:Message[];synchronizedSequence:string;receipts:Receipts|null;error:string|null;loading:boolean}
interface State {
  userId:string|null;generation:number;hydrated:boolean;conversations:Record<string,Conversation>;
  setContext:(id:string|null)=>void;hydrate:()=>Promise<void>;synchronize:(tripId:string)=>Promise<void>;
  receive:(message:Message)=>void;enqueue:(tripId:string,text:string)=>Promise<void>;retry:(tripId:string,id:string)=>Promise<void>;
  flush:(tripId:string)=>Promise<void>;markRead:(tripId:string)=>Promise<void>;
  discard:(tripId:string,id:string)=>Promise<void>;
  setDraft:(tripId:string,text:string)=>Promise<void>;
}
const tripId='11111111-1111-4111-8111-111111111111';
const account='account';
const key=`rakky-chat-pending-v1:${account}`;
const historyKey=`rakky-chat-history-v1:${account}`;
const tick=()=>new Promise(done=>setImmediate(done));
const incoming=(sequence:number):Message=>({id:`incoming-${sequence}`,recordId:String(sequence),tripId,senderId:'peer',senderRole:'driver',text:`Message ${sequence}`,sentAt:Date.now(),sequence:String(sequence)});
function fixture(storage=new Map<string,string>(),messages:Message[]=[]) {
  let failStorage=false,offline=false,loseAck=false;
  let pendingResponse:((message:Message)=>Promise<Message>)|null=null;
  const sent:{id:string;text:string;savedBeforeSend:boolean}[]=[];
  const receiptCalls:{kind:string;sequence:string}[]=[];
  const receipts:Receipts={tripId,version:'0',rider:{deliveredSequence:'0',readSequence:'0'},driver:{deliveredSequence:'0',readSequence:'0'}};
  const clone=<T>(value:T):T=>JSON.parse(JSON.stringify(value)) as T;
  const api={
    getTripCommunication:async()=>{
      if(offline)throw new Error('offline');
      return {tripId,status:'open',participant:{id:'peer',name:'Peer'},participantRole:'rider',canRead:true,canMessage:true,canAudioCall:false,canVideoCall:false,maxMessageLength:2000,
        highWaterSequence:String(messages.length),receipts:clone(receipts),unavailableReason:null};
    },
    getTripMessages:async(_id:string,params:Record<string,string>)=>{
      if(offline)throw new Error('offline');
      const rows=messages.filter(m=>Number(m.sequence)>Number(params.afterSeq??0)&&Number(m.sequence)<=Number(params.throughSeq??messages.length));
      const page=rows.slice(0,2);
      return {messages:clone(page),nextAfter:rows.length>2?page.at(-1)!.sequence:null,nextBefore:null,highWaterSequence:params.throughSeq??String(messages.length),receipts:clone(receipts)};
    },
    persistTripMessage:async(_id:string,input:{id:string;text:string})=>{
      const persisted=storage.get(key)??'';
      sent.push({...input,savedBeforeSend:persisted.includes(input.id)});
      if(offline)throw new Error('offline');
      let message=messages.find(m=>m.id===input.id&&m.senderId===account);
      if(!message){message={...input,tripId,recordId:String(messages.length+1),senderId:account,senderRole:'rider',sequence:String(messages.length+1),sentAt:Date.now()};messages.push(message);}
      if(loseAck){loseAck=false;throw new Error('ack lost after server commit');}
      return pendingResponse?pendingResponse(clone(message)):clone(message);
    },
    updateChatReceipt:async(_id:string,kind:'delivered'|'read',sequence:string)=>{
      receiptCalls.push({kind,sequence});
      if(kind==='read')assert.ok(Number(sequence)<=Number(receipts.rider.deliveredSequence));
      if(kind==='delivered')receipts.rider.deliveredSequence=sequence;else receipts.rider.readSequence=sequence;
      receipts.version=String(Number(receipts.version)+1);return clone(receipts);
    },
  };
  const modules=new Map<string,Record<string,unknown>>();
  function load(path:string):Record<string,unknown>{
    if(modules.has(path))return modules.get(path)!;
    const exports:Record<string,unknown>={};modules.set(path,exports);
    const code=compiler.transpileModule(readFileSync(resolve('../mobile/src',path),'utf8'),{compilerOptions:{module:compiler.ModuleKind.CommonJS,target:compiler.ScriptTarget.ES2022}}).outputText;
    runInNewContext(code,{exports,Date,Math,Map,Promise,Error,require:(name:string)=>{
      if(name==='zustand')return {create:createStore};
      if(name==='expo-modules-core')return {uuid:{v4:randomUUID}};
      if(name==='axios')return {isAxiosError:(error:{isAxiosError?:boolean})=>error?.isAxiosError===true};
      if(name==='@/services/communicationService')return api;
      if(name==='@/utils/chatMessages')return load('utils/chatMessages.ts');
      if(name==='@react-native-async-storage/async-storage')return {__esModule:true,default:{
        getItem:async(key:string)=>storage.get(key)??null,
        setItem:async(key:string,value:string)=>{if(failStorage)throw new Error('storage full');storage.set(key,value);},
        removeItem:async(key:string)=>{storage.delete(key);},
      }};
      throw new Error(`Unexpected mobile chat import ${name}`);
    }});
    return exports;
  }
  const store=load('store/chatStore.ts').useChatStore as {getState:()=>State};
  return {state:store.getState,storage,messages,sent,receipts,receiptCalls,api,helpers:load('utils/chatMessages.ts'),
    failStorage:(value:boolean)=>{failStorage=value;},offline:(value:boolean)=>{offline=value;},loseAck:()=>{loseAck=true;},
    deferResponse:(fn:(message:Message)=>Promise<Message>)=>{pendingResponse=fn;},
    start:async()=>{store.getState().setContext(account);await store.getState().hydrate();await store.getState().synchronize(tripId);},
  };
}

test('mobile pending queue saves before sending and reconciles a lost acknowledgement after app restart',async()=>{
  const storage=new Map<string,string>(),server:Message[]=[];
  const first=fixture(storage,server);await first.start();first.loseAck();
  await first.state().enqueue(tripId,'Pickup entrance');await first.state().flush(tripId);
  assert.equal(first.sent.length,1);assert.equal(first.sent[0].savedBeforeSend,true);
  assert.equal(first.state().conversations[tripId].messages[0].localStatus,'pending');
  const originalId=first.sent[0].id;
  const restarted=fixture(storage,server);await restarted.start();await restarted.state().flush(tripId);
  assert.equal(restarted.sent.length,0);assert.equal(server.length,1);
  assert.equal(restarted.state().conversations[tripId].messages[0].id,originalId);
  assert.equal(restarted.state().conversations[tripId].messages[0].localStatus,'sent');
  assert.equal(JSON.parse(storage.get(key)!).messages.length,0);
});

test('offline retry keeps the original UUID and never marks an unacknowledged message sent',async()=>{
  const h=fixture();await h.start();h.offline(true);
  await h.state().enqueue(tripId,'Please wait');await h.state().flush(tripId);
  const message=h.state().conversations[tripId].messages[0];
  assert.equal(message.localStatus,'pending');assert.equal(message.recordId,undefined);assert.equal(h.messages.length,0);
  h.offline(false);await h.state().retry(tripId,message.id);
  assert.equal(h.sent.length,2);assert.equal(h.sent[0].id,h.sent[1].id);assert.equal(h.messages.length,1);
  assert.equal(h.state().conversations[tripId].messages[0].localStatus,'sent');
});

test('device storage failure blocks transmission and leaves a failed message for deliberate retry',async()=>{
  const h=fixture();await h.start();h.failStorage(true);
  await assert.rejects(h.state().enqueue(tripId,'Keep safe locally'),/device/);
  await tick();assert.equal(h.sent.length,0);
  const message=h.state().conversations[tripId].messages[0];assert.equal(message.localStatus,'failed');
  h.failStorage(false);await h.state().retry(tripId,message.id);
  assert.equal(h.sent.length,1);assert.equal(h.sent[0].savedBeforeSend,true);
});

test('a failed pending message can be discarded without sending or losing other pending work',async()=>{
  const h=fixture();await h.start();h.failStorage(true);
  await assert.rejects(h.state().enqueue(tripId,'Discard me'));
  const message=h.state().conversations[tripId].messages[0];h.failStorage(false);
  await h.state().discard(tripId,message.id);
  assert.equal(h.state().conversations[tripId].messages.length,0);assert.equal(h.sent.length,0);
  assert.equal(JSON.parse(h.storage.get(key)!).messages.length,0);
});

test('live messages do not skip synchronization gaps or advance cumulative read receipts',async()=>{
  const h=fixture(new Map(),[incoming(1),incoming(2)]);await h.start();
  assert.equal(h.state().conversations[tripId].synchronizedSequence,'2');
  h.state().receive(incoming(4));await h.state().markRead(tripId);
  assert.equal(h.receipts.rider.readSequence,'2');
  h.messages.push(incoming(3),incoming(4));await h.state().synchronize(tripId);await h.state().markRead(tripId);
  assert.equal(h.receipts.rider.readSequence,'4');
  const messages=h.state().conversations[tripId].messages;
  assert.equal(messages.length,4);assert.deepEqual(messages.map(m=>m.sequence).join(','),'1,2,3,4');
});

test('late network results cannot repopulate another account and logout clears pending storage',async()=>{
  const h=fixture();await h.start();let finish!:(message:Message)=>void;
  h.deferResponse(message=>new Promise(resolve=>{finish=()=>resolve(message);}));
  await h.state().enqueue(tripId,'Old account pending');const flushing=h.state().flush(tripId);
  await tick();assert.equal(h.sent.length,1);
  h.state().setContext('other-account');await h.state().hydrate();
  finish(incoming(1));await flushing;await tick();
  assert.equal(h.state().userId,'other-account');assert.equal(Object.keys(h.state().conversations).length,0);
  assert.equal(h.storage.has(key),false);
});

test('history pages and receipt-only updates are synchronized without relying on new messages',async()=>{
  const h=fixture(new Map(),Array.from({length:12},(_,i)=>incoming(i+1)));await h.start();
  const messages=h.state().conversations[tripId].messages;assert.equal(messages.length,12);assert.equal(messages[9].sequence,'10');
  h.receipts.version='50';h.receipts.driver.readSequence='12';
  await h.state().synchronize(tripId);assert.equal(h.state().conversations[tripId].receipts!.version,'50');
});

test('confirmed messages survive a cold restart with the API offline and reconcile without duplicate bubbles',async()=>{
  const storage=new Map<string,string>(),server=[incoming(1),incoming(2)];
  const first=fixture(storage,server);await first.start();
  await first.state().enqueue(tripId,'My persisted reply');await first.state().flush(tripId);
  assert.ok(storage.has(historyKey));
  const restarted=fixture(storage,server);restarted.offline(true);
  restarted.state().setContext(account);await restarted.state().hydrate();
  await restarted.state().synchronize(tripId);
  const restored=restarted.state().conversations[tripId];
  assert.equal(restored.messages.length,3);assert.equal(restored.messages[2].text,'My persisted reply');
  assert.equal(restored.details,null);assert.equal(restored.synchronizedSequence,'0');
  assert.ok(restored.error);assert.equal(restarted.sent.length,0);
  restarted.offline(false);server.push(incoming(4));await restarted.state().synchronize(tripId);
  assert.equal(restarted.state().conversations[tripId].messages.length,4);
  assert.equal(restarted.state().conversations[tripId].synchronizedSequence,'4');
});

test('same-account navigation/context refresh retains history; logout removes the account cache',async()=>{
  const h=fixture(new Map(),[incoming(1)]);await h.start();
  const generation=h.state().generation;
  h.state().setContext(account);await h.state().synchronize(tripId);
  assert.equal(h.state().generation,generation);assert.equal(h.state().conversations[tripId].messages.length,1);
  h.state().setContext(null);await tick();
  assert.equal(Object.keys(h.state().conversations).length,0);assert.equal(h.storage.has(historyKey),false);
  assert.equal(h.storage.has(key),false);
});

test('unsent drafts survive navigation and offline restart and clear on send or logout without leaking accounts',async()=>{
  const storage=new Map<string,string>(),h=fixture(storage);await h.start();
  await h.state().setDraft(tripId,'Still typing my pickup instructions');
  h.state().setContext(account);assert.equal(h.state().conversations[tripId].draft,'Still typing my pickup instructions');
  const restart=fixture(storage);restart.offline(true);restart.state().setContext(account);await restart.state().hydrate();
  assert.equal(restart.state().conversations[tripId].draft,'Still typing my pickup instructions');assert.equal(restart.sent.length,0);
  await restart.state().setDraft(tripId,'');
  const cleared=fixture(storage);cleared.state().setContext(account);await cleared.state().hydrate();
  assert.equal(cleared.state().conversations[tripId]?.draft??'','');
  await h.state().setDraft(tripId,'Account-private draft');h.state().setContext('other-account');await h.state().hydrate();
  assert.equal(h.state().conversations[tripId]?.draft??'','');assert.equal(storage.has(`rakky-chat-drafts-v1:${account}`),false);
});

test('bounded cache cannot advance receipts past missing history or restore a different account payload',async()=>{
  const server=Array.from({length:205},(_,i)=>({...incoming(i+1),sentAt:1000})),storage=new Map<string,string>();
  const first=fixture(storage,server);await first.start();
  const saved=JSON.parse(storage.get(historyKey)!);assert.equal(saved.conversations[0].messages.length,200);
  const restored=fixture(storage,server);restored.offline(true);restored.state().setContext(account);await restored.state().hydrate();
  assert.equal(restored.state().conversations[tripId].messages[0].sequence,'6');
  assert.equal(restored.state().conversations[tripId].messages.at(-1)?.sequence,'205');
  assert.equal(restored.state().conversations[tripId].synchronizedSequence,'0');
  await restored.state().markRead(tripId);assert.equal(restored.receiptCalls.length,0);
  restored.offline(false);await restored.state().synchronize(tripId);
  assert.equal(restored.state().conversations[tripId].messages.length,205);
  const foreign=fixture(new Map([[historyKey,JSON.stringify({...saved,userId:'different-account'})]]));
  foreign.offline(true);foreign.state().setContext(account);await foreign.state().hydrate();
  assert.equal(Object.keys(foreign.state().conversations).length,0);
});

test('server authorization rejection removes previously cached confirmed history',async()=>{
  const h=fixture(new Map(),[incoming(1)]);await h.start();
  h.api.getTripCommunication=async()=>{throw {isAxiosError:true,response:{status:404,data:{error:'trip_not_found'}}};};
  await h.state().synchronize(tripId);await tick();
  assert.equal(h.state().conversations[tripId].messages.length,0);
  assert.equal(JSON.parse(h.storage.get(historyKey)!).conversations.length,0);
});

test('corrupt, expired and foreign-account saved pending data is not restored',async()=>{
  const saved={...incoming(1),recordId:undefined,sequence:undefined,localStatus:'pending'};
  const storage=new Map([[key,JSON.stringify({version:1,messages:[saved,{...saved,senderId:account,sentAt:Date.now()-25*60*60*1000}]})]]);
  const h=fixture(storage);await h.start();assert.equal(h.state().conversations[tripId].messages.length,0);
  const corrupt=fixture(new Map([[key,'broken json']]));await corrupt.start();assert.equal(corrupt.state().hydrated,true);
});

test('message merge keys include sender identity and receipt versions never move backwards',()=>{
  const h=fixture();
  const merge=h.helpers.mergeChatMessages as (current:Message[],incoming:Message[])=>Message[];
  const first={...incoming(1),id:'same-client-key'},second={...incoming(2),id:'same-client-key',senderId:account};
  assert.equal(merge([first],[second]).length,2);
  assert.equal(merge([first],[{...first,recordId:undefined,sequence:undefined}])[0].recordId,first.recordId);
  const newer=h.helpers.newerReceipts as (current:Receipts,incoming:Receipts)=>Receipts;
  assert.equal(newer({...h.receipts,version:'10'},{...h.receipts,version:'9'}).version,'10');
});


test('network retry attempts and backoff survive a cold restart without an immediate resend',async()=>{
  const storage=new Map<string,string>(),h=fixture(storage);await h.start();h.offline(true);
  await h.state().enqueue(tripId,'Keep the retry schedule');await h.state().flush(tripId);
  const pending=h.state().conversations[tripId].messages[0];
  const saved=JSON.parse(storage.get(key)!).messages[0];
  assert.equal(saved.attempts,pending.attempts);assert.equal(saved.retryAt,pending.retryAt);
  const restarted=fixture(storage);await restarted.start();await restarted.state().flush(tripId);
  assert.equal(restarted.sent.length,0);assert.equal(restarted.state().conversations[tripId].messages[0].retryAt,pending.retryAt);
  await restarted.state().retry(tripId,pending.id);assert.equal(restarted.sent.length,1);
});

test('exhausted automatic retries remain failed after restart until the user retries',async()=>{
  const h=fixture();await h.start();h.offline(true);
  await h.state().enqueue(tripId,'Do not reset exhausted retries');await h.state().flush(tripId);
  const first=h.state().conversations[tripId].messages[0];
  // Seed the final automatic attempt with an already elapsed retry deadline.
  h.state().conversations[tripId].messages[0]={...first,attempts:4,retryAt:0};
  await h.state().flush(tripId);
  const restarted=fixture(h.storage);await restarted.start();await restarted.state().flush(tripId);
  assert.equal(restarted.state().conversations[tripId].messages[0].localStatus,'failed');assert.equal(restarted.sent.length,0);
});


test('a message waiting for retry keeps later pending sends in their original order',async()=>{
  const h=fixture();await h.start();h.offline(true);
  await h.state().enqueue(tripId,'First message');await h.state().flush(tripId);
  h.offline(false);await h.state().enqueue(tripId,'Second message');await h.state().flush(tripId);
  assert.equal(h.sent.length,1);assert.equal(h.messages.length,0);
  const first=h.state().conversations[tripId].messages[0];await h.state().retry(tripId,first.id);
  assert.equal(h.messages.map(message=>message.text).join(','),'First message,Second message');
});


test('pending messages created in the same millisecond keep enqueue order across merges',()=>{
  const h=fixture(),merge=h.helpers.mergeChatMessages as (current:Message[],incoming:Message[])=>Message[];
  const first={...incoming(1),id:'z-first',recordId:undefined,sequence:undefined,sentAt:1000};
  const second={...first,id:'a-second'};
  assert.equal(merge([first],[second]).map(message=>message.id).join(','),'z-first,a-second');
});
