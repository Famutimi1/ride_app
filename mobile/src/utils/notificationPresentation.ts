import type { AppColors } from '@/constants/colors';
import type { AppNotification } from '@/services/notificationService';

export type NotificationFilter = 'all' | 'unread';

function localDay(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

export function groupNotifications(items: AppNotification[], filter: NotificationFilter, now = new Date()): { title: string; data: AppNotification[] }[] {
  const today = localDay(now);
  const yesterday = localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const groups = new Map<string, { title: string; data: AppNotification[] }>();
  const sorted = items.filter(item => filter === 'all' || !item.readAt).sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));
  for (const item of sorted) {
    const date = new Date(item.createdAt);
    const valid = !Number.isNaN(date.getTime());
    const key = valid ? localDay(date) : 'unknown';
    const title = !valid ? 'Date unavailable' : key === today ? 'Today' : key === yesterday ? 'Yesterday' : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
    const group = groups.get(key);
    if (group) group.data.push(item);
    else groups.set(key, { title, data: [item] });
  }
  return [...groups.values()];
}

export function notificationTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Time unavailable' : date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

type NotificationSymbol = 'vehicle' | 'receipt' | 'package' | 'wallet' | 'clock' | 'safety' | 'support' | 'tag' | 'bell';
export function notificationAppearance(item: AppNotification): { icon: NotificationSymbol; color: keyof AppColors; background: keyof AppColors } {
  const icon: NotificationSymbol = item.category === 'wallet_updates' ? 'wallet'
    : item.category === 'scheduled_reminders' ? 'clock'
      : item.category === 'safety_security' ? 'safety'
        : item.category === 'support' ? 'support'
          : item.category === 'promotions' ? 'tag'
            : item.type.startsWith('courier_') || item.title === 'Package delivered' ? 'package'
              : item.type === 'trip_completed' ? 'receipt'
                : item.category === 'trip_updates' || item.category === 'driver_offers' ? 'vehicle' : 'bell';
  if (/cancelled|failed|rejected|mismatch/.test(item.type) || item.type === 'ride_payment_settled') return { icon, color: 'danger', background: 'dangerSoft' };
  if (item.type === 'no_drivers_found' || item.type === 'courier_returning' || item.type === 'courier_returned' || item.type === 'withdrawal_requested' || item.category === 'safety_security') return { icon, color: 'warning', background: 'warningSoft' };
  if (['trip_completed', 'topup_succeeded', 'withdrawal_succeeded', 'refund_posted'].includes(item.type)) return { icon, color: 'success', background: 'successSoft' };
  return { icon, color: 'icon', background: 'surfaceMuted' };
}
