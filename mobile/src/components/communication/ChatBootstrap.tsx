import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useChatStore } from '@/store/chatStore';
import { subscribeToChatEvents } from '@/services/socket';

/** Pending sends survive navigation; only receipt display belongs to a screen. */
export function ChatBootstrap() {
  const userId=useChatStore(state=>state.userId);
  const hydrated=useChatStore(state=>state.hydrated);
  useEffect(()=>{
    if(!userId||!hydrated)return;
    let mounted=true,pumping=false;
    const active=()=>mounted&&useChatStore.getState().userId===userId&&AppState.currentState!=='background'&&AppState.currentState!=='inactive';
    const pump=async()=>{
      if(!active()||pumping)return;
      pumping=true;
      try{
        const ids=Object.entries(useChatStore.getState().conversations)
          .filter(([,c])=>c.messages.some(m=>!m.recordId&&m.localStatus==='pending')).map(([id])=>id);
        for(const id of ids){
          if(!active())break;
          await useChatStore.getState().synchronize(id);
          if(active())await useChatStore.getState().flush(id);
        }
      }finally{pumping=false;}
    };
    const stop=subscribeToChatEvents({
      onMessage:message=>{if(active())useChatStore.getState().receive(message);},
      onReceipt:receipt=>{if(active())useChatStore.getState().receiveReceipts(receipt);},
      onReconnect:()=>{void pump();},
    });
    const listener=AppState.addEventListener('change',state=>{if(state==='active')void pump();});
    const timer=setInterval(()=>{void pump();},5000);
    void pump();
    return ()=>{mounted=false;stop();listener.remove();clearInterval(timer);};
  },[userId,hydrated]);
  return null;
}
