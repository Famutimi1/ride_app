import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import type { Notification } from 'expo-notifications';
import { subscribeToNotifications } from '@/services/socket';
import { getNotificationsModule, notificationDestination, notificationFromNative, registerCurrentDevice } from '@/services/notificationService';
import { useNotificationStore } from '@/store/notificationStore';

export function NotificationBootstrap(){const router=useRouter();const receive=useNotificationStore(state=>state.receive),refresh=useNotificationStore(state=>state.refresh),refreshPreferences=useNotificationStore(state=>state.refreshPreferences),markOpened=useNotificationStore(state=>state.markOpened);
  useEffect(()=>{let active=true;const cleanups:(()=>void)[]=[];const unsubscribeSocket=subscribeToNotifications(receive);cleanups.push(unsubscribeSocket);
    const initialise=async()=>{await Promise.all([refresh(),refreshPreferences()]);const store=useNotificationStore.getState();if(active&&store.preferences?.pushEnabled&&store.permission?.granted)await registerCurrentDevice(false,store.preferences.vibrationEnabled);if(!active||Platform.OS==='web')return;
      const Notifications=await getNotificationsModule();if(!active||!Notifications)return;
      const received=Notifications.addNotificationReceivedListener(notification=>{const value=notificationFromNative(notification);if(value)receive(value);});
      const open=(notification:Notification)=>{const value=notificationFromNative(notification);if(value){receive(value);void markOpened(value.id).catch(()=>undefined);router.push(notificationDestination(value));}};
      const last=Notifications.getLastNotificationResponse();if(last?.notification)open(last.notification);
      const response=Notifications.addNotificationResponseReceivedListener(item=>open(item.notification));
      const token=Notifications.addPushTokenListener(()=>{const vibration=useNotificationStore.getState().preferences?.vibrationEnabled??true;void registerCurrentDevice(false,vibration).catch(()=>undefined);});
      cleanups.push(()=>received.remove(),()=>response.remove(),()=>token.remove());
    };
    void initialise().catch(()=>undefined);
    const appState=AppState.addEventListener('change',state=>{if(state==='active')void Promise.all([refresh(),refreshPreferences()]).then(()=>{const store=useNotificationStore.getState();if(store.preferences?.pushEnabled&&store.permission?.granted)return registerCurrentDevice(false,store.preferences.vibrationEnabled);return null;}).catch(()=>undefined);});
    cleanups.push(()=>appState.remove());
    return()=>{active=false;cleanups.forEach(cleanup=>cleanup());};
  },[markOpened,receive,refresh,refreshPreferences,router]);const unreadCount=useNotificationStore(state=>state.unreadCount);useEffect(()=>{if(Platform.OS!=='web')void getNotificationsModule().then(Notifications=>Notifications?.setBadgeCountAsync(unreadCount)).catch(()=>undefined);},[unreadCount]);return null;}
