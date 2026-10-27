import { feedback } from '@/store/feedbackStore';
import { AppMessage } from '@/components/common/AppMessage';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Share, View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppMap, type AppMapMarker } from '@/components/map';
import { Button, Text } from '@/components/common';
import { useMapStore } from '@/store/mapStore';
import { useTripStore } from '@/store/tripStore';
import { useLiveDriverTracking } from '@/hooks/useLiveDriverTracking';
import { useTripMapRoute } from '@/hooks/useTripMapRoute';
import { getCourierDeliveryCode, rotateCourierDeliveryCode } from '@/services/tripService';
import { apiErrorMessage } from '@/lib/apiClient';
import { DriverSearchView } from './DriverSearchView';
import { NoDriversFoundView } from './NoDriversFoundView';
import { prepareTripRetry } from '@/utils/tripRetry';
import { activeTripRegion } from '@/utils/tripCamera';
import { TripCallOptions } from '@/components/communication/TripCallOptions';
import { TripCancellationModal } from '@/components/trip/TripCancellationModal';

export function OngoingTripScreen(){
  const router=useRouter();
  const trip=useTripStore(s=>s.trip),driverLocation=useTripStore(s=>s.driverLocation),cancelTrip=useTripStore(s=>s.cancel),clearTrip=useTripStore(s=>s.clear),loading=useTripStore(s=>s.loading);
  useLiveDriverTracking(trip?.id);
  const region=useMapStore(s=>s.cameraRegion),clearTripMap=useMapStore(s=>s.clearTripMap);
  const [cancelOpen,setCancelOpen]=useState(false),[callOpen,setCallOpen]=useState(false);
  const [deliveryCode,setDeliveryCode]=useState<string|null>(null);
  const [rotatingCode,setRotatingCode]=useState(false);
  const [codeError,setCodeError]=useState<string|null>(null);
  const [now,setNow]=useState(0);
  useEffect(()=>{const tick=()=>setNow(Date.now());const first=setTimeout(tick,0);const timer=setInterval(tick,10_000);return()=>{clearTimeout(first);clearInterval(timer);};},[]);
  const currentTripId=trip?.id,currentServiceType=trip?.service_type;
  useEffect(()=>{if(!currentTripId||currentServiceType!=='courier')return;let active=true;void getCourierDeliveryCode(currentTripId).then(code=>{if(active)setDeliveryCode(code);}).catch(()=>{});return()=>{active=false;};},[currentTripId,currentServiceType]);
  const driverName=trip?.driver_name??'Your driver',hasDriver=Boolean(trip?.driver_id);
  const liveDriver=driverLocation&&driverLocation.driverId===trip?.driver_id && now>0 && now-driverLocation.timestamp<45_000 ? driverLocation:null;
  const route=useTripMapRoute(trip,liveDriver);
  const followRegion=activeTripRegion(trip?.status,liveDriver);
  const markers=useMemo<AppMapMarker[]>(()=>trip?[
    {id:'pickup',kind:'pickup',latitude:trip.pickup_lat,longitude:trip.pickup_lng,title:'Pickup'},
    {id:'dropoff',kind:'dropoff',latitude:trip.dropoff_lat,longitude:trip.dropoff_lng,title:'Destination'},
    ...(hasDriver&&liveDriver?[{id:'driver',kind:'driver' as const,latitude:liveDriver.latitude,longitude:liveDriver.longitude,heading:liveDriver.heading,title:driverName}]:[]),
  ]:[],[liveDriver,driverName,hasDriver,trip]);

  if(!trip)return <Redirect href="/home"/>;
  if(trip.status==='scheduled')return <Redirect href="/schedule"/>;
  if(trip.status==='no_drivers_found') {
    const retry = (changePickup = false) => {
      const target = prepareTripRetry(trip, changePickup);
      clearTrip();
      router.replace(target);
    };
    return <NoDriversFoundView pickupAddress={trip.pickup_address} courier={trip.service_type==='courier'} onRetry={()=>retry()} onChangePickup={()=>retry(true)} onHome={()=>{clearTrip();router.replace('/home');}}/>;
  }

  const statusCopy={searching:['Finding your driver','We are sending your request to nearby approved drivers.'],driver_assigned:[`${driverName} is on the way`,'Follow the live driver location on the map.'],driver_arrived:[`${driverName} has arrived`,'Meet your driver at the pickup point.'],in_progress:['Ride in progress','Heading safely to your destination.'],returning:['Returning','The package is going back to its sender.'],returned:['Returned','The package was handed back to its sender.'],completed:['Ride completed','Thanks for riding with Rakky Ride.'],cancelled:['Ride cancelled','This ride is no longer active.'],no_drivers_found:['No drivers found','Try again shortly.']}[trip.status];
  const courier=trip.service_type==='courier';
  const courierCopy={searching:['Finding a delivery driver','We are sending your package request to nearby drivers.'],driver_assigned:[`${driverName} is coming for your package`,'Meet the driver at pickup and hand over the sealed package.'],driver_arrived:[`${driverName} is at pickup`,'Hand the package directly to the driver.'],in_progress:['Package on its way','Your recipient must meet the driver and provide the delivery code.'],returning:['Package returning to you','The recipient could not receive it. Meet the driver at the pickup address and provide the code after the package is handed back.'],returned:['Package returned','The sender confirmed the return. The original delivery fare was charged.'],completed:['Package delivered','The recipient confirmed the handoff.'],cancelled:['Delivery cancelled','This delivery is no longer active.'],no_drivers_found:['No drivers found','Try again shortly.']}[trip.status];
  const cancel=async(reason:string)=>{await cancelTrip(reason);setCancelOpen(false);clearTripMap();router.replace('/home');};
  const shareText = (message: string) => Share.share({ message }).catch(() => { feedback.error('We couldn’t open sharing. Please try again.'); });
  const share=()=>shareText(`Rakky Ride from ${trip.pickup_address} to ${trip.dropoff_address}${hasDriver?` with ${driverName} (${trip.plate_number??'vehicle details pending'})`:''}.`);

  const courierDetails = courier&&trip.courier_details?<View className="mt-md rounded-xl bg-surfaceMuted p-md"><Text variant="bodyMedium">📦 {trip.courier_details.description}</Text><Text variant="caption" color="textMuted">Recipient: {trip.courier_details.recipientName} · {trip.courier_details.recipientPhone}</Text>{deliveryCode?<><Text variant="caption" color="primary" className="mt-sm">{trip.status==='returning'?'Sender handoff code':'Delivery code for recipient'}</Text><Text variant="h2">{deliveryCode}</Text><Text variant="caption" color="textMuted">{trip.status==='returning'?'Give the code to the driver only after your package is returned.':'Share this code with the recipient, not the driver.'}</Text>{trip.status!=='returning'?<Button label="Share code with recipient" variant="outline" fullWidth className="mt-sm" onPress={()=>void shareText(`Rakky Ride delivery to ${trip.courier_details?.recipientName}: give code ${deliveryCode} to the driver only when your package arrives.`)}/>:null}{trip.status==='in_progress'||trip.status==='returning'?<Button label="Generate a new code" variant="ghost" fullWidth className="mt-xs" loading={rotatingCode} onPress={()=>{setRotatingCode(true);void rotateCourierDeliveryCode(trip.id).then(code=>{setDeliveryCode(code);setCodeError(null);}).catch(reason=>setCodeError(apiErrorMessage(reason))).finally(()=>setRotatingCode(false));}}/>:null}</>:null}{codeError?<AppMessage message={codeError} />:null}</View>:null;

  return <View className="flex-1 bg-background">
    {trip.status==='searching' ? <DriverSearchView trip={trip} deliveryCode={deliveryCode} onShareCode={()=>void shareText(`Rakky Ride delivery to ${trip.courier_details?.recipientName}: give code ${deliveryCode} to the driver only when your package arrives.`)} mapProps={{region,markers,polyline:route.primary,secondaryPolyline:route.secondary,followsUserLocation:true}} onBack={()=>router.replace('/home')} onCancel={()=>setCancelOpen(true)} /> : <>
    <AppMap region={followRegion??region} markers={markers} polyline={route.primary} secondaryPolyline={route.secondary} fitRouteOnChange={!followRegion} mapPadding={{top:100,right:36,bottom:390,left:36}}/>
    {hasDriver&&!liveDriver?<View className="absolute left-lg right-lg top-24 rounded-lg bg-surface px-md py-sm shadow-sm"><Text variant="caption" color="textMuted">Waiting for the driver’s live location</Text></View>:null}
    <SafeAreaView edges={['top']} className="absolute left-lg right-lg top-0"><View className="flex-row items-center gap-md"><Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={()=>router.replace('/home')} className="h-12 w-12 items-center justify-center rounded-full bg-surface shadow-md"><Text variant="h3">←</Text></Pressable><View className="flex-1 rounded-xl bg-surface px-lg py-md shadow-md"><Text variant="bodyMedium" numberOfLines={1}>{trip.status==='returning'?'Returning to sender':trip.status==='in_progress'?courier?'Package on its way':'On the way to destination':'Driver tracking active'}</Text><Text variant="caption" color="textMuted" numberOfLines={1}>{trip.status==='returning'?trip.pickup_address:trip.dropoff_address}</Text></View></View></SafeAreaView>
    <View className="absolute bottom-0 left-0 right-0 max-h-[70%] rounded-t-[28px] bg-surface shadow-lg"><View className="items-center py-md"><View className="h-1 w-12 rounded-full bg-borderStrong"/></View><ScrollView contentContainerClassName="px-xl pb-xl" showsVerticalScrollIndicator={false}>
      <Text variant="caption" color="secondary" className="uppercase tracking-widest">{courier?'Courier delivery':trip.status.replaceAll('_',' ')}</Text><Text variant="h2" className="mt-xs">{(courier?courierCopy:statusCopy)[0]}</Text><Text color="textMuted">{(courier?courierCopy:statusCopy)[1]}</Text>
      {courierDetails}
      {hasDriver?<><View className="mt-lg flex-row items-center"><View className="h-12 w-12 items-center justify-center rounded-full bg-successSoft"><Text variant="h2" color="success">{driverName.charAt(0)}</Text></View><View className="ml-md flex-1"><Text variant="h3">{driverName}</Text><Text variant="bodyMedium">{trip.driver_rating??'New'} <Text color="warning">★</Text></Text><Text variant="caption" color="textMuted">{trip.plate_number??'Plate pending'} · {[trip.vehicle_color,trip.vehicle_make,trip.vehicle_model].filter(Boolean).join(' ')}</Text></View><Text variant="h2">🚙</Text></View><View className="mt-lg flex-row rounded-xl bg-surfaceMuted py-md"><TripAction icon="•••" label="Message" onPress={()=>router.push({pathname:'/trip-chat',params:{tripId:trip.id,participantName:driverName}})}/><View className="w-px bg-border"/><TripAction icon="☎" label="Call" onPress={()=>setCallOpen(true)}/><View className="w-px bg-border"/><TripAction icon="◆" label="Safety" onPress={()=>router.push({pathname:'/account/[section]',params:{section:'safety'}})}/></View></>:null}
      <View className="mt-md rounded-xl bg-surfaceMuted p-md"><RouteRow label="Pickup" value={trip.pickup_address}/><View className="my-xs ml-[5px] h-4 w-px bg-borderStrong"/><RouteRow label="Destination" value={trip.dropoff_address}/></View>
      <View className="mt-md flex-row items-center rounded-xl border border-border p-md"><View className="flex-1"><Text variant="caption" color="textMuted">{trip.payment_method==='wallet'?'Rakky Ride wallet':'Cash payment'}</Text><Text variant="bodyMedium">{courier?'Delivery fare':'Upfront fare'}</Text></View><Text variant="h3">₦{Math.round(trip.fare_kobo/100).toLocaleString()}</Text></View>
      {trip.status!=='in_progress'?<Button label={courier?'Cancel delivery':'Cancel ride'} variant="outline" fullWidth className="mt-md" onPress={()=>setCancelOpen(true)}/>:null}
      {hasDriver?<Button label={courier?'Share delivery details':'Share ride details'} fullWidth className="mt-sm" onPress={()=>void share()}/>:null}
    </ScrollView></View>
    </>}

    {cancelOpen ? <TripCancellationModal courier={courier} busy={loading} onKeep={()=>setCancelOpen(false)} onConfirm={cancel} /> : null}
    {callOpen ? <TripCallOptions tripId={trip.id} participantName={driverName} onClose={()=>setCallOpen(false)} /> : null}
  </View>;
}

function TripAction({icon,label,onPress}:{icon:string;label:string;onPress:()=>void}){return <Pressable accessibilityRole="button" onPress={onPress} className="flex-1 items-center"><Text variant="bodyMedium" color="icon">{icon}</Text><Text variant="caption" color="textMuted" className="mt-xs">{label}</Text></Pressable>;}
function RouteRow({label,value}:{label:string;value:string}){return <View className="flex-row gap-md"><Text color={label==='Pickup'?'primary':'danger'}>●</Text><View className="flex-1"><Text variant="caption" color="textMuted">{label}</Text><Text variant="bodyMedium" numberOfLines={2}>{value}</Text></View></View>;}
