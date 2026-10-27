import Constants from 'expo-constants';
import * as Device from 'expo-device';
import type * as ExpoNotifications from 'expo-notifications';
import { requireOptionalNativeModule } from 'expo-modules-core';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { Href } from 'expo-router';
import { notificationAudience, type NotificationRole } from '@/utils/notificationAudience';
import { apiClient } from '@/lib/apiClient';

const INSTALLATION_KEY='rakky-notification-installation-id';
const DEVICE_REGISTRATION_KEY='rakky-notification-device-registration-id';

export type NotificationCategory='trip_updates'|'driver_offers'|'scheduled_reminders'|'wallet_updates'|'safety_security'|'support'|'promotions';
export type NotificationPriority='low'|'normal'|'high';

export interface AppNotification {
  id:string;userId:string;type:string;category:NotificationCategory;priority:NotificationPriority;eventKey:string;
  title:string;body:string;data:Record<string,unknown>;deepLink:string|null;expiresAt:string|null;readAt:string|null;openedAt:string|null;deliveredAt:string|null;
  deliveryStatus:string;createdAt:string;
}

export interface NotificationPreferences {
  pushEnabled:boolean;tripUpdatesEnabled:boolean;driverOffersEnabled:boolean;scheduledRemindersEnabled:boolean;
  walletUpdatesEnabled:boolean;promotionsEnabled:boolean;soundEnabled:boolean;vibrationEnabled:boolean;
}

export interface NotificationPermissionState {
  granted:boolean;
  canAskAgain:boolean;
  status:string;
  unavailableReason?:'browser'|'expo_go'|'native_module_missing'|'module_load_failed';
}

type NotificationsModule=typeof ExpoNotifications;

let notificationsModulePromise:Promise<NotificationsModule|null>|null=null;

/**
 * `expo-notifications` contains native code and can be absent from Expo Go or from a
 * development client built before the package was installed. Loading it lazily keeps
 * the rest of the app usable in those clients. A rebuilt development/release client
 * resolves the module normally and enables the complete notification experience.
 */
export function getNotificationsModule():Promise<NotificationsModule|null>{
  if(Platform.OS==='web')return Promise.resolve(null);
  if(Platform.OS==='android'&&Constants.executionEnvironment==='storeClient')return Promise.resolve(null);
  // Do not evaluate expo-notifications in Expo Go or an older development build.
  // Its module entry point calls requireNativeModule immediately and would otherwise
  // surface a LogBox error before the rejected dynamic import can be handled.
  if(!requireOptionalNativeModule('ExpoPushTokenManager'))return Promise.resolve(null);
  if(!notificationsModulePromise){
    notificationsModulePromise=import('expo-notifications')
      .then(module=>{
        module.setNotificationHandler({handleNotification:async()=>({shouldPlaySound:false,shouldSetBadge:false,shouldShowBanner:false,shouldShowList:false})});
        return module;
      })
      .catch(()=>null);
  }
  return notificationsModulePromise;
}

