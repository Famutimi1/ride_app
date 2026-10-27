import { useEffect,useState } from 'react';
import { Modal,Pressable,View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button,Text } from '@/components/common';
import { nativeWindTheme,useTheme } from '@/constants/theme';
import { getTripCommunication,type TripCommunication } from '@/services/communicationService';

export const videoUnavailableCopy:Record<string,string>={
  video_disabled:'Video calling is not enabled yet.',
  video_before_trip_only:'Video is available only before the trip starts.',
  driver_location_unavailable:'Video needs a fresh driver location.',
  driver_location_stale:'Waiting for a fresh driver location before enabling video.',
  driver_must_be_stationary:'Video is available when the driver is stationary.',
};
export function TripCallOptions({tripId,participantName,onClose}:{tripId:string;participantName:string;onClose:()=>void}) {
  const router=useRouter(),theme=useTheme();
  const [details,setDetails]=useState<TripCommunication|null>(null),[error,setError]=useState(false);
  const [now,setNow]=useState(()=>Date.now());
  useEffect(()=>{
    let live=true,pending=false;
    const refresh=async()=>{if(pending)return;pending=true;try{const next=await getTripCommunication(tripId);if(live){setDetails(next);setError(false);}}catch{if(live)setError(true);}finally{pending=false;}};
    void refresh();const timer=setInterval(()=>{setNow(Date.now());void refresh();},2000);
    return ()=>{live=false;clearInterval(timer);};
  },[tripId]);
  const open=(type:'audio'|'video')=>{onClose();router.push({pathname:'/trip-call',params:{tripId,type}});};
  const canVideo=!error&&details?.canVideoCall&&(details.videoValidUntil??0)>now;
  return <Modal transparent visible animationType="fade" onRequestClose={onClose}>
    <View className="flex-1 items-center justify-center px-xl" style={[nativeWindTheme[theme.scheme],{backgroundColor:theme.colors.overlay}]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Close call options" onPress={onClose} style={{position:'absolute',inset:0}}/>
      <View accessibilityViewIsModal className="w-full rounded-xl bg-surface p-xl" style={{maxWidth:420}}>
        <Text variant="h3">Call {participantName}</Text>
        <Text color="textMuted" className="mt-xs">Choose how you want to call your trip participant.</Text>
        <Button label="Audio call" fullWidth className="mt-lg" disabled={error||!details?.canAudioCall} onPress={()=>open('audio')}/>
        <Button label="Video call" variant="outline" fullWidth className="mt-sm" disabled={!canVideo} onPress={()=>open('video')}/>
        <Text variant="caption" color="textMuted" className="mt-sm">{error?'Could not check call availability. Retrying…':!details?'Checking call availability…':details.status!=='open'?'Calls are closed for this trip.':canVideo?'Video requires camera access and agreement from both participants.':videoUnavailableCopy[details.videoUnavailableReason??'']??'Video is unavailable right now.'}</Text>
        <Button label="Cancel" variant="ghost" fullWidth className="mt-sm" onPress={onClose}/>
      </View>
    </View>
  </Modal>;
}
