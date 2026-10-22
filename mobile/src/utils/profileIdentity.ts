import type { Trip } from '@/services/tripService';

/** Reviewed identity remains protected even when a driver switches to rider mode. */
export function profileIdentityNotice(reviewed: boolean, status?: Trip['status']): string | null {
  const active = status && ['driver_assigned', 'driver_arrived', 'in_progress', 'returning'].includes(status);
  if (active) return 'Name and phone changes are unavailable during an active trip.';
  if (reviewed) return 'Reviewed name and phone changes need staff review.';
  return null;
}
