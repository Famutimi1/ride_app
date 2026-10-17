import { create } from 'zustand';
import type { AppNotification, NotificationPermissionState, NotificationPreferences } from '@/services/notificationService';
import { getNotificationPermission, getNotificationPreferences, getNotifications, getUnreadNotificationCount, markAllNotificationsRead, markNotificationOpened, markNotificationRead, updateNotificationPreferences } from '@/services/notificationService';

interface NotificationState {
  items:AppNotification[];current:AppNotification|null;pending:AppNotification[];unreadCount:number;nextCursor:string|null;loading:boolean;
  preferences:NotificationPreferences|null;permission:NotificationPermissionState|null;recentIds:string[];
  receive:(notification:AppNotification)=>void;dismiss:()=>void;refresh:()=>Promise<void>;loadMore:()=>Promise<void>;
  refreshPreferences:()=>Promise<void>;savePreferences:(input:Partial<NotificationPreferences>)=>Promise<void>;
  markRead:(id:string)=>Promise<void>;markOpened:(id:string)=>Promise<void>;markAllRead:()=>Promise<void>;reset:()=>void;
}

function merge(items:AppNotification[],incoming:AppNotification[]){const values=new Map(items.map(item=>[item.id,item]));for(const item of incoming)values.set(item.id,item);return [...values.values()].sort((a,b)=>new Date(b.createdAt).getTime()-new Date(a.createdAt).getTime());}

export const useNotificationStore=create<NotificationState>((set,get)=>({items:[],current:null,pending:[],unreadCount:0,nextCursor:null,loading:false,preferences:null,permission:null,recentIds:[],
  receive:(notification)=>{const state=get();if(state.recentIds.includes(notification.id)||state.items.some(item=>item.id===notification.id))return;const recentIds=[notification.id,...state.recentIds].slice(0,100);const silent=notification.type==='ride_offer'||notification.type==='offer_expired';set({recentIds,items:merge(state.items,[notification]),unreadCount:state.unreadCount+(notification.readAt?0:1),...(silent?{}:state.current?{pending:[...state.pending,notification]}:{current:notification})});},
  dismiss:()=>set(state=>({current:state.pending[0]??null,pending:state.pending.slice(1)})),
  refresh:async()=>{set({loading:true});try{const[data,count]=await Promise.all([getNotifications(),getUnreadNotificationCount()]);set({items:data.notifications,nextCursor:data.nextCursor,unreadCount:count});}finally{set({loading:false});}},
  loadMore:async()=>{const cursor=get().nextCursor;if(!cursor||get().loading)return;set({loading:true});try{const data=await getNotifications(cursor);set(state=>({items:merge(state.items,data.notifications),nextCursor:data.nextCursor}));}finally{set({loading:false});}},
  refreshPreferences:async()=>{const[preferences,permission]=await Promise.all([getNotificationPreferences(),getNotificationPermission()]);set({preferences,permission});},
  savePreferences:async(input)=>{const preferences=await updateNotificationPreferences(input);set({preferences});},
  markRead:async(id)=>{const updated=await markNotificationRead(id);set(state=>({items:state.items.map(item=>item.id===id?updated:item),unreadCount:Math.max(0,state.unreadCount-(state.items.find(item=>item.id===id)?.readAt?0:1))}));},
  markOpened:async(id)=>{const before=get().items.find(item=>item.id===id);const updated=await markNotificationOpened(id);set(state=>({items:state.items.map(item=>item.id===id?updated:item),unreadCount:Math.max(0,state.unreadCount-(before?.readAt?0:1))}));},
  markAllRead:async()=>{await markAllNotificationsRead();const now=new Date().toISOString();set(state=>({items:state.items.map(item=>({...item,readAt:item.readAt??now})),unreadCount:0}));},
  reset:()=>set({items:[],current:null,pending:[],unreadCount:0,nextCursor:null,loading:false,preferences:null,permission:null,recentIds:[]}),
}));