async function installationId(){let value=await SecureStore.getItemAsync(INSTALLATION_KEY);if(!value){value=`${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;await SecureStore.setItemAsync(INSTALLATION_KEY,value);}return value;}
export {installationId as notificationInstallationId};

export async function configureNotificationChannels(vibration=true){if(Platform.OS!=='android')return;const Notifications=await getNotificationsModule();if(!Notifications)return;const channels:[NotificationCategory,string,ExpoNotifications.AndroidImportance][]=[['driver_offers','Ride offers',Notifications.AndroidImportance.MAX],['trip_updates','Trip updates',Notifications.AndroidImportance.HIGH],['scheduled_reminders','Scheduled rides',Notifications.AndroidImportance.HIGH],['wallet_updates','Wallet and payouts',Notifications.AndroidImportance.DEFAULT],['safety_security','Safety and security',Notifications.AndroidImportance.HIGH],['support','Support updates',Notifications.AndroidImportance.DEFAULT],['promotions','Promotions',Notifications.AndroidImportance.LOW]];await Promise.all(channels.map(([id,name,importance])=>Notifications.setNotificationChannelAsync(id,{name,importance,vibrationPattern:vibration&&importance>=Notifications.AndroidImportance.HIGH?[0,250,150,250]:undefined,enableVibrate:vibration,showBadge:true})))}

function permissionState(permission:ExpoNotifications.NotificationPermissionsStatus,Notifications:NotificationsModule):NotificationPermissionState {
  // iOS can allow quiet notifications without reporting the general permission as granted.
  const granted=permission.granted||permission.ios?.status===Notifications.IosAuthorizationStatus.PROVISIONAL||permission.ios?.status===Notifications.IosAuthorizationStatus.EPHEMERAL;
  return{granted,canAskAgain:permission.canAskAgain,status:permission.status};
}

export async function getNotificationPermission():Promise<NotificationPermissionState>{
  if(Platform.OS==='web')return{granted:false,canAskAgain:false,status:'unsupported',unavailableReason:'browser'};
  const Notifications=await getNotificationsModule();
  if(!Notifications){
    const unavailableReason=Constants.executionEnvironment==='storeClient'?'expo_go':!requireOptionalNativeModule('ExpoPushTokenManager')?'native_module_missing':'module_load_failed';
    return{granted:false,canAskAgain:false,status:'unavailable',unavailableReason};
  }
  return permissionState(await Notifications.getPermissionsAsync(),Notifications);
}

export function notificationPermissionMessage(permission:NotificationPermissionState|null):string {
  if(!permission)return'Checking notification permission…';
  if(permission.granted)return'Allowed by this device';
  switch(permission.unavailableReason){
    case'browser':return'Push notifications are unavailable in the web app. Use the installed Rakky Ride app.';
    case'expo_go':return'Push notifications are unavailable in Expo Go. Use a Rakky Ride development or release build.';
    case'native_module_missing':return'This installed build does not include notification support. Install an updated Rakky Ride build.';
    case'module_load_failed':return'Notification support could not start. Restart the app or install an updated Rakky Ride build.';
  }
  return permission.canAskAgain?'Allow notification permission to receive alerts outside Rakky Ride.':'Notifications are blocked. Allow notifications for Rakky Ride in your device settings.';
}

export async function requestNotificationPermission(vibration=true):Promise<NotificationPermissionState>{
  const Notifications=await getNotificationsModule();
  if(!Notifications)return getNotificationPermission();
  await configureNotificationChannels(vibration);
  const current=await Notifications.getPermissionsAsync();
  const permission=permissionState(current,Notifications);
  if(permission.granted||!permission.canAskAgain)return permission;
  return permissionState(await Notifications.requestPermissionsAsync(),Notifications);
}

export async function registerCurrentDevice(requestPermission=false,vibration=true){if(Platform.OS==='web')return null;const Notifications=await getNotificationsModule();if(!Notifications)return null;await configureNotificationChannels(vibration);const permission=requestPermission?await requestNotificationPermission(vibration):await getNotificationPermission();if(!permission.granted||!Device.isDevice)return null;const projectId=Constants.expoConfig?.extra?.eas?.projectId??Constants.easConfig?.projectId;if(typeof projectId!=='string'||!projectId)throw new Error('Expo project ID is not configured.');const token=(await Notifications.getExpoPushTokenAsync({projectId})).data;const response=await apiClient.post<{deviceId:string}>('/notifications/devices',{expoPushToken:token,platform:Platform.OS,deviceIdentifier:await installationId(),appVersion:Constants.expoConfig?.version??'unknown'});await SecureStore.setItemAsync(DEVICE_REGISTRATION_KEY,response.data.deviceId);return response.data.deviceId;}

export async function revokeDevice(deviceId:string){await apiClient.delete(`/notifications/devices/${deviceId}`);}
export async function currentDeviceRegistrationId():Promise<string|null>{
  if(Platform.OS==='web')return null;
  return SecureStore.getItemAsync(DEVICE_REGISTRATION_KEY);
}
export async function revokeCurrentDevice(){
  if(Platform.OS==='web')return;
  const id=await currentDeviceRegistrationId();
  if(!id)return;
  await revokeDevice(id);
  await SecureStore.deleteItemAsync(DEVICE_REGISTRATION_KEY);
}
export async function getNotificationPreferences(){return(await apiClient.get<NotificationPreferences>('/notifications/preferences')).data;}
export async function updateNotificationPreferences(input:Partial<NotificationPreferences>){return(await apiClient.patch<NotificationPreferences>('/notifications/preferences',input)).data;}
export async function getNotifications(cursor?:string,role?:NotificationRole){return(await apiClient.get<{notifications:AppNotification[];nextCursor:string|null}>('/notifications',{params:{cursor,role}})).data;}
export async function getUnreadNotificationCount(role?:NotificationRole){return(await apiClient.get<{count:number}>('/notifications/unread-count',{params:{role}})).data.count;}
export async function markNotificationRead(id:string,role?:NotificationRole){return(await apiClient.post<AppNotification>(`/notifications/${id}/read`,undefined,{params:{role}})).data;}
export async function markNotificationOpened(id:string,role?:NotificationRole){return(await apiClient.post<AppNotification>(`/notifications/${id}/opened`,undefined,{params:{role}})).data;}
export async function markAllNotificationsRead(role?:NotificationRole){return(await apiClient.post<{updated:number}>('/notifications/read-all',undefined,{params:{role}})).data;}

const categories:NotificationCategory[]=['trip_updates','driver_offers','scheduled_reminders','wallet_updates','safety_security','support','promotions'];
export function notificationFromNative(notification:ExpoNotifications.Notification):AppNotification|null{const content=notification.request.content,data=content.data as Record<string,unknown>;const id=typeof data.notificationId==='string'?data.notificationId:notification.request.identifier;if(!content.title||!content.body)return null;const category=typeof data.category==='string'&&categories.includes(data.category as NotificationCategory)?data.category as NotificationCategory:'trip_updates';const priority:NotificationPriority=data.priority==='high'||data.priority==='low'?data.priority:'normal';return{id,userId:'',type:typeof data.type==='string'?data.type:'push',category,priority,eventKey:id,title:content.title,body:content.body,data,deepLink:typeof data.deepLink==='string'?data.deepLink:null,expiresAt:null,readAt:null,openedAt:null,deliveredAt:new Date().toISOString(),deliveryStatus:'delivered',createdAt:new Date().toISOString()};}

export function notificationDestination(notification: Pick<AppNotification, 'type' | 'category' | 'data'> & Partial<Pick<AppNotification, 'eventKey' | 'deepLink' | 'title'>>): Href {
  const audience = notificationAudience(notification);
  const tripId = typeof notification.data.tripId === 'string' ? notification.data.tripId : null;
  if (notification.type === 'trip_message' && tripId) return { pathname: '/trip-chat', params: { tripId } };
  if (notification.type === 'ride_offer' || notification.type === 'offer_expired') return '/driver-dashboard';
  if (notification.type.startsWith('driver_application_')) return '/driver-status';
  if (notification.category === 'support') return { pathname: '/account/[section]', params: { section: 'support' } };
  if (notification.category === 'safety_security') return { pathname: '/account/[section]', params: { section: 'safety' } };
  if (notification.category === 'wallet_updates') return { pathname: '/account/[section]', params: { section: audience === 'driver' ? 'driver-wallet' : 'payment' } };
  if (notification.type === 'trip_cancelled' || notification.type === 'no_drivers_found') return audience === 'driver' ? '/driver-dashboard' : '/home';
  if (['trip_completed', 'courier_returned'].includes(notification.type) || ['completed', 'returned'].includes(String(notification.data.status))) {
    if (tripId) return { pathname: '/trip-receipt', params: { tripId } };
    return { pathname: '/account/[section]', params: { section: audience === 'driver' ? 'driver-trips' : 'trips' } };
  }
  if (notification.category === 'scheduled_reminders') return '/schedule';
  if (notification.category === 'trip_updates') return audience === 'driver' ? '/driver-trip' : '/ongoing-trip';
  return '/notification-center';
}
