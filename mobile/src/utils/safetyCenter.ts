import type { Trip } from '@/services/tripService';

export function hasShareableTrip(trip: Trip | null): trip is Trip {
  return Boolean(trip && ['searching', 'driver_assigned', 'driver_arrived', 'in_progress', 'returning'].includes(trip.status));
}

/** Only the trip summary is shared. Never include handoff codes or recipient contacts. */
export function safetyTripShareMessage(trip: Trip | null, role: 'rider' | 'driver' = 'rider'): string | null {
  if (!hasShareableTrip(trip)) return null;
  // Driver sharing identifies their work without disclosing a passenger's route or identity.
  const details = role === 'driver'
    ? ['Rakky Ride driver trip', `Trip reference: ${trip.id}`, `Service: ${trip.service_type === 'courier' ? 'Courier' : 'Passenger'}`]
    : [`Rakky Ride ${trip.service_type === 'courier' ? 'delivery' : 'trip'}`, `Pickup: ${trip.pickup_address}`, `Destination: ${trip.dropoff_address}`];
  if (trip.driver_id) {
    if (role === 'rider' && trip.driver_name?.trim()) details.push(`Driver: ${trip.driver_name.trim()}`);
    const vehicle = [trip.vehicle_color, trip.vehicle_make, trip.vehicle_model].filter(value => value?.trim()).join(' ');
    if (vehicle) details.push(`Vehicle: ${vehicle}`);
    if (trip.plate_number?.trim()) details.push(`Plate: ${trip.plate_number.trim()}`);
  }
  return details.join('\n');
}
