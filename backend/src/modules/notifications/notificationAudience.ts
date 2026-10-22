import { ApiError } from '../../shared/errors';

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

export function notificationRole(value: unknown): NotificationRole | undefined {
  if (value === undefined) return undefined; // Older clients retain their account-wide inbox.
  if (value !== 'rider' && value !== 'driver') throw new ApiError(400, 'invalid_notification_role');
  return value;
}

// Static SQL, never interpolated from request data. Keep in step with notificationAudience.
export const notificationAudienceSql = `CASE
  WHEN data->>'audience' IN ('rider','driver','shared') THEN data->>'audience'
  WHEN category='driver_offers' OR type LIKE 'driver\\_application\\_%' ESCAPE '\\' OR type LIKE 'withdrawal\\_%' ESCAPE '\\' THEN 'driver'
  WHEN type IN ('ride_payment_settled','refund_posted') THEN 'rider'
  WHEN type='topup_succeeded' THEN CASE WHEN data->>'target'='earnings' OR title='Earnings balance updated' THEN 'driver' ELSE 'rider' END
  WHEN right(event_key,7)=':driver' THEN 'driver'
  WHEN right(event_key,6)=':rider' THEN 'rider'
  WHEN split_part(deep_link,'?',1) IN ('/driver-trip','/driver-dashboard','/driver-status','/account/driver-wallet','/account/driver-trips') THEN 'driver'
  WHEN split_part(deep_link,'?',1) IN ('/ongoing-trip','/home','/schedule','/account/payment','/account/scheduled-rides') THEN 'rider'
  WHEN category IN ('trip_updates','scheduled_reminders') THEN 'rider'
  ELSE 'shared' END`;
