import { userErrorMessage } from '@/utils/userMessage';
import { AppMessage } from '@/components/common/AppMessage';
import { useEffect, useRef, useState } from 'react';
import { AppState, KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text } from '@/components/common';
import { useTheme } from '@/constants/theme';
import { useTripChat } from '@/hooks/useTripChat';
import { useAuthStore } from '@/store/authStore';
import { useChatStore } from '@/store/chatStore';
import { useTripStore } from '@/store/tripStore';
import { messageKey, outgoingMessageStatus } from '@/utils/chatMessages';
import { TripCallOptions } from '@/components/communication/TripCallOptions';
import { roleHome } from '@/utils/roleAccess';

const QUICK_REPLIES=['I’m at the pickup point','I’ll be there shortly','Please message me'];

export function TripChatScreen() {
  const user=useAuthStore(state=>state.session?.user);
  const activeTripId=useTripStore(state=>state.trip?.id);
  const params=useLocalSearchParams<{tripId?:string|string[]}>();
  const requested=Array.isArray(params.tripId)?params.tripId[0]:params.tripId;
  const tripId=requested||activeTripId;
  if(!user)return <Redirect href="/welcome" />;
  if(!tripId||!/^[0-9a-f-]{36}$/i.test(tripId))return <Redirect href={roleHome(user.role)} />;
  // History/push links are authorized by the server, independently of the
  // in-memory active trip and current rider/driver display mode.
  return <TripChatContent key={`${user.id}:${tripId}`} tripId={tripId} userId={user.id} />;
}

