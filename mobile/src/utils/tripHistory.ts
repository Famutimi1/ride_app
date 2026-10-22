import type { Trip } from '@/services/tripService';

export type HistoryFilter = 'all' | 'completed' | 'not-completed';

export function matchesHistoryFilter(trip: Trip, filter: HistoryFilter): boolean {
  if (filter === 'completed') return trip.status === 'completed';
  if (filter === 'not-completed') return ['cancelled', 'no_drivers_found', 'returned'].includes(trip.status);
  return true;
}

export function historyDate(trip: Trip): Date {
  const value = trip.status === 'completed' ? trip.completed_at : trip.status === 'returned' ? trip.returned_at : trip.status === 'cancelled' ? trip.cancelled_at : null;
  const date = new Date(value ?? trip.requested_at);
  return Number.isNaN(date.getTime()) ? new Date(trip.requested_at) : date;
}

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

export function groupHistoryTrips(trips: Trip[], filter: HistoryFilter, now = new Date()): { title: string; data: Trip[] }[] {
  const today = localDateKey(now);
  const yesterday = localDateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const groups = new Map<string, { title: string; data: Trip[] }>();
  const sorted = trips.filter(trip => matchesHistoryFilter(trip, filter)).sort((a, b) => (historyDate(b).getTime() || 0) - (historyDate(a).getTime() || 0));
  for (const trip of sorted) {
    const date = historyDate(trip);
    const valid = !Number.isNaN(date.getTime());
    const key = valid ? localDateKey(date) : 'unknown';
    const formatted = valid ? date.toLocaleDateString('en-NG', { day: 'numeric', month: 'short', ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) }) : 'Date unavailable';
    const title = key === today ? `Today · ${formatted}` : key === yesterday ? `Yesterday · ${formatted}` : formatted;
    const group = groups.get(key);
    if (group) group.data.push(trip);
    else groups.set(key, { title, data: [trip] });
  }
  return [...groups.values()];
}

/** A quoted fare on an unsuccessful request is not proof of a charge. */
export function historyChargeState(trip: Trip): 'fare' | 'not-charged' | 'held' | 'unknown' {
  if (trip.status === 'completed' || trip.status === 'returned' || trip.payment_status === 'settled') return 'fare';
  if (trip.payment_status === 'held') return 'held';
  if (trip.status === 'cancelled' || trip.status === 'no_drivers_found') {
    if (trip.payment_status === 'released' || trip.payment_status === 'unpaid' || trip.payment_method === 'cash') return 'not-charged';
  }
  return 'unknown';
}
