import { apiClient } from '@/lib/apiClient';
import { isAxiosError } from 'axios';
import type { MapLocation } from '@/store/mapStore';
import type { CourierDraft } from '@/store/courierDraftStore';

export type TripStatus='scheduled'|'searching'|'driver_assigned'|'driver_arrived'|'in_progress'|'returning'|'returned'|'completed'|'cancelled'|'no_drivers_found';
export type TripPaymentMethod='cash'|'wallet'|'card';
export interface Trip {
  id:string;rider_id:string;driver_id:string|null;status:TripStatus;vehicle_type:string;payment_method:TripPaymentMethod;
  service_type:'ride'|'courier';courier_details?:Omit<CourierDraft,'acceptedRestrictions'>|null;delivery_verified_at?:string|null;
  pickup_lat:number;pickup_lng:number;pickup_address:string;pickup_place_id?:string|null;
  dropoff_lat:number;dropoff_lng:number;dropoff_address:string;dropoff_place_id?:string|null;
  estimated_distance_m:number;estimated_duration_s:number;route_polyline?:string|null;fare_kobo:number;
  commission_kobo?:number|null;driver_earning_kobo?:number|null;requested_at:string;accepted_at?:string|null;
  scheduled_at?:string|null;
  cancelled_at?:string|null;payment_status?:'unpaid'|'held'|'settled'|'released';
  delivery_issue_reason?:string|null;returned_at?:string|null;
  cancel_reason?:string|null;
  driver_name?:string|null;driver_avatar?:string|null;driver_rating?:string|null;vehicle_make?:string|null;
  vehicle_model?:string|null;vehicle_color?:string|null;plate_number?:string|null;rider_name?:string|null;
  completed_at?:string|null;
  latestDriverLocation?:DriverLocation|null;
}
export interface DriverLocation{driverId:string;latitude:number;longitude:number;heading?:number;timestamp:number;tripId?:string}
export interface TripOffer{tripId:string;serviceType?:'ride'|'courier';packageDescription?:string;pickup:{latitude:number;longitude:number;address:string};dropoff:{latitude:number;longitude:number;address:string};fareKobo:number;distanceToPickupM:number;expiresAt:string;serverNow?:string;receivedAt?:number}
export interface TripEstimate{vehicleType:string;distanceM:number;durationS:number;encodedPolyline:string;fareKobo:number;distanceKm:number;durationMin:number;estimatedFare:number;currency:'NGN';quoteId:string;quoteExpiresAt:string}

export class TripQuoteError extends Error {
  constructor() { super('Your fare quote is no longer valid. Review the refreshed price and confirm again.'); this.name = 'TripQuoteError'; }
}

export interface TripRequest {
  pickup: MapLocation;
  dropoff: MapLocation;
  quoteId: string;
  paymentMethod: TripPaymentMethod;
  scheduledAt?: string;
  serviceType?: 'ride' | 'courier';
  courierDetails?: CourierDraft;
}

export const estimateTrip=(pickup:MapLocation,dropoff:MapLocation,vehicleType:'economy'|'courier'='economy')=>apiClient.post<TripEstimate>('/trips/estimate',{pickup,dropoff,vehicleType}).then(r=>r.data);
export async function requestTrip(input: TripRequest, idempotencyKey: string) {
  try {
    const { data } = await apiClient.post<{ trip: Trip; created: boolean }>('/trips', input, { headers: { 'Idempotency-Key': idempotencyKey } });
    return data;
  } catch (error) {
    const code: unknown = isAxiosError(error) ? error.response?.data?.error : null;
    if (code === 'trip_quote_expired' || code === 'trip_quote_required' || code === 'trip_quote_mismatch') throw new TripQuoteError();
    throw error;
  }
}
export const getActiveTrip=()=>apiClient.get<Trip|null>('/trips/active').then(r=>r.data);
export const getCurrentOffer=()=>apiClient.get<TripOffer|null>('/trips/offers/current').then(r=>r.data);
export const getScheduledTrips=()=>apiClient.get<Trip[]>('/trips/scheduled').then(r=>r.data);
export const getTrip=(id:string)=>apiClient.get<Trip>(`/trips/${id}`).then(r=>r.data);
export const getCourierDeliveryCode=(id:string)=>apiClient.get<{code:string}>(`/trips/${id}/delivery-code`).then(r=>r.data.code);
export const rotateCourierDeliveryCode=(id:string)=>apiClient.post<{code:string}>(`/trips/${id}/delivery-code/rotate`).then(r=>r.data.code);
export const cancelTrip=(id:string,reason:string)=>apiClient.post<Trip>(`/trips/${id}/cancel`,{reason}).then(r=>r.data);
export const acceptTrip=(id:string)=>apiClient.post<Trip>(`/trips/${id}/accept`).then(r=>r.data);
export const declineTrip=(id:string)=>apiClient.post(`/trips/${id}/decline`).then(r=>r.data);
export const driverArrived=(id:string)=>apiClient.post<Trip>(`/trips/${id}/arrived`).then(r=>r.data);
export const startTrip=(id:string)=>apiClient.post<Trip>(`/trips/${id}/start`).then(r=>r.data);
export const returnCourierDelivery=(id:string,reason:string)=>apiClient.post<Trip>(`/trips/${id}/return`,{reason}).then(r=>r.data);
export const completeTrip=(id:string,deliveryCode?:string)=>apiClient.post<Trip>(`/trips/${id}/complete`,{deliveryCode}).then(r=>r.data);
export const rateTrip=(id:string,rating:number,comment?:string)=>apiClient.post(`/trips/${id}/rating`,{rating,comment}).then(r=>r.data);
export const getTripHistory=(cursor?:string,filters?:{status?:'completed';serviceType?:'ride'|'courier';limit?:number})=>apiClient.get<{trips:Trip[];nextCursor:string|null}>('/trips/history',{params:{cursor,...filters}}).then(r=>r.data);
