import { UserFacingError } from '@/utils/userMessage';
import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { uuid } from 'expo-modules-core';
import { isAxiosError } from 'axios';
import { getTripCommunication, getTripMessages, persistTripMessage, updateChatReceipt, type ChatReceipts, type TripCommunication, type TripMessage } from '@/services/communicationService';
import { compareSequence, mergeChatMessages, newerReceipts, restoreChatHistory, savedChatMessage, serializeChatHistory, type ChatMessage } from '@/utils/chatMessages';

export interface ChatConversation {
  draft: string;
  details: TripCommunication|null;
  messages: ChatMessage[];
  receipts: ChatReceipts|null;
  synchronizedSequence: string;
  loading: boolean;
  loadingOlder: boolean;
  hasOlder: boolean;
  error: string|null;
}
interface ChatState {
  userId: string|null;
  generation: number;
  hydrated: boolean;
  conversations: Record<string,ChatConversation>;
  setContext: (userId:string|null)=>void;
  setDraft: (tripId:string,text:string)=>Promise<void>;
  hydrate: ()=>Promise<void>;
  synchronize: (tripId:string)=>Promise<void>;
  loadOlder: (tripId:string)=>Promise<void>;
  receive: (message:TripMessage)=>void;
  receiveReceipts: (receipt:ChatReceipts)=>void;
  enqueue: (tripId:string,text:string)=>Promise<void>;
  retry: (tripId:string,id:string)=>Promise<void>;
  discard: (tripId:string,id:string)=>Promise<void>;
  flush: (tripId:string)=>Promise<void>;
  markRead: (tripId:string)=>Promise<void>;
}
const MAX_PENDING=50;
const PENDING_TTL=24*60*60*1000;
const storageKey=(userId:string)=>`rakky-chat-pending-v1:${userId}`;
const historyKey=(userId:string)=>`rakky-chat-history-v1:${userId}`;
const draftKey=(userId:string)=>`rakky-chat-drafts-v1:${userId}`;
const emptyConversation=():ChatConversation=>({draft:'',details:null,messages:[],receipts:null,synchronizedSequence:'0',loading:false,loadingOlder:false,hasOlder:false,error:null});
const messageError=(error:unknown)=>{
  const code=isAxiosError(error)?error.response?.data?.error:undefined;
  if(code==='trip_messaging_unavailable')return 'This trip conversation is read-only.';
  if(code==='trip_message_rate_limited')return 'Please wait before sending more messages.';
  if(code==='trip_not_found')return 'This conversation is unavailable to your account.';
  if(code==='trip_message_conflict')return 'This message could not be reconciled. Please check the conversation.';
  return 'Could not reconnect. Saved messages and pending sends are kept.';
};

