import { useMemo, useState } from 'react';
import { Linking, Modal, Pressable, ScrollView, Share, View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppMap, type AppMapMarker } from '@/components/map';
import { Button, Text } from '@/components/common';
import { nativeWindTheme, useTheme } from '@/constants/theme';
import { decodePolyline } from '@/utils/polyline';
import { useMapStore } from '@/store/mapStore';
import { useTripStore } from '@/store/tripStore';

const REASONS=['Driver is taking too long','I no longer need the ride','Pickup details are incorrect'] as const;

export function OngoingTripScreen(){
  const router=useRouter(),theme=useTheme();
  const trip=useTripStore(s=>s.trip),driverLocation=useTripStore(s=>s.driverLocation),cancelTrip=useTripStore(s=>s.cancel),clearTrip=useTripStore(s=>s.clear),loading=useTripStore(s=>s.loading);
  const region=useMapStore(s=>s.cameraRegion),clearTripMap=useMapStore(s=>s.clearTripMap);
  const [cancelOpen,setCancelOpen]=useState(false),[safetyOpen,setSafetyOpen]=useState(false),[callOpen,setCallOpen]=useState(false),[reason,setReason]=useState<string>(REASONS[0]);
  const route=trip?.route_polyline?decodePolyline(trip.route_polyline):[];
  const driverName=trip?.driver_name??'Your driver',hasDriver=Boolean(trip?.driver_id);
  const markers=useMemo<AppMapMarker[]>(()=>trip?[
    {id:'pickup',kind:'pickup',latitude:trip.pickup_lat,longitude:trip.pickup_lng,title:'Pickup'},
    {id:'dropoff',kind:'dropoff',latitude:trip.dropoff_lat,longitude:trip.dropoff_lng,title:'Destination'},
    ...(hasDriver?[{id:'driver',kind:'driver' as const,latitude:driverLocation?.latitude??trip.pickup_lat,longitude:driverLocation?.longitude??trip.pickup_lng,heading:driverLocation?.heading,title:driverName}]:[]),
  ]:[],[driverLocation,driverName,hasDriver,trip]);

  if(!trip)return <Redirect href="/home"/>;
  if(trip.status==='no_drivers_found')return <SafeAreaView className="flex-1 items-center justify-center bg-background px-xl"><View className="h-20 w-20 items-center justify-center rounded-full bg-warningSoft"><Text variant="h2" color="warning">⌁</Text></View><Text variant="h2" className="mt-xl text-center">No drivers found nearby</Text><Text color="textMuted" className="mt-sm text-center">Try again in a moment or adjust your pickup point.</Text><Button label="Try again" fullWidth className="mt-xl" onPress={()=>{clearTrip();router.replace('/ride-selection');}}/><Button label="Change pickup" variant="outline" fullWidth className="mt-sm" onPress={()=>{clearTrip();router.replace('/set-destination');}}/></SafeAreaView>;

  const statusCopy={searching:['Finding your driver','We are sending your request to nearby approved drivers.'],driver_assigned:[`${driverName} is on the way`,'Follow the live driver location on the map.'],driver_arrived:[`${driverName} has arrived`,'Meet your driver at the pickup point.'],in_progress:['Ride in progress','Heading safely to your destination.'],completed:['Ride completed','Thanks for riding with Rakky Ride.'],cancelled:['Ride cancelled','This ride is no longer active.'],no_drivers_found:['No drivers found','Try again shortly.']}[trip.status];
  const cancel=async()=>{await cancelTrip(reason);setCancelOpen(false);clearTripMap();router.replace('/home');};
  const share=()=>Share.share({message:`Rakky Ride from ${trip.pickup_address} to ${trip.dropoff_address}${hasDriver?` with ${driverName} (${trip.plate_number??'vehicle details pending'})`:''}.`});

  return <View className="flex-1 bg-background">
    <AppMap region={region} markers={markers} polyline={route} followsUserLocation mapPadding={{top:100,right:36,bottom:390,left:36}}/>
    <SafeAreaView edges={['top']} className="absolute left-lg right-lg top-0"><View className="flex-row items-center gap-md"><Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={()=>router.replace('/home')} className="h-12 w-12 items-center justify-center rounded-full bg-surface shadow-md"><Text variant="h3">←</Text></Pressable><View className="flex-1 rounded-xl bg-surface px-lg py-md shadow-md"><Text variant="bodyMedium" numberOfLines={1}>{trip.status==='in_progress'?'On the way to destination':trip.status==='searching'?'Contacting nearby drivers':'Driver tracking active'}</Text><Text variant="caption" color="textMuted" numberOfLines={1}>{trip.dropoff_address}</Text></View></View></SafeAreaView>
    <View className="absolute bottom-0 left-0 right-0 max-h-[70%] rounded-t-[28px] bg-surface shadow-lg"><View className="items-center py-md"><View className="h-1 w-12 rounded-full bg-borderStrong"/></View><ScrollView contentContainerClassName="px-xl pb-xl" showsVerticalScrollIndicator={false}>
      <Text variant="caption" color="secondary" className="uppercase tracking-widest">{trip.status.replaceAll('_',' ')}</Text><Text variant="h2" className="mt-xs !text-[28px]">{statusCopy[0]}</Text><Text color="textMuted">{statusCopy[1]}</Text>
      {hasDriver?<><View className="mt-lg flex-row items-center"><View className="h-16 w-16 items-center justify-center rounded-full bg-successSoft"><Text variant="h2" color="success">{driverName.charAt(0)}</Text></View><View className="ml-md flex-1"><Text variant="h3" className="!text-[20px]">{driverName}</Text><Text variant="bodyMedium">{trip.driver_rating??'New'} <Text color="warning">★</Text></Text><Text variant="caption" color="textMuted">{trip.plate_number??'Plate pending'} · {[trip.vehicle_color,trip.vehicle_make,trip.vehicle_model].filter(Boolean).join(' ')}</Text></View><Text variant="h2">🚙</Text></View><View className="mt-lg flex-row rounded-xl bg-surfaceMuted py-md"><TripAction icon="•••" label="Message" onPress={()=>router.push({pathname:'/trip-chat',params:{tripId:trip.id,participantName:driverName}})}/><View className="w-px bg-border"/><TripAction icon="☎" label="Call" onPress={()=>setCallOpen(true)}/><View className="w-px bg-border"/><TripAction icon="◆" label="Safety" onPress={()=>setSafetyOpen(true)}/></View></>:<View className="mt-lg items-center rounded-xl bg-primarySoft p-xl"><Text variant="h3" color="primary">Searching…</Text><Text variant="caption" color="textMuted" className="mt-xs text-center">Offers are sent one driver at a time to find the nearest available car.</Text></View>}
      <View className="mt-md rounded-xl bg-surfaceMuted p-md"><RouteRow label="Pickup" value={trip.pickup_address}/><View className="my-xs ml-[5px] h-4 w-px bg-borderStrong"/><RouteRow label="Destination" value={trip.dropoff_address}/></View>
      <View className="mt-md flex-row items-center rounded-xl border border-border p-md"><View className="flex-1"><Text variant="caption" color="textMuted">{trip.payment_method==='wallet'?'Rakky Ride wallet':'Cash payment'}</Text><Text variant="bodyMedium">Upfront fare</Text></View><Text variant="h3">₦{Math.round(trip.fare_kobo/100).toLocaleString()}</Text></View>
      {trip.status!=='in_progress'?<Button label="Cancel ride" variant="outline" fullWidth className="mt-md" onPress={()=>setCancelOpen(true)}/>:null}
      {hasDriver?<Button label="Share ride details" fullWidth className="mt-sm" onPress={()=>void share()}/>:null}
    </ScrollView></View>

    <Modal visible={cancelOpen} transparent animationType="fade" onRequestClose={()=>setCancelOpen(false)}><Pressable onPress={()=>setCancelOpen(false)} className="flex-1 items-center justify-center px-xl" style={[nativeWindTheme[theme.scheme],{backgroundColor:theme.colors.overlay}]}><Pressable onPress={event=>event.stopPropagation()} className="w-full rounded-xl bg-surface p-xl"><Text variant="h3">Cancel this ride?</Text><Text color="textMuted" className="mt-xs">Tell us why. Cancellation charges are not applied during MVP.</Text><View className="mt-md gap-sm">{REASONS.map(item=><Pressable key={item} onPress={()=>setReason(item)} className={`rounded-lg border p-md ${reason===item?'border-danger bg-dangerSoft':'border-border'}`}><Text variant="caption">{item}</Text></Pressable>)}</View><Button label="Cancel ride" variant="destructive" fullWidth loading={loading} className="mt-lg" onPress={()=>void cancel()}/><Button label="Keep ride" variant="ghost" fullWidth onPress={()=>setCancelOpen(false)}/></Pressable></Pressable></Modal>
    <Modal visible={callOpen} transparent animationType="fade" onRequestClose={()=>setCallOpen(false)}><Pressable onPress={()=>setCallOpen(false)} className="flex-1 items-center justify-center px-xl" style={[nativeWindTheme[theme.scheme],{backgroundColor:theme.colors.overlay}]}><View className="w-full rounded-xl bg-surface p-xl"><Text variant="h3">Call {driverName}</Text><Text color="textMuted" className="mt-xs">Choose a secure in-app call.</Text><Button label="Audio call" fullWidth className="mt-lg" onPress={()=>{setCallOpen(false);router.push({pathname:'/trip-call',params:{tripId:trip.id,participantName:driverName,type:'audio'}});}}/><Button label="Video call" variant="outline" fullWidth className="mt-sm" onPress={()=>{setCallOpen(false);router.push({pathname:'/trip-call',params:{tripId:trip.id,participantName:driverName,type:'video'}});}}/></View></Pressable></Modal>
    <Modal visible={safetyOpen} transparent animationType="fade" onRequestClose={()=>setSafetyOpen(false)}><Pressable onPress={()=>setSafetyOpen(false)} className="flex-1 items-center justify-center px-xl" style={[nativeWindTheme[theme.scheme],{backgroundColor:theme.colors.overlay}]}><View className="w-full rounded-xl bg-surface p-xl"><Text variant="h3">Safety center</Text><Text color="textMuted" className="mt-xs">Your trip and driver location are being tracked.</Text><Button label="Share live trip" fullWidth className="mt-lg" onPress={()=>void share()}/><Button label="Call emergency services · 112" variant="destructive" fullWidth className="mt-sm" onPress={()=>void Linking.openURL('tel:112')}/></View></Pressable></Modal>
  </View>;
}

function TripAction({icon,label,onPress}:{icon:string;label:string;onPress:()=>void}){return <Pressable accessibilityRole="button" onPress={onPress} className="flex-1 items-center"><Text variant="bodyMedium" color="icon">{icon}</Text><Text variant="caption" color="textMuted" className="mt-xs">{label}</Text></Pressable>;}
function RouteRow({label,value}:{label:string;value:string}){return <View className="flex-row gap-md"><Text color={label==='Pickup'?'primary':'danger'}>●</Text><View className="flex-1"><Text variant="caption" color="textMuted">{label}</Text><Text variant="bodyMedium" numberOfLines={2}>{value}</Text></View></View>;}
