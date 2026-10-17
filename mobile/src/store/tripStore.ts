import { create } from 'zustand';
import { apiErrorMessage } from '@/lib/apiClient';
import * as api from '@/services/tripService';

interface TripState{
  trip:api.Trip|null;offer:api.TripOffer|null;driverLocation:api.DriverLocation|null;loading:boolean;error:string|null;
  recover:()=>Promise<api.Trip|null>;refreshCurrent:()=>Promise<api.Trip|null>;request:(input:api.TripRequest,key:string)=>Promise<api.Trip>;
  cancel:(reason:string)=>Promise<void>;acceptOffer:()=>Promise<void>;declineOffer:()=>Promise<void>;arrived:()=>Promise<void>;start:()=>Promise<void>;returnDelivery:(reason:string)=>Promise<void>;complete:(deliveryCode?:string)=>Promise<void>;rate:(rating:number,comment?:string)=>Promise<void>;
  applyStatus:(event:{tripId:string;status:api.TripStatus;driverId?:string|null;driver?:Record<string,unknown>})=>void;setOffer:(offer:api.TripOffer|null)=>void;setDriverLocation:(location:api.DriverLocation)=>void;clear:()=>void;
}

let tripGeneration = 0;
const run = async <T>(set: (value: Partial<TripState>) => void, work: (update: (value: Partial<TripState>) => void) => Promise<T>) => {
  const generation = tripGeneration;
  const update: typeof set = (value) => { if (generation === tripGeneration) set(value); };
  update({ loading: true, error: null });
  try { return await work(update); }
  catch (error) {
    const message = apiErrorMessage(error);
    update({ error: message });
    if (error instanceof api.TripQuoteError) throw error;
    throw new Error(message);
  } finally { update({ loading: false }); }
};

export const useTripStore=create<TripState>((set,get)=>({trip:null,offer:null,driverLocation:null,loading:false,error:null,
  recover:()=>run(set,async(set)=>{const [trip,offer]=await Promise.all([api.getActiveTrip(),api.getCurrentOffer()]);set({trip,offer:trip?null:offer?{...offer,receivedAt:Date.now()}:null,driverLocation:trip?.latestDriverLocation??null});return trip;}),
  refreshCurrent:async()=>{const generation=tripGeneration;const current=get().trip;if(!current)return null;const trip=await api.getTrip(current.id);if(generation===tripGeneration&&get().trip?.id===trip.id)set({trip,driverLocation:trip.latestDriverLocation??get().driverLocation});return trip;},
  request:(input,key)=>run(set,async(set)=>{const{trip}=await api.requestTrip(input,key);set({trip:trip.status==='scheduled'?null:trip,offer:null,driverLocation:null});return trip;}),
  cancel:(reason)=>run(set,async(set)=>{const trip=get().trip;if(!trip)return;await api.cancelTrip(trip.id,reason);set({trip:null,driverLocation:null,offer:null});}),
  acceptOffer:()=>run(set,async(set)=>{const offer=get().offer;if(!offer)return;const trip=await api.acceptTrip(offer.tripId);set({trip,offer:null});}),
  declineOffer:()=>run(set,async(set)=>{const offer=get().offer;if(!offer)return;await api.declineTrip(offer.tripId);set({offer:null});}),
  arrived:()=>run(set,async(set)=>{const trip=get().trip;if(trip)set({trip:await api.driverArrived(trip.id)});}),
  start:()=>run(set,async(set)=>{const trip=get().trip;if(trip)set({trip:await api.startTrip(trip.id)});}),
  returnDelivery:(reason)=>run(set,async(set)=>{const trip=get().trip;if(trip)set({trip:await api.returnCourierDelivery(trip.id,reason)});}),
  complete:(deliveryCode)=>run(set,async(set)=>{const trip=get().trip;if(trip)set({trip:await api.completeTrip(trip.id,deliveryCode)});}),
  rate:(rating,comment)=>run(set,async(set)=>{const trip=get().trip;if(trip)await api.rateTrip(trip.id,rating,comment);}),
  applyStatus:(event)=>set((state)=>{if(state.trip?.id!==event.tripId)return{};const driver=event.driver;return{trip:{...state.trip,status:event.status,driver_id:event.driverId??state.trip.driver_id,...(driver?{driver_name:String(driver.driver_name??driver.name??state.trip.driver_name??''),driver_avatar:String(driver.driver_avatar??driver.photo??state.trip.driver_avatar??''),driver_rating:String(driver.driver_rating??driver.rating??state.trip.driver_rating??''),plate_number:String(driver.plate_number??driver.plate??state.trip.plate_number??''),vehicle_model:String(driver.vehicle_model??driver.vehicle??state.trip.vehicle_model??'')}: {})}};}),
  setOffer:(offer)=>set({offer:offer?{...offer,receivedAt:Date.now()}:null}),setDriverLocation:(driverLocation)=>set({driverLocation}),clear:()=>{tripGeneration+=1;set({trip:null,offer:null,driverLocation:null,error:null,loading:false});},
}));

export type AppTripRole='rider'|'driver';
export function routeForTrip(trip:api.Trip,role:AppTripRole){
  if(trip.status==='scheduled')return'/schedule' as const;
  if(trip.status==='completed'||trip.status==='returned')return'/trip-complete' as const;
  if(trip.status==='cancelled')return role==='driver'?'/driver-dashboard':'/home';
  if(trip.status==='no_drivers_found')return role==='driver'?'/driver-dashboard':'/ongoing-trip';
  return role==='driver'?'/driver-trip':'/ongoing-trip';
}
