import type { Href } from 'expo-router';
import type { CareContext, CareDestination, CareRole } from '@/constants/care';
import type { DriverServiceSettings } from '@/services/driverService';
import type { Trip } from '@/services/tripService';
import { hasShareableTrip } from './safetyCenter';

/** Stale trips from another account or mode must never enable sharing or trip actions. */
export function careTripForRole(trip: Trip | null, userId: string | undefined, role: CareRole): Trip | null {
  if (!userId || !hasShareableTrip(trip)) return null;
  return (role === 'driver' ? trip.driver_id === userId : trip.rider_id === userId) ? trip : null;
}

export function careServiceContext(settings: DriverServiceSettings | null, trip: Trip | null): CareContext {
  return {
    passenger: Boolean(trip?.service_type === 'ride' || settings?.services.ride.status === 'approved'),
    courier: Boolean(trip?.service_type === 'courier' || settings?.services.courier.status === 'approved'),
  };
}

export function careDestination(destination: CareDestination, role: CareRole, trip: Trip | null): Href {
  if (destination === 'trip' && trip) return role === 'driver' ? '/driver-trip' : '/ongoing-trip';
  if (destination === 'application') return '/driver-status';
  const section = destination === 'trip' || destination === 'history' ? role === 'driver' ? 'driver-trips' : 'trips'
    : destination === 'wallet' ? role === 'driver' ? 'driver-wallet' : 'payment'
      : destination === 'account' ? 'profile' : destination;
  return { pathname: '/account/[section]', params: { section } };
}

/** Contact action opens a composer, never sends a message or adds private trip details. */
export function supportContactUrl(action: 'phone' | 'email', value: string, role: CareRole, safety: boolean): string {
  if (action === 'phone') return `tel:${value.trim()}`;
  const subject = `Rakky Ride ${role} ${safety ? 'safety concern' : 'support'}`;
  return `mailto:${encodeURIComponent(value.trim()).replace(/%40/g, '@')}?subject=${encodeURIComponent(subject)}`;
}
