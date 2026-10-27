import { AppMessage } from '@/components/common/AppMessage';
import { useEffect,useState } from 'react';
import { Platform,Pressable,ScrollView,View } from 'react-native';
import { Redirect,useLocalSearchParams,useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button,Text } from '@/components/common';
import { CallVideo } from '@/components/communication/CallVideo';
import { videoUnavailableCopy } from '@/components/communication/TripCallOptions';
import { useAuthStore } from '@/store/authStore';
import { useCallStore } from '@/store/callStore';
import { getTripCommunication,type TripCommunication } from '@/services/communicationService';
import { audioMediaAvailable } from '@/services/calling/audioMedia';
import type { CallMedia } from '@/services/calling/callTypes';
import { roleHome } from '@/utils/roleAccess';
import { useTheme } from '@/constants/theme';

export function TripCallScreen(){
  const user=useAuthStore(state=>state.session?.user);
  const params=useLocalSearchParams<{tripId?:string|string[];type?:string|string[]}>();
  const tripId=Array.isArray(params.tripId)?params.tripId[0]:params.tripId;
  if(!user)return <Redirect href="/welcome"/>;
  if(!tripId||!/^[0-9a-f-]{36}$/i.test(tripId))return <Redirect href={roleHome(user.role)}/>;
  return <CallContent key={`${user.id}:${tripId}`} tripId={tripId} preferred={params.type==='video'?'video':'audio'}/>;
}
function CallContent({tripId,preferred}:{tripId:string;preferred:CallMedia}){
  const router=useRouter();
  const {colors}=useTheme();
  const {call,controller,busy,connected,muted,speaker,error,backgroundCallsReady,playbackBlocked,localVideo,remoteVideo,videoStopped,localVideoMirrored}=useCallStore();
  const [details,setDetails]=useState<TripCommunication|null>(null);
  const [loading,setLoading]=useState(true),[loadError,setLoadError]=useState<string|null>(null);
  const [now,setNow]=useState(()=>Date.now());
  const [selected,setSelected]=useState<CallMedia>(preferred);
  const supported=audioMediaAvailable();
  useEffect(()=>{
    let live=true,refreshing=false;
    const refresh=async()=>{
      if(refreshing)return;
      refreshing=true;
      try{const value=await getTripCommunication(tripId);if(live){setDetails(value);setLoadError(null);}}
      catch{if(live)setLoadError('Could not refresh this trip. Check your connection.');}
      finally{refreshing=false;if(live)setLoading(false);}
    };
    void refresh();const timer=setInterval(()=>{void refresh();},2000);
    return ()=>{live=false;clearInterval(timer);};
  },[tripId]);
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return ()=>clearInterval(timer);},[]);
  const current=call?.tripId===tripId?call:null;
  const active=current&&!current.endedAt;
  const incoming=active&&current.deviceRole==='receiver'&&current.status==='ringing';
  const elsewhere=call&&!call.endedAt&&(call.tripId!==tripId||call.deviceRole==='observer');
  const video=active?current.media==='video':selected==='video';
  const ownId=current?.deviceRole==='caller'?current.callerId:current?.calleeId;
  const waitingForVideo=Boolean(current?.videoUpgrade?.requestedBy===ownId);
  const canVideo=details?.canVideoCall&&(details.videoValidUntil??0)>now;
  const elapsed=current?.connectedAt?Math.max(0,Math.floor((now-Date.parse(current.connectedAt))/1000)):0;
  const endedLabels:Partial<Record<NonNullable<typeof current>['status'],string>>={declined:'Call declined',missed:'No answer',cancelled:'Call cancelled',failed:'Connection failed'};
  let status=video?(canVideo?'Ready for a video call':videoUnavailableCopy[details?.videoUnavailableReason??'']??'Video is unavailable right now.')
    :details?.canAudioCall?'Ready to call':'Audio calling is not enabled yet';
  if(details?.status==='closed')status='This trip has ended. Calls are closed.';
  if(active)status=incoming?(video?'Incoming video call':'Incoming audio call'):current.status==='ringing'?'Calling…'
    :current.status==='connecting'?(video?'Connecting video…':'Connecting audio…'):connected?`${Math.floor(elapsed/60)}:${String(elapsed%60).padStart(2,'0')}`:'Reconnecting…';
  if(current?.endedAt)status=endedLabels[current.status]??'Call ended';
  if(elsewhere)status='A call is active on another trip or device';
  if(loading)status='Loading call…';
  if(loadError)status=loadError;
  if(!supported)status=Platform.OS==='web'?'Calling needs a supported browser on HTTPS or localhost.':'Use the updated Android or iOS app';
  const answerAudio=async()=>{await controller?.audioOnly();if(useCallStore.getState().call?.media==='audio')await controller?.accept();};
  const back=()=>router.canGoBack()?router.back():router.replace(details?.participantRole==='driver'?'/driver-dashboard':'/home');

  return <SafeAreaView style={{flex:1,backgroundColor:colors.background,paddingHorizontal:20}}>
    <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={back} className="mt-sm h-11 w-11 items-center justify-center rounded-full bg-surfaceMuted"><Text variant="h3">←</Text></Pressable>
    <ScrollView className="flex-1" contentContainerStyle={{flexGrow:1,justifyContent:'center',paddingVertical:16}} showsVerticalScrollIndicator={false}>
      <Text variant="h2" className="text-center">{details?.participant?.name??(video?'Trip video call':'Trip audio call')}</Text>
      <Text color="textMuted" className="mt-md text-center" accessibilityLiveRegion="polite">{status}</Text>
      {active&&video&&!videoStopped?<View className="mt-lg rounded-xl bg-surfaceMuted" style={{height:240,width:'100%',maxWidth:600,alignSelf:'center',overflow:'hidden'}}>
        {remoteVideo?<CallVideo stream={remoteVideo}/>:<View className="flex-1 items-center justify-center p-lg"><Text color="textMuted">{incoming?'Your camera starts after you accept.':'Waiting for the other camera…'}</Text></View>}
        {localVideo?<View style={{position:'absolute',bottom:12,right:12,width:90,height:120,borderRadius:12,overflow:'hidden'}}><CallVideo stream={localVideo} mirror={localVideoMirrored!==false} preview/></View>:null}
      </View>:null}
      {current?.videoReason?<Text color="textMuted" className="mt-md text-center">Video stopped. Continuing with audio. {videoUnavailableCopy[current.videoReason]??''}</Text>:null}
      <Text color="textMuted" className="mt-md mb-xl text-center">{video?'Keep the app or tab visible during video. Camera-off switches both participants to audio.':Platform.OS==='web'?'Keep this tab open. Audio output follows your browser or system settings.':backgroundCallsReady?'Trip audio call':'Keep the app open during your audio call.'}</Text>
      {details?.audioConnectionMode==='direct-only'&&(details.canAudioCall||active)?<Text color="textMuted" className="mb-lg text-center">Local call test: keep both participants on the same network. Some networks may not connect.</Text>:null}
      {error?<AppMessage message={error} className="mb-lg text-center" />:null}
      {incoming?<Button label={video?'Answer with video':'Answer'} loading={busy} onPress={()=>{void controller?.accept();}}/>:null}
      {incoming&&video?<Button label="Answer with audio" variant="secondary" className="mt-sm" disabled={busy} onPress={()=>{void answerAudio();}}/>:null}
      {active&&current.deviceRole!=='observer'?<>
        {playbackBlocked?<Button label="Enable call audio" className="mb-lg" onPress={()=>{void controller?.resumePlayback();}}/>:null}
        {current.status!=='ringing'?<>
          {!video&&current.status==='connected'?<>
            {waitingForVideo?<>
              <Text color="textMuted" className="mb-sm text-center">Waiting for the other person to accept video. Audio continues.</Text>
              <Button label="Cancel video request" variant="secondary" className="mb-md" disabled={busy} onPress={()=>{void controller?.rejectVideo();}}/>
            </>:<>
              <Button label="Switch to video" variant="secondary" className="mb-md" disabled={busy||!canVideo||Boolean(current.videoUpgrade)||!connected} onPress={()=>{void controller?.requestVideo();}}/>
              {!canVideo?<Text color="textMuted" className="mb-md text-center">{videoUnavailableCopy[details?.videoUnavailableReason??'']??'Video is unavailable right now.'}</Text>:null}
            </>}
          </>:null}
          {video?<View className="flex-row gap-md mb-md"><Button label="Flip camera" variant="secondary" className="flex-1" disabled={videoStopped} onPress={()=>{void controller?.flipCamera();}}/><Button label="Camera off" variant="secondary" className="flex-1" onPress={()=>{void controller?.audioOnly();}}/></View>:null}
          <View className="flex-row gap-md mb-lg">
            <Button className="flex-1" variant="secondary" label={muted?'Unmute':'Mute'} onPress={()=>controller?.mute()}/>
            {Platform.OS!=='web'?<Button className="flex-1" variant="secondary" label={speaker?'Speaker on':'Speaker off'} onPress={()=>controller?.speaker()}/>:null}
          </View>
        </>:null}
        <Button label={incoming?'Decline':current.status==='ringing'?'Cancel call':'End call'} variant="destructive" className="mt-md" onPress={()=>{void controller?.hangUp();}}/>
      </>:<>
        <Button label={video?'Start video call':'Start audio call'} disabled={!supported||Boolean(loadError)||(video?!canVideo:!details?.canAudioCall)||Boolean(elsewhere)||!controller} loading={busy} onPress={()=>{void controller?.start(tripId,selected);}}/>
        {video?<Button label="Use audio instead" variant="secondary" className="mt-sm" onPress={()=>setSelected('audio')}/>:null}
      </>}
      <Button label="Open trip messages" variant="ghost" className="mt-lg" onPress={()=>router.replace({pathname:'/trip-chat',params:{tripId}})}/>
    </ScrollView>
  </SafeAreaView>;
}
