import { apiClient } from '@/lib/apiClient';
import type { MapLocation } from '@/store/mapStore';

export type TripStatus='searching'|'driver_assigned'|'driver_arrived'|'in_progress'|'completed'|'cancelled'|'no_drivers_found';
export type TripPaymentMethod='cash'|'wallet'|'card';
export interface Trip {
  id:string;rider_id:string;driver_id:string|null;status:TripStatus;vehicle_type:string;payment_method:TripPaymentMethod;
  pickup_lat:number;pickup_lng:number;pickup_address:string;pickup_place_id?:string|null;
  dropoff_lat:number;dropoff_lng:number;dropoff_address:string;dropoff_place_id?:string|null;
  estimated_distance_m:number;estimated_duration_s:number;route_polyline?:string|null;fare_kobo:number;
  commission_kobo?:number|null;driver_earning_kobo?:number|null;requested_at:string;accepted_at?:string|null;
  driver_name?:string|null;driver_avatar?:string|null;driver_rating?:string|null;vehicle_make?:string|null;
  vehicle_model?:string|null;vehicle_color?:string|null;plate_number?:string|null;rider_name?:string|null;
  completed_at?:string|null;
  latestDriverLocation?:DriverLocation|null;
}
export interface DriverLocation{driverId:string;latitude:number;longitude:number;heading?:number;timestamp:number;tripId?:string}
export interface TripOffer{tripId:string;pickup:{latitude:number;longitude:number;address:string};dropoff:{latitude:number;longitude:number;address:string};fareKobo:number;distanceToPickupM:number;expiresAt:string;serverNow?:string;receivedAt?:number}
export interface TripEstimate{vehicleType:string;distanceM:number;durationS:number;encodedPolyline:string;fareKobo:number;distanceKm:number;durationMin:number;estimatedFare:number;currency:'NGN'}

export const estimateTrip=(pickup:MapLocation,dropoff:MapLocation)=>apiClient.post<TripEstimate>('/trips/estimate',{pickup,dropoff,vehicleType:'economy'}).then(r=>r.data);
export const requestTrip=(input:{pickup:MapLocation;dropoff:MapLocation;paymentMethod:TripPaymentMethod},idempotencyKey:string)=>apiClient.post<{trip:Trip;created:boolean}>('/trips',input,{headers:{'Idempotency-Key':idempotencyKey}}).then(r=>r.data);
export const getActiveTrip=()=>apiClient.get<Trip|null>('/trips/active').then(r=>r.data);
export const getTrip=(id:string)=>apiClient.get<Trip>(`/trips/${id}`).then(r=>r.data);
export const cancelTrip=(id:string,reason:string)=>apiClient.post<Trip>(`/trips/${id}/cancel`,{reason}).then(r=>r.data);
export const acceptTrip=(id:string)=>apiClient.post<Trip>(`/trips/${id}/accept`).then(r=>r.data);
export const declineTrip=(id:string)=>apiClient.post(`/trips/${id}/decline`).then(r=>r.data);
export const driverArrived=(id:string)=>apiClient.post<Trip>(`/trips/${id}/arrived`).then(r=>r.data);
export const startTrip=(id:string)=>apiClient.post<Trip>(`/trips/${id}/start`).then(r=>r.data);
export const completeTrip=(id:string)=>apiClient.post<Trip>(`/trips/${id}/complete`).then(r=>r.data);
export const rateTrip=(id:string,rating:number,comment?:string)=>apiClient.post(`/trips/${id}/rating`,{rating,comment}).then(r=>r.data);
export const getTripHistory=(cursor?:string)=>apiClient.get<{trips:Trip[];nextCursor:string|null}>('/trips/history',{params:{cursor}}).then(r=>r.data);
