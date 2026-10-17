import { useEffect, useState } from 'react';
import { Alert, AppState, Linking, Switch, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, Text } from '@/components/common';
import { useTheme } from '@/constants/theme';
import { configureNotificationChannels, notificationPermissionMessage, registerCurrentDevice, requestNotificationPermission, type NotificationPreferences } from '@/services/notificationService';
import { useAuthStore } from '@/store/authStore';
import { useNotificationStore } from '@/store/notificationStore';

export function NotificationPreferencesPanel(){
  const router=useRouter(),theme=useTheme();
  const driver=useAuthStore(state=>state.driverApplication?.status==='approved');
  const preferences=useNotificationStore(state=>state.preferences);
  const permission=useNotificationStore(state=>state.permission);
  const refresh=useNotificationStore(state=>state.refreshPreferences);
  const save=useNotificationStore(state=>state.savePreferences);
  const[saving,setSaving]=useState<keyof NotificationPreferences|null>(null);
  const[loadError,setLoadError]=useState<string|null>(null);

  useEffect(()=>{
    let active=true;
    const load=async()=>{
      try{await refresh();if(active)setLoadError(null);}
      catch{if(active)setLoadError('Could not load notification settings. Check your connection and try again.');}
    };
    void load();
    const subscription=AppState.addEventListener('change',state=>{if(state==='active')void load();});
    return()=>{active=false;subscription.remove();};
  },[refresh]);

  const change=async(key:keyof NotificationPreferences,value:boolean)=>{
    setSaving(key);
    try{
      if(key==='pushEnabled'&&value){
        const vibration=preferences?.vibrationEnabled??true;
        const result=await requestNotificationPermission(vibration);
        await refresh();
        if(!result.granted){Alert.alert('Notifications unavailable',notificationPermissionMessage(result));return;}
        await registerCurrentDevice(false,vibration);
      }
      await save({[key]:value});
      if(key==='vibrationEnabled')await configureNotificationChannels(value);
      await refresh();
    }catch(error){
      Alert.alert('Could not update notifications',error instanceof Error?error.message:'Try again.');
    }finally{setSaving(null);}
  };
  const retry=()=>{setLoadError(null);void refresh().catch(()=>setLoadError('Could not load notification settings. Check your connection and try again.'));};
  const openSettings=()=>{void Linking.openSettings().catch(()=>Alert.alert('Could not open settings','Open your device settings and select Rakky Ride, then Notifications.'));};
  if(!preferences)return <View className="rounded-xl bg-surfaceMuted p-lg"><Text color="textMuted">{loadError??'Loading notification settings…'}</Text>{loadError?<Button label="Try again" variant="ghost" onPress={retry}/>:null}</View>;

  const unavailable=permission?.status==='unsupported'||permission?.status==='unavailable';
  const canRequest=permission!==null&&!permission.granted&&!unavailable&&permission.canAskAgain;
  const needsSettings=permission!==null&&!permission.granted&&!unavailable&&!permission.canAskAgain;
  return <View>
    {loadError?<View className="mb-md"><Text color="warning">{loadError}</Text><Button label="Try again" variant="ghost" onPress={retry}/></View>:null}
    <View className="mb-md rounded-xl border border-border bg-surface p-md">
      <View className="flex-row items-center justify-between">
        <View className="flex-1 pr-md"><Text variant="bodyMedium">Push notifications</Text><Text variant="caption" color="textMuted">Receive important updates when Rakky Ride is in the background.</Text></View>
        <Switch accessibilityLabel="Push notifications" value={preferences.pushEnabled&&permission?.granted===true} disabled={saving!==null||permission===null||unavailable} onValueChange={value=>void change('pushEnabled',value)} trackColor={{false:theme.colors.borderStrong,true:theme.colors.primary}} thumbColor={theme.colors.surface}/>
      </View>
      <View className="mt-md border-t border-border pt-md">
        <Text variant="caption" color={permission?.granted?'success':'warning'}>{notificationPermissionMessage(permission)}</Text>
        {canRequest?<Button label="Allow notifications" variant="ghost" size="sm" className="mt-xs self-start" disabled={saving!==null} onPress={()=>void change('pushEnabled',true)}/>:null}
        {needsSettings?<Button label="Open device settings" variant="ghost" size="sm" className="mt-xs self-start" onPress={openSettings}/>:null}
      </View>
    </View>
    <PreferenceRow label="Trip updates" detail="Driver assignment, arrival, cancellations, and receipts" value={preferences.tripUpdatesEnabled} disabled={saving!==null} onChange={value=>void change('tripUpdatesEnabled',value)}/>
    {driver?<PreferenceRow label="Driver offers" detail="New ride and courier requests while you are online" value={preferences.driverOffersEnabled} disabled={saving!==null} onChange={value=>void change('driverOffersEnabled',value)}/>:null}
    <PreferenceRow label="Scheduled ride reminders" detail="Reminders and important schedule changes" value={preferences.scheduledRemindersEnabled} disabled={saving!==null} onChange={value=>void change('scheduledRemindersEnabled',value)}/>
    <PreferenceRow label="Wallet and payments" detail="Top-ups, refunds, earnings, and payouts" value={preferences.walletUpdatesEnabled} disabled={saving!==null} onChange={value=>void change('walletUpdatesEnabled',value)}/>
    <PreferenceRow label="Promotions and tips" detail="Optional offers and useful product tips" value={preferences.promotionsEnabled} disabled={saving!==null} onChange={value=>void change('promotionsEnabled',value)}/>
    <PreferenceRow label="Sound" detail="Play a sound for eligible notifications" value={preferences.soundEnabled} disabled={saving!==null} onChange={value=>void change('soundEnabled',value)}/>
    <PreferenceRow label="Vibration" detail="Vibrate for time-sensitive notifications" value={preferences.vibrationEnabled} disabled={saving!==null} onChange={value=>void change('vibrationEnabled',value)}/>
    <Text variant="caption" color="textMuted" className="mb-md mt-sm">Safety and security notices always remain available in your notification history.</Text><Button label="Open notification history" variant="outline" fullWidth onPress={()=>router.push('/notification-center')}/>
  </View>;
}
function PreferenceRow({label,detail,value,disabled,onChange}:{label:string;detail:string;value:boolean;disabled:boolean;onChange:(value:boolean)=>void}){const theme=useTheme();return <View className="mb-sm flex-row items-center rounded-xl border border-border bg-surface p-md"><View className="flex-1 pr-md"><Text variant="bodyMedium">{label}</Text><Text variant="caption" color="textMuted">{detail}</Text></View><Switch value={value} disabled={disabled} onValueChange={onChange} trackColor={{false:theme.colors.borderStrong,true:theme.colors.primary}} thumbColor={theme.colors.surface}/></View>;}
