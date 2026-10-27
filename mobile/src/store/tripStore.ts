import { UserFacingError } from '@/utils/userMessage';
import { create } from 'zustand';
import { apiErrorMessage } from '@/lib/apiClient';
import * as api from '@/services/tripService';
import { useAuthStore } from '@/store/authStore';
import { tripBelongsToRole } from '@/utils/roleAccess';

interface TripState{
  trip:api.Trip|null;offer:api.TripOffer|null;driverLocation:api.DriverLocation|null;loading:boolean;error:string|null;
  recover:()=>Promise<api.Trip|null>;refreshCurrent:()=>Promise<api.Trip|null>;request:(input:api.TripRequest,key:string)=>Promise<api.Trip>;
  cancel:(reason:string)=>Promise<void>;acceptOffer:()=>Promise<void>;declineOffer:()=>Promise<void>;arrived:()=>Promise<void>;start:()=>Promise<void>;returnDelivery:(reason:string)=>Promise<void>;complete:(deliveryCode?:string)=>Promise<void>;rate:(rating:number,comment?:string)=>Promise<void>;
  applyStatus:(event:{tripId:string;status:api.TripStatus;driverId?:string|null;driver?:Record<string,unknown>})=>void;setOffer:(offer:api.TripOffer|null)=>void;setDriverLocation:(location:api.DriverLocation)=>void;clear:()=>void;
}

let tripGeneration = 0;
const run = async <T>(set: (value: Partial<TripState>) => void, work: (update: (value: Partial<TripState>) => void) => Promise<T>, requiredRole?: AppTripRole) => {
  const user = useAuthStore.getState().session?.user;
  if (!user || (requiredRole && user.role !== requiredRole)) throw new Error('Switch to the correct mode to continue.');
  const generation = tripGeneration;
  const isCurrent = () => {
    const current = useAuthStore.getState().session?.user;
    return generation === tripGeneration && current?.id === user.id && current.role === user.role;
  };
  const update: typeof set = (value) => {
    if (isCurrent() && (!value.trip || tripBelongsToRole(value.trip, user.id, user.role))) set(value);
  };
  update({ loading: true, error: null });
  try {
    const result = await work(update);
    if (!isCurrent()) throw new Error('Your account or app mode changed. Open the current page and try again.');
    return result;
  }
  catch (error) {
    const message = apiErrorMessage(error);
    update({ error: message });
    if (error instanceof api.TripQuoteError) throw error;
    throw new UserFacingError(message);
  } finally { update({ loading: false }); }
};

export const useTripStore=create<TripState>((set,get)=>({trip:null,offer:null,driverLocation:null,loading:false,error:null,
  recover:()=>run(set,async(update)=>{
    const user=useAuthStore.getState().session!.user;
    const [candidate,offer]=await Promise.all([api.getActiveTrip(),user.role==='driver'?api.getCurrentOffer():Promise.resolve(null)]);
    const trip=tripBelongsToRole(candidate,user.id,user.role)?candidate:null;
    update({trip,offer:trip?null:offer?{...offer,receivedAt:Date.now()}:null,driverLocation:trip?.latestDriverLocation??null});
    return trip;
  }),
  refreshCurrent:async()=>{
    const generation=tripGeneration,user=useAuthStore.getState().session?.user,current=get().trip;
    if(!user||!current||!tripBelongsToRole(current,user.id,user.role))return null;
    const trip=await api.getTrip(current.id),latest=useAuthStore.getState().session?.user;
    if(generation!==tripGeneration||latest?.id!==user.id||latest.role!==user.role||!tripBelongsToRole(trip,user.id,user.role))return null;
    if(get().trip?.id===trip.id)set({trip,driverLocation:trip.latestDriverLocation??get().driverLocation});return trip;
  },
  request:(input,key)=>run(set,async(update)=>{const{trip}=await api.requestTrip(input,key);update({trip:trip.status==='scheduled'?null:trip,offer:null,driverLocation:null});return trip;},'rider'),
  cancel:(reason)=>run(set,async(update)=>{const trip=ownedTrip(get().trip);if(!trip)return;await api.cancelTrip(trip.id,reason);update({trip:null,driverLocation:null,offer:null});}),
  acceptOffer:()=>run(set,async(update)=>{const offer=get().offer;if(!offer)return;const trip=await api.acceptTrip(offer.tripId);update({trip,offer:null});},'driver'),
  declineOffer:()=>run(set,async(update)=>{const offer=get().offer;if(!offer)return;await api.declineTrip(offer.tripId);update({offer:null});},'driver'),
  arrived:()=>run(set,async(update)=>{const trip=ownedTrip(get().trip);if(trip)update({trip:await api.driverArrived(trip.id)});},'driver'),
  start:()=>run(set,async(update)=>{const trip=ownedTrip(get().trip);if(trip)update({trip:await api.startTrip(trip.id)});},'driver'),
  returnDelivery:(reason)=>run(set,async(update)=>{const trip=ownedTrip(get().trip);if(trip)update({trip:await api.returnCourierDelivery(trip.id,reason)});},'driver'),
  complete:(deliveryCode)=>run(set,async(update)=>{const trip=ownedTrip(get().trip);if(trip)update({trip:await api.completeTrip(trip.id,deliveryCode)});},'driver'),
  rate:(rating,comment)=>run(set,async()=>{const trip=ownedTrip(get().trip);if(trip)await api.rateTrip(trip.id,rating,comment);}),
  applyStatus:(event)=>set((state)=>{if(state.trip?.id!==event.tripId)return{};const driver=event.driver;return{trip:{...state.trip,status:event.status,driver_id:event.driverId??state.trip.driver_id,...(driver?{driver_name:String(driver.driver_name??driver.name??state.trip.driver_name??''),driver_avatar:String(driver.driver_avatar??driver.photo??state.trip.driver_avatar??''),driver_rating:String(driver.driver_rating??driver.rating??state.trip.driver_rating??''),plate_number:String(driver.plate_number??driver.plate??state.trip.plate_number??''),vehicle_model:String(driver.vehicle_model??driver.vehicle??state.trip.vehicle_model??'')}: {})}};}),
  setOffer:(offer)=>set({offer:offer&&useAuthStore.getState().session?.user.role==='driver'?{...offer,receivedAt:Date.now()}:null}),setDriverLocation:(driverLocation)=>set(state=>state.trip?.driver_id===driverLocation.driverId&&(!driverLocation.tripId||driverLocation.tripId===state.trip.id)?{driverLocation}:{}),clear:()=>{tripGeneration+=1;set({trip:null,offer:null,driverLocation:null,error:null,loading:false});},
}));

function ownedTrip(trip:api.Trip|null){
  const user=useAuthStore.getState().session?.user;
  return user&&tripBelongsToRole(trip,user.id,user.role)?trip:null;
}

export type AppTripRole='rider'|'driver';
export function routeForTrip(trip:api.Trip,role:AppTripRole){
  if(trip.status==='scheduled')return'/schedule' as const;
  if(trip.status==='completed'||trip.status==='returned')return'/trip-complete' as const;
  if(trip.status==='cancelled')return role==='driver'?'/driver-dashboard':'/home';
  if(trip.status==='no_drivers_found')return role==='driver'?'/driver-dashboard':'/ongoing-trip';
  return role==='driver'?'/driver-trip':'/ongoing-trip';
}
