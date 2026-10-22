import { useEffect } from 'react';
import { AppState } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { reconnectSocket, subscribeToTrip, subscribeToTripLifecycle } from '@/services/socket';
import { useAuthStore } from '@/store/authStore';
import { routeForTrip, useTripStore } from '@/store/tripStore';
import { tripBelongsToRole } from '@/utils/roleAccess';
import { driverServiceEnabled } from '@/utils/driverServices';

export function TripRecovery(){
  const router=useRouter(),pathname=usePathname();
  const user=useAuthStore(s=>s.session?.user),role=user?.role??'rider';
  const trip=useTripStore(s=>tripBelongsToRole(s.trip,user?.id,role)?s.trip:null),recover=useTripStore(s=>s.recover),refreshCurrent=useTripStore(s=>s.refreshCurrent),applyStatus=useTripStore(s=>s.applyStatus),setOffer=useTripStore(s=>s.setOffer),setDriverLocation=useTripStore(s=>s.setDriverLocation);
  useEffect(()=>{void recover().catch(()=>undefined);const subscription=AppState.addEventListener('change',state=>{if(state==='active'){reconnectSocket();void recover().catch(()=>undefined);}});const unsubscribe=subscribeToTripLifecycle({onOffer:(offer)=>{const services=useAuthStore.getState().driverServices;if(services&&!driverServiceEnabled(services,offer.serviceType??'ride'))return;setOffer(offer);},onOfferCancelled:({tripId})=>{if(useTripStore.getState().offer?.tripId===tripId)setOffer(null);},onStatus:(event)=>{applyStatus(event);if(event.status==='driver_assigned')void refreshCurrent().catch(()=>undefined);},onReconnect:()=>void recover().catch(()=>undefined)});return()=>{subscription.remove();unsubscribe();};},[applyStatus,recover,refreshCurrent,setOffer]);
  useEffect(()=>{if(!trip)return;const unsubscribe=subscribeToTrip(trip.id,setDriverLocation);const target=routeForTrip(trip,role);const activeFlow=target==='/ongoing-trip'||target==='/driver-trip';const safetyRoute=pathname==='/account/safety'||pathname==='/account/support';const onExpectedRoute=safetyRoute||(activeFlow?(pathname.startsWith(target)||pathname.startsWith('/trip-chat')||pathname.startsWith('/trip-call')):pathname.startsWith(target));if(!onExpectedRoute)router.replace(target);return unsubscribe;},[pathname,role,router,setDriverLocation,trip]);
  useEffect(()=>{if(trip?.status!=='searching')return;void refreshCurrent().catch(()=>undefined);const timer=setInterval(()=>void refreshCurrent().catch(()=>undefined),3000);return()=>clearInterval(timer);},[refreshCurrent,trip?.id,trip?.status]);
  useEffect(()=>{if(trip)return;const timer=setInterval(()=>{if(!useTripStore.getState().loading)void recover().catch(()=>undefined);},30000);return()=>clearInterval(timer);},[recover,trip]);
  return null;
}
