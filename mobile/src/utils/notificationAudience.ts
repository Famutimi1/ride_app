export type NotificationRole = 'rider' | 'driver';
export type NotificationAudience = NotificationRole | 'shared';

interface AudienceSource {
  type: string; category: string; data?: Record<string, unknown>;
  eventKey?: string; deepLink?: string | null; title?: string;
}

/** Explicit metadata wins. The remaining rules preserve notifications created before role separation. */
export function notificationAudience(item: AudienceSource): NotificationAudience {
  const audience = item.data?.audience;
  if (audience === 'rider' || audience === 'driver' || audience === 'shared') return audience;
  if (item.category === 'driver_offers' || item.type.startsWith('driver_application_') || item.type.startsWith('withdrawal_')) return 'driver';
  if (['ride_payment_settled', 'refund_posted'].includes(item.type)) return 'rider';
  // Historical top-ups shared a driver-wallet link. Their producer used these two exact titles.
  if (item.type === 'topup_succeeded') return item.data?.target === 'earnings' || item.title === 'Earnings balance updated' ? 'driver' : 'rider';
  if (item.eventKey?.endsWith(':driver')) return 'driver';
  if (item.eventKey?.endsWith(':rider')) return 'rider';
  const path = item.deepLink?.split('?')[0];
  if (['/driver-trip', '/driver-dashboard', '/driver-status', '/account/driver-wallet', '/account/driver-trips'].includes(path ?? '')) return 'driver';
  if (['/ongoing-trip', '/home', '/schedule', '/account/payment', '/account/scheduled-rides'].includes(path ?? '')) return 'rider';
  if (item.category === 'trip_updates' || item.category === 'scheduled_reminders') return 'rider';
  return 'shared';
}

export function notificationBelongsToRole(item: AudienceSource, role: NotificationRole): boolean {
  const audience = notificationAudience(item);
  return audience === 'shared' || audience === role;
}
