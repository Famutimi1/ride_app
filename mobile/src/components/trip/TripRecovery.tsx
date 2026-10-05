import { useEffect } from 'react';
import { AppState } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { subscribeToTrip, subscribeToTripLifecycle } from '@/services/socket';
import { useAuthStore } from '@/store/authStore';
import { routeForTrip, useTripStore } from '@/store/tripStore';

export function TripRecovery(){
  const router=useRouter(),pathname=usePathname();
  const role=useAuthStore(s=>s.session?.user.role??'rider');
  const trip=useTripStore(s=>s.trip),recover=useTripStore(s=>s.recover),refreshCurrent=useTripStore(s=>s.refreshCurrent),applyStatus=useTripStore(s=>s.applyStatus),setOffer=useTripStore(s=>s.setOffer),setDriverLocation=useTripStore(s=>s.setDriverLocation);
  useEffect(()=>{void recover().catch(()=>undefined);const subscription=AppState.addEventListener('change',state=>{if(state==='active')void recover().catch(()=>undefined);});const unsubscribe=subscribeToTripLifecycle({onOffer:setOffer,onOfferCancelled:({tripId})=>{if(useTripStore.getState().offer?.tripId===tripId)setOffer(null);},onStatus:applyStatus,onReconnect:()=>void recover().catch(()=>undefined)});return()=>{subscription.remove();unsubscribe();};},[applyStatus,recover,setOffer]);
  useEffect(()=>{if(!trip)return;const unsubscribe=subscribeToTrip(trip.id,setDriverLocation);const target=routeForTrip(trip,role);const activeFlow=target==='/ongoing-trip'||target==='/driver-trip';const onExpectedRoute=activeFlow?(pathname.startsWith(target)||pathname.startsWith('/trip-chat')||pathname.startsWith('/trip-call')):pathname.startsWith(target);if(!onExpectedRoute)router.replace(target);return unsubscribe;},[pathname,role,router,setDriverLocation,trip]);
  useEffect(()=>{if(trip?.status!=='searching')return;void refreshCurrent().catch(()=>undefined);const timer=setInterval(()=>void refreshCurrent().catch(()=>undefined),3000);return()=>clearInterval(timer);},[refreshCurrent,trip?.id,trip?.status]);
  return null;
}
