import type { Href } from 'expo-router';
import type { Trip } from '@/services/tripService';
import { useCourierDraftStore } from '@/store/courierDraftStore';
import { useMapStore } from '@/store/mapStore';
import { anchorPolyline, decodePolyline } from '@/utils/polyline';

/** Restore booking inputs from the terminal request before clearing it. */
export function prepareTripRetry(trip: Trip, changePickup = false): Href {
  if (trip.status !== 'no_drivers_found') throw new Error('Only an unsuccessful driver search can be retried.');

  const pickup = { latitude: trip.pickup_lat, longitude: trip.pickup_lng, address: trip.pickup_address, placeId: trip.pickup_place_id ?? undefined };
  const dropoff = { latitude: trip.dropoff_lat, longitude: trip.dropoff_lng, address: trip.dropoff_address, placeId: trip.dropoff_place_id ?? undefined };
  const map = useMapStore.getState();
  map.setPickupLocation(pickup);
  map.setDropoffLocation(dropoff);
  if (trip.route_polyline) {
    try { map.setRouteForEndpoints(pickup, dropoff, anchorPolyline(decodePolyline(trip.route_polyline), pickup, dropoff)); }
    catch { /* Invalid cached geometry must not prevent reviewing the saved addresses. */ }
  }

  if (trip.service_type !== 'courier') return changePickup ? '/set-destination' : '/ride-selection';

  const details = trip.courier_details;
  if (!details) {
    // Never silently substitute a car ride or an unrelated parcel draft.
    useCourierDraftStore.getState().clearDraft();
    return { pathname: '/courier', params: { retry: '1' } };
  }
  useCourierDraftStore.getState().setDraft({
    description: details.description,
    weightKg: details.weightKg,
    recipientName: details.recipientName,
    recipientPhone: details.recipientPhone,
    pickupInstructions: details.pickupInstructions,
    dropoffInstructions: details.dropoffInstructions,
    // These details come from a request whose restrictions were already accepted.
    acceptedRestrictions: true,
  });
  return changePickup ? { pathname: '/set-destination', params: { service: 'courier' } } : '/courier-review';
}