function TripChatContent({tripId,userId}:{tripId:string;userId:string}) {
  const router=useRouter();
  const theme=useTheme();
  const conversation=useTripChat(tripId,userId);
  const scroll=useRef<ScrollView>(null);
  const atBottom=useRef(true);
  const draft=conversation?.draft??'';
  const [callOpen,setCallOpen]=useState(false);
  const [saving,setSaving]=useState(false);
  const [sendError,setSendError]=useState<string|null>(null);
  const [foreground,setForeground]=useState(AppState.currentState!=='background'&&AppState.currentState!=='inactive');
  const details=conversation?.details;
  const messages=conversation?.messages??[];
  const participantName=details?.participant?.name||(details?.participantRole==='driver'?'Rider':'Driver');
  const canMessage=details?.canMessage===true;
  const maxLength=details?.maxMessageLength??2000;

  useEffect(()=>{
    const listener=AppState.addEventListener('change',state=>setForeground(state==='active'));
    return ()=>listener.remove();
  },[]);
  useEffect(()=>{
    if(foreground&&atBottom.current)void useChatStore.getState().markRead(tripId);
  },[tripId,foreground,conversation?.synchronizedSequence,conversation?.receipts?.version]);

  const back=()=>router.canGoBack()?router.back():router.replace(details?.participantRole==='driver'?'/driver-dashboard':'/home');
  const send=async(text=draft)=>{
    if(saving||!canMessage||!text.trim())return;
    setSaving(true);setSendError(null);
    try{
      await useChatStore.getState().enqueue(tripId,text);
      await useChatStore.getState().setDraft(tripId,'').catch(()=>setSendError('Your message was saved, but the old draft could not be cleared from this device.'));atBottom.current=true;
    }catch(error){setSendError(userErrorMessage(error, 'Could not save your message.'));}
    finally{setSaving(false);}
  };
  const retry=async(id:string)=>{
    try{await useChatStore.getState().retry(tripId,id);}
    catch{setSendError('Could not save the retry. Check your device storage and try again.');}
  };
  const error=sendError||conversation?.error;
  return <KeyboardAvoidingView className="flex-1 bg-background" behavior={Platform.OS==='ios'?'padding':undefined}>
    <SafeAreaView edges={['top']} className="border-b border-border bg-surface">
      <View className="h-16 flex-row items-center px-lg">
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={back} className="h-11 w-11 items-center justify-center rounded-full bg-surfaceMuted active:opacity-70"><Text variant="h3">←</Text></Pressable>
        <View className="ml-md h-11 w-11 items-center justify-center rounded-full bg-successSoft"><Text variant="bodyMedium" color="success">{participantName.trim().slice(0,1).toUpperCase()}</Text></View>
        <View className="ml-sm flex-1">
          <Text variant="bodyMedium">{participantName}</Text>
          <Text variant="caption" color="textMuted">{!details?(conversation?.error?'Saved conversation':'Loading conversation…'):canMessage?'Trip messages':details.status==='closed'?'Trip ended · read-only history':'Messaging unavailable'}</Text>
        </View>
        {details?.canAudioCall?<Pressable accessibilityRole="button" accessibilityLabel={`Call ${participantName}`} onPress={()=>setCallOpen(true)} className="h-11 w-11 items-center justify-center rounded-full bg-primarySoft"><Text color="primary">☎</Text></Pressable>:null}
      </View>
    </SafeAreaView>
    <View className="border-b border-border bg-primarySoft px-xl py-sm"><Text variant="caption" color="primary" className="text-center">{!details&&messages.length?'Saved on this device. Reconnect for the latest updates.':canMessage?'Keep pickup updates here while your trip is active.':'Saved messages remain available after your trip.'}</Text></View>
    {error?<View accessibilityRole="alert" className="border-b border-border bg-surface px-lg py-md">
      <AppMessage message={error} />
      <Pressable accessibilityRole="button" accessibilityLabel="Reconnect conversation" onPress={()=>{setSendError(null);void useChatStore.getState().synchronize(tripId);}} className="mt-sm py-sm"><Text variant="bodyMedium" color="primary">Retry connection</Text></Pressable>
    </View>:null}
    <ScrollView ref={scroll} className="flex-1" contentContainerClassName="px-lg py-xl" keyboardShouldPersistTaps="handled" scrollEventThrottle={100}
      onScroll={event=>{
        const {layoutMeasurement,contentOffset,contentSize}=event.nativeEvent;
        atBottom.current=layoutMeasurement.height+contentOffset.y>=contentSize.height-40;
        if(atBottom.current&&foreground)void useChatStore.getState().markRead(tripId);
      }}
      onContentSizeChange={()=>{if(atBottom.current)scroll.current?.scrollToEnd({animated:true});}}>
      {conversation?.loading&&!messages.length?<Text variant="caption" color="textMuted" className="text-center">Loading saved messages…</Text>:null}
      {conversation?.hasOlder?<Pressable accessibilityRole="button" disabled={conversation.loadingOlder} onPress={()=>{atBottom.current=false;void useChatStore.getState().loadOlder(tripId);}} className="mb-lg py-sm"><Text color="primary" className="text-center">{conversation.loadingOlder?'Loading…':'Load earlier messages'}</Text></Pressable>:null}
      {details&&!messages.length&&!conversation?.loading?<Text variant="caption" color="textMuted" className="text-center">No messages yet.</Text>:null}
      {messages.map(message=>{
        const mine=message.senderId===userId;
        const status=outgoingMessageStatus(message,conversation?.receipts??null,details?.participantRole??'rider');
        const failed=mine&&message.localStatus==='failed'&&!message.recordId;
        return <View key={messageKey(message)} className={`mb-md ${mine?'items-end':'items-start'}`}>
          <View className={`max-w-[82%] rounded-2xl px-lg py-md ${mine?'rounded-br-sm bg-primary':'rounded-bl-sm bg-surfaceMuted'}`}><Text color={mine?'textInverse':'text'}>{message.text}</Text></View>
          <Pressable accessibilityRole={failed?'button':undefined} accessibilityLabel={failed?'Retry failed message':undefined} disabled={!failed} onPress={()=>{void retry(message.id);}} className="mt-xs px-xs py-xs">
            <Text variant="caption" color={failed?'danger':'textMuted'}>{new Date(message.sentAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}{mine?` · ${status}`:''}</Text>
          </Pressable>
          {failed?<Pressable accessibilityRole="button" accessibilityLabel="Discard failed message" className="px-xs py-sm" onPress={()=>{void useChatStore.getState().discard(tripId,message.id).catch(()=>setSendError('Could not discard this message. Check device storage and retry.'));}}><Text variant="caption" color="textMuted">Discard</Text></Pressable>:null}
        </View>;
      })}
    </ScrollView>
    <View className="border-t border-border bg-surface px-lg pt-sm">
      {canMessage||(!details&&draft.length>0)?<>
        {canMessage?<ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-sm pb-sm">{QUICK_REPLIES.map(reply=><Pressable key={reply} disabled={saving} onPress={()=>{void send(reply);}} className="rounded-full border border-borderStrong px-md py-sm active:opacity-70"><Text variant="caption">{reply}</Text></Pressable>)}</ScrollView>:null}
        <View className="flex-row items-end gap-sm pb-sm">
          <View className="min-h-[48px] flex-1 justify-center rounded-[24px] bg-surfaceMuted px-lg py-sm"><TextInput accessibilityLabel="Message" className="max-h-24 border-0 p-0 font-inter-regular text-body text-text outline-none" multiline editable={!saving} maxLength={maxLength} onChangeText={value=>{void useChatStore.getState().setDraft(tripId,value).catch(()=>setSendError('Your draft is kept on this screen, but could not be saved on this device.'));}} placeholder="Message" placeholderTextColor={theme.colors.textMuted} selectionColor={theme.colors.primary} value={draft}/></View>
          <Pressable accessibilityRole="button" accessibilityLabel="Send message" disabled={saving||!canMessage||!draft.trim()} onPress={()=>{void send();}} className={`h-12 w-12 items-center justify-center rounded-full bg-primary ${saving||!canMessage||!draft.trim()?'opacity-40':'active:opacity-80'}`}><Text variant="h3" color="textInverse">↑</Text></Pressable>
        </View>
        <Text variant="caption" color="textMuted" className="pb-sm">{canMessage?'Pending messages retry when you reconnect. Sent means saved by Rakky Ride.':'Reconnect to send your saved draft.'}</Text>
      </>:<><Text variant="caption" color="textMuted" className="py-md text-center">{details?'This conversation is read-only.':'Connect to load this trip conversation.'}</Text>
        {draft?<Text selectable variant="caption" color="textMuted" className="pb-md">Unsent draft: {draft}</Text>:null}</>}
      <SafeAreaView edges={['bottom']}/>
    </View>
    {callOpen?<TripCallOptions tripId={tripId} participantName={participantName} onClose={()=>setCallOpen(false)}/>:null}
  </KeyboardAvoidingView>;
}
