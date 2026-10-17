import { useEffect } from 'react';
import { NotificationBanner } from './NotificationBanner';
import { RideOfferOverlay } from './RideOfferOverlay';
import { useNotificationStore } from '@/store/notificationStore';

export function NotificationHost(){const current=useNotificationStore(state=>state.current),dismiss=useNotificationStore(state=>state.dismiss),markOpened=useNotificationStore(state=>state.markOpened);useEffect(()=>{if(!current)return;const timer=setTimeout(dismiss,current.priority==='high'?8000:5000);return()=>clearTimeout(timer);},[current,dismiss]);return <>{current?<NotificationBanner notification={current} onDismiss={dismiss} onOpen={id=>void markOpened(id).catch(()=>undefined)}/>:null}<RideOfferOverlay/></>;}
