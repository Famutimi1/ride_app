import type { ChatReceipts, TripMessage } from '@/services/communicationService';

export interface ChatMessage extends Omit<TripMessage,'recordId'|'sequence'> {
  recordId?: string;
  sequence?: string;
  localStatus: 'pending' | 'sent' | 'failed';
  attempts: number;
  retryAt: number;
  error?: string;
}
export function compareSequence(a: string,b: string): number {
  return a.length===b.length ? a===b?0:a<b?-1:1 : a.length-b.length;
}
export function messageKey(message: Pick<ChatMessage,'senderId'|'id'>): string {
  return `${message.senderId}:${message.id}`;
}
export function mergeChatMessages(current: ChatMessage[],incoming: ChatMessage[]): ChatMessage[] {
  const messages=new Map(current.map(item=>[messageKey(item),item]));
  for(const item of incoming){
    const key=messageKey(item),previous=messages.get(key);
    // A delayed local-pending snapshot must never overwrite a persisted ack.
    if(previous?.recordId&&!item.recordId)continue;
    messages.set(key,item);
  }
  return [...messages.values()].sort((a,b)=>{
    if(a.sequence&&b.sequence)return compareSequence(a.sequence,b.sequence);
    if(a.sequence)return -1;
    if(b.sequence)return 1;
    // Stable sorting preserves enqueue order when two local sends share a millisecond.
    return a.sentAt-b.sentAt;
  });
}
export function savedChatMessage(message: TripMessage): ChatMessage {
  return {...message,localStatus:'sent',attempts:0,retryAt:0};
}

// This is a bounded device cache, not a replacement for authorized server history.
const MAX_HISTORY_MESSAGES=200,MAX_HISTORY_CONVERSATIONS=20;
export function serializeChatHistory(userId:string,conversations:Record<string,{messages:ChatMessage[]}>):string{
  const saved=Object.values(conversations).flatMap(c=>c.messages).filter(m=>m.recordId&&m.sequence)
    .sort((a,b)=>b.sentAt-a.sentAt||(a.tripId===b.tripId?compareSequence(b.sequence!,a.sequence!):a.tripId.localeCompare(b.tripId)))
    .slice(0,MAX_HISTORY_MESSAGES);
  const byTrip=new Map<string,TripMessage[]>();
  for(const message of saved){
    if(!byTrip.has(message.tripId)){
      if(byTrip.size>=MAX_HISTORY_CONVERSATIONS)continue;
      byTrip.set(message.tripId,[]);
    }
    byTrip.get(message.tripId)!.push({id:message.id,recordId:message.recordId!,tripId:message.tripId,
      senderId:message.senderId,senderRole:message.senderRole,text:message.text,sequence:message.sequence!,sentAt:message.sentAt});
  }
  return JSON.stringify({version:1,userId,conversations:[...byTrip].map(([tripId,messages])=>({tripId,messages}))});
}
export function restoreChatHistory(serialized:string|null,userId:string):Record<string,ChatMessage[]>{
  const restored:Record<string,ChatMessage[]>={};
  if(!serialized||serialized.length>2_000_000)return restored;
  try{
    const data=JSON.parse(serialized) as {version?:unknown;userId?:unknown;conversations?:unknown};
    if(data.version!==1||data.userId!==userId||!Array.isArray(data.conversations))return restored;
    let count=0;
    for(const raw of data.conversations.slice(0,MAX_HISTORY_CONVERSATIONS)){
      const conversation=raw as {tripId?:unknown;messages?:unknown}|null;
      if(!conversation||typeof conversation.tripId!=='string'||!/^[0-9a-f-]{36}$/i.test(conversation.tripId)||!Array.isArray(conversation.messages))continue;
      const messages:ChatMessage[]=[];
      for(const item of conversation.messages.slice(0,MAX_HISTORY_MESSAGES)){
        const m=item as Partial<TripMessage>|null;
        if(!m||count>=MAX_HISTORY_MESSAGES||m.tripId!==conversation.tripId||typeof m.id!=='string'||!m.id||m.id.length>120
          ||typeof m.senderId!=='string'||!m.senderId||m.senderId.length>120||(m.senderRole!=='rider'&&m.senderRole!=='driver')
          ||typeof m.recordId!=='string'||!(/^[1-9]\d{0,19}$/).test(m.recordId)
          ||typeof m.sequence!=='string'||!(/^[1-9]\d{0,19}$/).test(m.sequence)
          ||typeof m.text!=='string'||!m.text||[...m.text].length>2000
          ||typeof m.sentAt!=='number'||!Number.isFinite(m.sentAt)||m.sentAt<0||m.sentAt>Date.now()+60_000)continue;
        messages.push(savedChatMessage({id:m.id,tripId:m.tripId,recordId:m.recordId,senderId:m.senderId,
          senderRole:m.senderRole,text:m.text,sequence:m.sequence,sentAt:m.sentAt}));count++;
      }
      if(messages.length)restored[conversation.tripId]=mergeChatMessages(restored[conversation.tripId]??[],messages);
    }
  }catch{/* Corrupt cache cannot prevent loading history from the server. */}
  return restored;
}
export function newerReceipts(current: ChatReceipts|null,incoming: ChatReceipts|null): ChatReceipts|null {
  return incoming&&(!current||compareSequence(incoming.version,current.version)>=0)?incoming:current;
}
export function outgoingMessageStatus(message: ChatMessage,receipts: ChatReceipts|null,role: 'rider'|'driver'): string {
  if(!message.sequence)return message.localStatus==='failed'?'Failed · tap to retry':'Pending';
  const peer=role==='rider'?receipts?.driver:receipts?.rider;
  if(peer&&compareSequence(peer.readSequence,message.sequence)>=0)return 'Read';
  if(peer&&compareSequence(peer.deliveredSequence,message.sequence)>=0)return 'Delivered';
  return 'Sent';
}
