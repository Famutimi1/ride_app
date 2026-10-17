import { useEffect } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Text } from '@/components/common';
import { useTheme } from '@/constants/theme';
import { useNotificationStore } from '@/store/notificationStore';
import { notificationDestination, type AppNotification } from '@/services/notificationService';

export function NotificationCenterScreen(){
  const router=useRouter(),theme=useTheme();
  const items=useNotificationStore(state=>state.items),loading=useNotificationStore(state=>state.loading),nextCursor=useNotificationStore(state=>state.nextCursor),refresh=useNotificationStore(state=>state.refresh),loadMore=useNotificationStore(state=>state.loadMore),markOpened=useNotificationStore(state=>state.markOpened),markAll=useNotificationStore(state=>state.markAllRead);
  useEffect(()=>{void refresh().catch(()=>undefined);},[refresh]);
  const open=async(item:AppNotification)=>{await markOpened(item.id).catch(()=>undefined);router.push(notificationDestination(item));};
  return <SafeAreaView className="flex-1 bg-background" edges={['top','bottom']}>
    <View className="flex-row items-center border-b border-border px-xl py-md">
      <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={()=>router.canGoBack()?router.back():router.replace('/home')} className="h-11 w-11 items-center justify-center rounded-full bg-surfaceMuted"><Text variant="h3">←</Text></Pressable>
      <View className="ml-md flex-1"><Text variant="h3">Notifications</Text><Text variant="caption" color="textMuted">Trip, wallet, safety, and account updates</Text></View>
      {items.some(item=>!item.readAt)?<Pressable accessibilityRole="button" accessibilityLabel="Mark all notifications as read" onPress={()=>void markAll()}><Text variant="caption" color="primary">Read all</Text></Pressable>:null}
    </View>
    <ScrollView className="flex-1" contentContainerClassName="px-xl py-lg" refreshControl={<RefreshControl refreshing={loading} onRefresh={()=>void refresh()} tintColor={theme.colors.primary}/>} onScroll={({nativeEvent})=>{const close=nativeEvent.layoutMeasurement.height+nativeEvent.contentOffset.y>=nativeEvent.contentSize.height-80;if(close&&nextCursor&&!loading)void loadMore();}} scrollEventThrottle={200}>
      {items.length?items.map(item=><Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`${item.title}. ${item.body}`} onPress={()=>void open(item)} className={`mb-sm rounded-xl border p-md ${item.readAt?'border-border bg-surface':'border-primary bg-primarySoft'}`}>
        <View className="flex-row items-start"><View className="flex-1"><Text variant="bodyMedium">{item.title}</Text><Text variant="caption" color="textMuted" className="mt-xs">{item.body}</Text><Text variant="caption" color="textMuted" className="mt-sm">{new Date(item.createdAt).toLocaleString()}</Text></View>{!item.readAt?<View className="ml-sm mt-xs h-2 w-2 rounded-full bg-primary"/>:null}</View>
      </Pressable>):<View className="items-center rounded-xl bg-surfaceMuted p-xl"><Text variant="h3">No notifications yet</Text><Text variant="caption" color="textMuted" className="mt-xs text-center">Trip and account updates will appear here.</Text></View>}
      {nextCursor?<Button label="Load more" variant="ghost" fullWidth loading={loading} className="mt-md" onPress={()=>void loadMore()}/>:null}
    </ScrollView>
  </SafeAreaView>;
}
