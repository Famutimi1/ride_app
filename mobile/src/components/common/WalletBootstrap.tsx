import { useEffect } from 'react';
import { AppState } from 'react-native';
import { getSocket, SOCKET_EVENTS } from '@/services/socket';
import { useWalletStore } from '@/store/walletStore';

export function WalletBootstrap() {
  const refresh=useWalletStore((state)=>state.refresh);
  useEffect(()=>{
    void refresh();
    const socket=getSocket();
    socket.on(SOCKET_EVENTS.WALLET_UPDATED,refresh);
    const subscription=AppState.addEventListener('change',(state)=>{if(state==='active')void refresh();});
    return()=>{subscription.remove();socket.off(SOCKET_EVENTS.WALLET_UPDATED,refresh);};
  },[refresh]);
  return null;
}
