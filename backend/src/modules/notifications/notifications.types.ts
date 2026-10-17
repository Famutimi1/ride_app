import type { PoolClient } from 'pg';

export type NotificationCategory =
  | 'trip_updates'
  | 'driver_offers'
  | 'scheduled_reminders'
  | 'wallet_updates'
  | 'safety_security'
  | 'support'
  | 'promotions';

export type NotificationPriority = 'low' | 'normal' | 'high';
export type NotificationDeliveryStatus = 'queued' | 'sending' | 'sent' | 'delivered' | 'skipped' | 'failed';

export interface NotificationPreferences {
  pushEnabled: boolean;
  tripUpdatesEnabled: boolean;
  driverOffersEnabled: boolean;
  scheduledRemindersEnabled: boolean;
  walletUpdatesEnabled: boolean;
  promotionsEnabled: boolean;
  soundEnabled: boolean;
  vibrationEnabled: boolean;
}

export interface NotificationRecord {
  id: string;
  userId: string;
  type: string;
  category: NotificationCategory;
  priority: NotificationPriority;
  eventKey: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  deepLink: string | null;
  expiresAt: string | null;
  readAt: string | null;
  openedAt: string | null;
  deliveredAt: string | null;
  deliveryStatus: NotificationDeliveryStatus;
  createdAt: string;
}

export interface CreateNotificationInput {
  userId: string;
  type: string;
  category: NotificationCategory;
  priority?: NotificationPriority;
  eventKey: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  deepLink?: string | null;
  expiresAt?: Date | null;
  sendPush?: boolean;
}

export interface CreatedNotification {
  record: NotificationRecord;
  sendPush: boolean;
  isNew: boolean;
}

export type NotificationDbClient = Pick<PoolClient, 'query'>;
