import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { subscribeToChatReceipts, subscribeToTripMessages } from '@/services/socket';
import { useChatStore } from '@/store/chatStore';

export function useTripChat(tripId: string,userId: string) {
  const active=useRef(AppState.currentState!=='background'&&AppState.currentState!=='inactive');
  const conversation=useChatStore(state=>state.conversations[tripId]);
  useEffect(()=>{
    let mounted=true;
    const isCurrent=()=>mounted&&useChatStore.getState().userId===userId;
    const refresh=async()=>{
      if(!isCurrent()||!active.current)return;
      await useChatStore.getState().synchronize(tripId);
      if(isCurrent()&&active.current)await useChatStore.getState().flush(tripId);
    };
    const stopMessages=subscribeToTripMessages(tripId,message=>{
      if(!isCurrent()||message.tripId!==tripId)return;
      useChatStore.getState().receive(message);
      void refresh();
    },()=>{void refresh();});
    const stopReceipts=subscribeToChatReceipts(receipt=>{
      if(isCurrent()&&receipt.tripId===tripId)useChatStore.getState().receiveReceipts(receipt);
    });
    const state=AppState.addEventListener('change',value=>{
      active.current=value==='active';
      if(active.current)void refresh();
    });
    // REST catch-up also covers silent adapter/pubsub loss without a disconnect.
    const timer=setInterval(()=>{void refresh();},5000);
    return ()=>{mounted=false;clearInterval(timer);state.remove();stopMessages();stopReceipts();};
  },[tripId,userId]);
  return conversation;
}
