import type { Trip, TripStatus } from '@/services/tripService';
import { historyChargeState } from './tripHistory';

export type ReceiptTone = 'success' | 'warning' | 'danger' | 'primary' | 'textMuted';
export type ReceiptAmountKind = 'fare' | 'estimate' | 'recorded' | 'not-charged' | 'held' | 'unknown';

const STATUS: Record<TripStatus, { label: string; tone: ReceiptTone }> = {
  completed: { label: 'Completed', tone: 'success' }, returned: { label: 'Returned', tone: 'warning' },
  cancelled: { label: 'Cancelled', tone: 'danger' }, no_drivers_found: { label: 'No drivers found', tone: 'warning' },
  scheduled: { label: 'Scheduled', tone: 'primary' }, searching: { label: 'Finding a driver', tone: 'primary' },
  driver_assigned: { label: 'Driver assigned', tone: 'primary' }, driver_arrived: { label: 'Driver arrived', tone: 'primary' },
  in_progress: { label: 'In progress', tone: 'primary' }, returning: { label: 'Returning', tone: 'warning' },
};

export function receiptSummary(trip: Trip) {
  const courier = trip.service_type === 'courier';
  const fulfilled = trip.status === 'completed' || trip.status === 'returned';
  const unsuccessful = trip.status === 'cancelled' || trip.status === 'no_drivers_found';
  const title = courier ? fulfilled ? 'Delivery receipt' : 'Delivery details' : fulfilled ? 'Trip receipt' : 'Trip details';
  const status = STATUS[trip.status];
  const statusLabel = courier && trip.status === 'completed' ? 'Delivered' : status.label;
  const paymentLabel = trip.payment_method === 'cash' ? 'Cash payment' : trip.payment_method === 'wallet' ? 'Rakky Ride wallet' : 'Card payment';
  const charge = historyChargeState(trip);
  let kind: ReceiptAmountKind;
  let heading: string;
  let note: string;

  if (trip.payment_status === 'held') {
    kind = 'held'; heading = 'Funds held'; note = 'This amount is still reserved in your wallet.';
  } else if (fulfilled) {
    kind = 'fare'; heading = courier ? 'Delivery fare' : 'Trip fare'; note = paymentLabel;
  } else if (unsuccessful && charge === 'not-charged') {
    kind = 'not-charged'; heading = 'Not charged';
    note = trip.payment_status === 'released' ? 'Your wallet hold was released.' : trip.status === 'no_drivers_found' ? 'This request did not become a trip.' : courier ? 'This delivery request was cancelled.' : 'This ride was cancelled.';
  } else if (unsuccessful && charge === 'fare') {
    kind = 'recorded'; heading = 'Recorded fare'; note = 'A payment is recorded for this request.';
  } else if (unsuccessful) {
    kind = 'unknown'; heading = 'Payment status unavailable'; note = 'We could not confirm its payment status.';
  } else {
    kind = 'estimate'; heading = 'Fare estimate'; note = paymentLabel;
  }
  return { title, fulfilled, statusLabel, tone: status.tone, paymentLabel, kind, heading, note };
}
