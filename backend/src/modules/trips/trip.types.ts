export type TripStatus = 'scheduled' | 'searching' | 'driver_assigned' | 'driver_arrived' | 'in_progress' | 'returning' | 'returned' | 'completed' | 'cancelled' | 'no_drivers_found';
export type PaymentMethod = 'cash' | 'wallet' | 'card';
export type TripActor = 'rider' | 'driver' | 'system';
export interface CourierDetails {
  description: string;
  weightKg: number;
  recipientName: string;
  recipientPhone: string;
  pickupInstructions: string | null;
  dropoffInstructions: string | null;
}

export interface TripRow {
  id: string;
  rider_id: string;
  driver_id: string | null;
  status: TripStatus;
  service_type: 'ride' | 'courier';
  courier_details: CourierDetails | null;
  delivery_attempts: number;
  delivery_code_version: number;
  delivery_reset_count: number;
  delivery_verified_at: Date | null;
  delivery_issue_reason: string | null;
  returned_at: Date | null;
  vehicle_type: string;
  payment_method: PaymentMethod;
  payment_status: 'unpaid' | 'held' | 'settled' | 'released';
  hold_tx_id: string | null;
  settle_tx_id: string | null;
  pickup_lat: number;
  pickup_lng: number;
  pickup_address: string;
  pickup_place_id: string | null;
  dropoff_lat: number;
  dropoff_lng: number;
  dropoff_address: string;
  dropoff_place_id: string | null;
  estimated_distance_m: number;
  estimated_duration_s: number;
  route_polyline: string | null;
  fare_kobo: string;
  commission_bps_snapshot?: number | null;
  commission_kobo: string | null;
  driver_earning_kobo: string | null;
  idempotency_key: string;
  cancelled_by: TripActor | null;
  cancel_reason: string | null;
  requested_at: Date;
  scheduled_at: Date | null;
  accepted_at: Date | null;
  arrived_at: Date | null;
  started_at: Date | null;
  completed_at: Date | null;
  cancelled_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface TripPoint {
  latitude: number;
  longitude: number;
  address: string;
  placeId?: string;
}

export interface TripEstimate {
  vehicleType: string;
  distanceM: number;
  durationS: number;
  encodedPolyline: string;
  fareKobo: number;
  distanceKm: number;
  durationMin: number;
  estimatedFare: number;
  currency: 'NGN';
}

export interface TripQuote extends TripEstimate {
  quoteId: string;
  quoteExpiresAt: string;
}

export interface FareConfigRow {
  vehicle_type: string;
  base_fare_kobo: string;
  per_km_kobo: string;
  per_min_kobo: string;
  min_fare_kobo: string;
  commission_bps: number;
}