export const useChatStore=create<ChatState>((set,get)=>{
  let storageJobs:Promise<unknown>=Promise.resolve();
  let hydration:{generation:number;promise:Promise<void>}|null=null;
  const syncing=new Map<string,{promise:Promise<void>;again:boolean}>();
  const flushing=new Map<string,Promise<void>>();
  const reading=new Map<string,Promise<void>>();
  const current=(generation:number,userId:string)=>get().generation===generation&&get().userId===userId;
  const change=(tripId:string,update:(conversation:ChatConversation)=>Partial<ChatConversation>)=>set(state=>{
    const value=state.conversations[tripId]??emptyConversation();
    return {conversations:{...state.conversations,[tripId]:{...value,...update(value)}}};
  });
  const storeWork=(work:()=>Promise<unknown>):Promise<void>=>{
    const result=storageJobs.then(work);storageJobs=result.catch(()=>undefined);return result.then(()=>undefined);
  };
  const persistPending=():Promise<void>=>{
    const {userId,generation,conversations}=get();
    if(!userId)return Promise.resolve();
    const messages=Object.values(conversations).flatMap(c=>c.messages).filter(m=>!m.recordId&&m.senderId===userId&&Date.now()-m.sentAt<PENDING_TTL).slice(-MAX_PENDING);
    const serialized=JSON.stringify({version:1,messages});
    const history=serializeChatHistory(userId,conversations);
    return storeWork(async()=>{
      if(!current(generation,userId))return;
      await AsyncStorage.setItem(storageKey(userId),serialized);
      // Pending sends must stay durable even when the optional history cache
      // reaches a device quota. Server history remains authoritative.
      await AsyncStorage.setItem(historyKey(userId),history).catch(()=>undefined);
    });
  };
  const receiveReceipts=(receipt:ChatReceipts)=>{
    if(!get().userId||!get().conversations[receipt.tripId])return;
    change(receipt.tripId,c=>({receipts:newerReceipts(c.receipts,receipt)}));
  };
  return {
    userId:null,generation:0,hydrated:false,conversations:{},
    setContext:userId=>{
      const previous=get();if(previous.userId===userId)return;
      set({userId,generation:previous.generation+1,conversations:{},hydrated:false});
      hydration=null;
      // Serialize deletion behind any in-flight writes from the old account.
      if(previous.userId)void storeWork(()=>Promise.all([
        AsyncStorage.removeItem(storageKey(previous.userId!)),AsyncStorage.removeItem(historyKey(previous.userId!)),AsyncStorage.removeItem(draftKey(previous.userId!)),
      ])).catch(()=>undefined);
      if(userId)void get().hydrate().catch(()=>undefined);
    },
    setDraft:async(tripId,text)=>{
      const {userId,generation}=get();
      if(!userId||!/^[0-9a-f-]{36}$/i.test(tripId))return;
      const draft=[...text].slice(0,2000).join('');
      change(tripId,()=>({draft}));
      // Drafts have a small separate file, so typing does not rewrite history.
      await storeWork(async()=>{
        if(!current(generation,userId))return;
        const drafts=Object.entries(get().conversations).filter(([,c])=>c.draft.length>0)
          .slice(-20).map(([tripId,c])=>({tripId,text:c.draft}));
        await AsyncStorage.setItem(draftKey(userId),JSON.stringify({version:1,userId,drafts}));
      });
    },
    hydrate:()=>{
      const {userId,generation,hydrated}=get();
      if(!userId||hydrated)return Promise.resolve();
      if(hydration?.generation===generation)return hydration.promise;
      const promise=(async()=>{
        await storageJobs;
        const stored=await AsyncStorage.getItem(storageKey(userId));
        const savedHistory=await AsyncStorage.getItem(historyKey(userId)).catch(()=>null);
        const savedDrafts=await AsyncStorage.getItem(draftKey(userId)).catch(()=>null);
        if(!current(generation,userId))return;
        for(const [tripId,messages] of Object.entries(restoreChatHistory(savedHistory,userId))){
          // Restart at sequence zero: a bounded cache may omit older records.
          // Cached content never grants sending or calling authorization.
          change(tripId,c=>({messages:mergeChatMessages(c.messages,messages)}));
        }
        if(savedDrafts&&savedDrafts.length<=200_000){
          try{
            const data=JSON.parse(savedDrafts) as {version?:unknown;userId?:unknown;drafts?:unknown};
            if(data.version===1&&data.userId===userId&&Array.isArray(data.drafts)){
              for(const raw of data.drafts.slice(-20)){
                const draft=raw as {tripId?:unknown;text?:unknown}|null;
                if(draft&&typeof draft.tripId==='string'&&/^[0-9a-f-]{36}$/i.test(draft.tripId)
                  &&typeof draft.text==='string'&&[...draft.text].length<=2000){
                  const text=draft.text;change(draft.tripId,c=>({draft:c.draft||text}));
                }
              }
            }
          }catch{/* Draft corruption never blocks server history recovery. */}
        }
        if(stored){
          let data:{version?:unknown;messages?:unknown};
          try{data=JSON.parse(stored);}catch{data={};}
          if(data.version===1&&Array.isArray(data.messages)){
            for(const raw of data.messages.slice(-MAX_PENDING)){
              const m=raw as Partial<ChatMessage>;
              if(m.senderId!==userId||typeof m.tripId!=='string'||!/^[0-9a-f-]{36}$/i.test(m.tripId)||typeof m.id!=='string'||!m.id||m.id.length>120||typeof m.text!=='string'||!m.text||[...m.text].length>2000
                ||typeof m.sentAt!=='number'||!Number.isFinite(m.sentAt)||m.sentAt>Date.now()+60_000||Date.now()-m.sentAt>PENDING_TTL
                ||(m.senderRole!=='rider'&&m.senderRole!=='driver')||m.recordId)continue;
              const message:ChatMessage={id:m.id,tripId:m.tripId,senderId:userId,senderRole:m.senderRole!,text:m.text,sentAt:m.sentAt,
                localStatus:m.localStatus==='failed'?'failed':'pending',attempts:Number.isSafeInteger(m.attempts)?Math.max(0,Math.min(5,m.attempts!)):0,retryAt:typeof m.retryAt==='number'&&Number.isFinite(m.retryAt)?Math.max(0,Math.min(Date.now()+60_000,m.retryAt)):0};
              change(message.tripId,c=>({messages:mergeChatMessages(c.messages,[message])}));
            }
          }
        }
        if(current(generation,userId))set({hydrated:true});
      })();
      hydration={generation,promise};
      void promise.finally(()=>{if(hydration?.generation===generation)hydration=null;}).catch(()=>undefined);
      return promise;
    },
    synchronize:tripId=>{
      const {userId,generation}=get();if(!userId)return Promise.resolve();
      const key=`${generation}:${tripId}`,active=syncing.get(key);
      if(active){active.again=true;return active.promise;}
      const task={again:false,promise:Promise.resolve()};
      task.promise=(async()=>{
        await get().hydrate();if(!current(generation,userId))return;
        change(tripId,()=>({loading:true,error:null}));
        do{
          task.again=false;
          const details=await getTripCommunication(tripId);
          if(!current(generation,userId))return;
          change(tripId,c=>({details,receipts:newerReceipts(c.receipts,details.receipts),
            messages:c.messages.filter(m=>!m.sequence||compareSequence(m.sequence,details.highWaterSequence)<=0)}));
          let cursor=get().conversations[tripId].synchronizedSequence;
          if(compareSequence(cursor,details.highWaterSequence)>0){
            cursor='0';change(tripId,c=>({messages:c.messages.filter(m=>!m.recordId),synchronizedSequence:'0'}));
          }
          let next:string|null=cursor;
          while(next!==null){
            const page=await getTripMessages(tripId,{afterSeq:next,throughSeq:details.highWaterSequence});
            if(!current(generation,userId))return;
            change(tripId,c=>({messages:mergeChatMessages(c.messages,page.messages.map(savedChatMessage)),
              receipts:newerReceipts(c.receipts,page.receipts),synchronizedSequence:page.nextAfter??page.highWaterSequence}));
            if(page.nextAfter===next)throw new Error('chat_sync_did_not_advance');
            next=page.nextAfter;
          }
          await persistPending();if(!current(generation,userId))return;
          const conversation=get().conversations[tripId];
          const incoming=conversation.messages.filter(m=>m.senderId!==userId&&m.sequence&&compareSequence(m.sequence,conversation.synchronizedSequence)<=0).at(-1);
          const own=details.participantRole==='rider'?conversation.receipts?.rider:conversation.receipts?.driver;
          if(incoming?.sequence&&(!own||compareSequence(incoming.sequence,own.deliveredSequence)>0)){
            const receipt=await updateChatReceipt(tripId,'delivered',incoming.sequence);
            if(!current(generation,userId))return;receiveReceipts(receipt);
          }
        }while(task.again&&current(generation,userId));
      })().catch(error=>{
        if(!current(generation,userId))return;
        const status=isAxiosError(error)?error.response?.status:undefined;
        const denied=status===403||status===404;
        change(tripId,c=>({error:messageError(error),...(denied?{details:null,messages:c.messages.filter(m=>!m.recordId),synchronizedSequence:'0'}:{})}));
        if(denied)void persistPending().catch(()=>undefined);
      })
        .finally(()=>{if(current(generation,userId))change(tripId,()=>({loading:false}));syncing.delete(key);});
      syncing.set(key,task);return task.promise;
    },
    loadOlder:async tripId=>{
      const {userId,generation}=get(),conversation=get().conversations[tripId];
      const first=conversation?.messages.find(m=>m.recordId);
      if(!userId||!first?.recordId||conversation.loadingOlder)return;
      change(tripId,()=>({loadingOlder:true}));
      try{
        const page=await getTripMessages(tripId,{before:first.recordId});
        if(current(generation,userId))change(tripId,c=>({messages:mergeChatMessages(c.messages,page.messages.map(savedChatMessage)),hasOlder:page.nextBefore!==null}));
      }catch(error){if(current(generation,userId))change(tripId,()=>({error:messageError(error)}));}
      finally{if(current(generation,userId))change(tripId,()=>({loadingOlder:false}));}
    },
    receive:message=>{
      const {userId}=get();if(!userId||!get().conversations[message.tripId])return;
      change(message.tripId,c=>({messages:mergeChatMessages(c.messages,[savedChatMessage(message)])}));
      void persistPending().catch(()=>undefined);
      // Live delivery never advances the sync cursor; missing earlier events
      // must still be fetched before acknowledging a cumulative receipt.
    },
    receiveReceipts,
    enqueue:async(tripId,text)=>{
      const {userId,generation}=get();if(!userId)throw new UserFacingError('Sign in to send a message.');
      await get().hydrate();if(!current(generation,userId))return;
      const details=get().conversations[tripId]?.details,value=text.trim();
      if(!details?.canMessage)throw new UserFacingError('This conversation is read-only.');
      if(!value||[...value].length>details.maxMessageLength)throw new UserFacingError(`Messages must contain 1–${details.maxMessageLength} characters.`);
      const pending=Object.values(get().conversations).flatMap(c=>c.messages).filter(m=>!m.recordId&&Date.now()-m.sentAt<PENDING_TTL);
      if(pending.length>=MAX_PENDING)throw new UserFacingError('Reconnect and send your pending messages before adding more.');
      const message:ChatMessage={id:uuid.v4(),tripId,senderId:userId,senderRole:details.participantRole,text:value,sentAt:Date.now(),localStatus:'pending',attempts:0,retryAt:0};
      change(tripId,c=>({messages:mergeChatMessages(c.messages,[message])}));
      try{await persistPending();}
      catch{if(current(generation,userId))change(tripId,c=>({messages:c.messages.map(m=>m.id===message.id?{...m,localStatus:'failed',error:'Could not save on this device.'}:m)}));throw new UserFacingError('Could not save your message on this device. Retry when storage is available.');}
      if(current(generation,userId))void get().flush(tripId);
    },
    retry:async(tripId,id)=>{
      if(!get().userId)return;
      change(tripId,c=>({messages:c.messages.map(m=>m.id===id&&!m.recordId?{...m,localStatus:'pending',attempts:0,retryAt:0,error:undefined}:m)}));
      await persistPending();await get().flush(tripId);
    },
    discard:async(tripId,id)=>{
      const {userId,generation}=get();if(!userId)return;
      const message=get().conversations[tripId]?.messages.find(m=>m.id===id&&!m.recordId&&m.localStatus==='failed');
      if(!message)return;
      change(tripId,c=>({messages:c.messages.filter(m=>m!==message)}));
      try{await persistPending();}
      catch(error){if(current(generation,userId))change(tripId,c=>({messages:mergeChatMessages(c.messages,[message])}));throw error;}
    },
    flush:tripId=>{
      const {userId,generation}=get();if(!userId)return Promise.resolve();
      const key=`${generation}:${tripId}`;if(flushing.has(key))return flushing.get(key)!;
      const promise=(async()=>{
        await get().hydrate();if(!current(generation,userId))return;
        const messages=get().conversations[tripId]?.messages.filter(m=>!m.recordId&&m.localStatus==='pending')??[];
        // Save before any transmission, including manual retry after a storage error.
        await persistPending();
        for(const message of messages){
          if(!current(generation,userId))return;
          if(message.retryAt>Date.now())break;
          if(Date.now()-message.sentAt>PENDING_TTL){
            change(tripId,c=>({messages:c.messages.map(m=>m.id===message.id?{...m,localStatus:'failed',error:'This pending message expired. Write a new message if still needed.'}:m)}));await persistPending();continue;
          }
          try{
            const saved=await persistTripMessage(tripId,{id:message.id,text:message.text});
            if(!current(generation,userId))return;
            change(tripId,c=>({messages:mergeChatMessages(c.messages,[savedChatMessage(saved)])}));
          }catch(error){
            if(!current(generation,userId))return;
            const status=isAxiosError(error)?error.response?.status:undefined;
            const code=isAxiosError(error)?error.response?.data?.error:undefined;
            const retryable=!status||status>=500||status===429;
            const attempts=message.attempts+1;
            const delay=status===429?60_000:Math.min(60_000,2000*2**attempts)+Math.floor(Math.random()*1000);
            change(tripId,c=>({messages:c.messages.map(m=>m.id===message.id&&!m.recordId?{...m,attempts,retryAt:Date.now()+delay,
              localStatus:retryable&&attempts<5?'pending':'failed',error:messageError(error)}:m),
              ...(code==='trip_messaging_unavailable'&&c.details?{details:{...c.details,canMessage:false}}:{})}));
            // Preserve per-trip send order when connectivity or rate limiting fails.
            if(retryable){await persistPending();break;}
          }
          await persistPending();
        }
      })().catch(error=>{if(current(generation,userId))change(tripId,()=>({error:messageError(error)}));})
        .finally(()=>flushing.delete(key));
      flushing.set(key,promise);return promise;
    },
    markRead:tripId=>{
      const {userId,generation}=get(),conversation=get().conversations[tripId];
      if(!userId||!conversation?.details)return Promise.resolve();
      const key=`${generation}:${tripId}`;if(reading.has(key))return reading.get(key)!;
      const incoming=conversation.messages.filter(m=>m.senderId!==userId&&m.sequence&&compareSequence(m.sequence,conversation.synchronizedSequence)<=0).at(-1);
      const own=conversation.details.participantRole==='rider'?conversation.receipts?.rider:conversation.receipts?.driver;
      if(!incoming?.sequence||!own||compareSequence(incoming.sequence,own.deliveredSequence)>0||compareSequence(incoming.sequence,own.readSequence)<=0)return Promise.resolve();
      const promise=updateChatReceipt(tripId,'read',incoming.sequence).then(receipt=>{if(current(generation,userId))receiveReceipts(receipt);})
        .catch(()=>undefined).finally(()=>reading.delete(key));
      reading.set(key,promise);return promise;
    },
  };
});
