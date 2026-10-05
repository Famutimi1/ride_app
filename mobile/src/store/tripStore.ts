import { create } from 'zustand';
import { apiErrorMessage } from '@/lib/apiClient';
import * as api from '@/services/tripService';
import type { MapLocation } from './mapStore';

interface TripState{
  trip:api.Trip|null;offer:api.TripOffer|null;driverLocation:api.DriverLocation|null;loading:boolean;error:string|null;
  recover:()=>Promise<api.Trip|null>;refreshCurrent:()=>Promise<api.Trip|null>;request:(input:{pickup:MapLocation;dropoff:MapLocation;paymentMethod:api.TripPaymentMethod},key:string)=>Promise<api.Trip>;
  cancel:(reason:string)=>Promise<void>;acceptOffer:()=>Promise<void>;declineOffer:()=>Promise<void>;arrived:()=>Promise<void>;start:()=>Promise<void>;complete:()=>Promise<void>;rate:(rating:number,comment?:string)=>Promise<void>;
  applyStatus:(event:{tripId:string;status:api.TripStatus;driver?:Record<string,unknown>})=>void;setOffer:(offer:api.TripOffer|null)=>void;setDriverLocation:(location:api.DriverLocation)=>void;clear:()=>void;
}

const run=async<T>(set:(value:Partial<TripState>)=>void,work:()=>Promise<T>)=>{set({loading:true,error:null});try{return await work();}catch(error){const message=apiErrorMessage(error);set({error:message});throw new Error(message);}finally{set({loading:false});}};

export const useTripStore=create<TripState>((set,get)=>({trip:null,offer:null,driverLocation:null,loading:false,error:null,
  recover:()=>run(set,async()=>{const trip=await api.getActiveTrip();set({trip,driverLocation:trip?.latestDriverLocation??null});return trip;}),
  refreshCurrent:async()=>{const current=get().trip;if(!current)return null;const trip=await api.getTrip(current.id);if(get().trip?.id===trip.id)set({trip,driverLocation:trip.latestDriverLocation??get().driverLocation});return trip;},
  request:(input,key)=>run(set,async()=>{const{trip}=await api.requestTrip(input,key);set({trip,offer:null});return trip;}),
  cancel:(reason)=>run(set,async()=>{const trip=get().trip;if(!trip)return;await api.cancelTrip(trip.id,reason);set({trip:null,driverLocation:null,offer:null});}),
  acceptOffer:()=>run(set,async()=>{const offer=get().offer;if(!offer)return;const trip=await api.acceptTrip(offer.tripId);set({trip,offer:null});}),
  declineOffer:()=>run(set,async()=>{const offer=get().offer;if(!offer)return;await api.declineTrip(offer.tripId);set({offer:null});}),
  arrived:()=>run(set,async()=>{const trip=get().trip;if(trip)set({trip:await api.driverArrived(trip.id)});}),
  start:()=>run(set,async()=>{const trip=get().trip;if(trip)set({trip:await api.startTrip(trip.id)});}),
  complete:()=>run(set,async()=>{const trip=get().trip;if(trip)set({trip:await api.completeTrip(trip.id)});}),
  rate:(rating,comment)=>run(set,async()=>{const trip=get().trip;if(trip)await api.rateTrip(trip.id,rating,comment);}),
  applyStatus:(event)=>set((state)=>{if(state.trip?.id!==event.tripId)return{};const driver=event.driver;return{trip:{...state.trip,status:event.status,...(driver?{driver_name:String(driver.driver_name??driver.name??state.trip.driver_name??''),driver_avatar:String(driver.driver_avatar??driver.photo??state.trip.driver_avatar??''),driver_rating:String(driver.driver_rating??driver.rating??state.trip.driver_rating??''),plate_number:String(driver.plate_number??driver.plate??state.trip.plate_number??''),vehicle_model:String(driver.vehicle_model??driver.vehicle??state.trip.vehicle_model??'')}: {})}};}),
  setOffer:(offer)=>set({offer:offer?{...offer,receivedAt:Date.now()}:null}),setDriverLocation:(driverLocation)=>set({driverLocation}),clear:()=>set({trip:null,offer:null,driverLocation:null,error:null}),
}));

export type AppTripRole='rider'|'driver';
export function routeForTrip(trip:api.Trip,role:AppTripRole){
  if(trip.status==='completed')return'/trip-complete' as const;
  if(trip.status==='cancelled')return role==='driver'?'/driver-dashboard':'/home';
  if(trip.status==='no_drivers_found')return role==='driver'?'/driver-dashboard':'/ongoing-trip';
  return role==='driver'?'/driver-trip':'/ongoing-trip';
}
