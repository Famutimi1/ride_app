import type { Trip } from '@/services/tripService';

/** A missing historical financial value must never be replaced with a quote. */
export function tripMoney(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function isDriverTrip(trip: Trip, userId: string | undefined): boolean {
  return Boolean(userId && trip.driver_id === userId && trip.rider_id !== userId);
}

export function driverTripPresentation(trip: Trip) {
  const fulfilled = trip.status === 'completed' || trip.status === 'returned';
  const earnings = fulfilled ? tripMoney(trip.driver_earning_kobo) : null;
  const commission = fulfilled ? tripMoney(trip.commission_kobo) : null;
  const settled = fulfilled && trip.payment_status === 'settled';
  const cancelled = trip.status === 'cancelled' || trip.status === 'no_drivers_found';
  const heading = fulfilled ? 'Your earnings' : cancelled ? 'Trip cancelled' : 'Earnings pending';
  const payment = trip.payment_method === 'cash' ? 'Cash' : trip.payment_method === 'wallet' ? 'Wallet' : 'Card';
  const note = fulfilled
    ? earnings === null ? 'Earnings unavailable for this trip.' : settled ? `${payment} trip` : 'Settlement not confirmed.'
    : trip.payment_status === 'settled' ? 'A payment is recorded. Review its details with support.'
      : trip.payment_status === 'held' ? 'Rider funds are reserved. Driver earnings are not confirmed.'
        : cancelled ? 'This trip was not completed.' : 'Earnings are confirmed after the trip finishes.';
  return { fulfilled, earnings, commission, settled, cancelled, heading, payment, note };
}
