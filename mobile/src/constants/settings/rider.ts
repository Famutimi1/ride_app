import type { AlertPreferenceEntry, SettingsContent } from './types';

export const riderSettingsContent: SettingsContent = {
  title: 'Rider settings', intro: 'Your rides, payments and app preferences.', section: 'Ride preferences',
  notificationTitle: 'Rider notifications', locationTitle: 'Pickup location access',
  entries: [
    { destination: 'payments', icon: 'card', label: 'Wallet & payment methods', detail: 'Manage how you pay for rides and deliveries' },
  ],
};
export const riderAlertPreferences: AlertPreferenceEntry[] = [
  { key: 'tripUpdatesEnabled', icon: 'vehicle', label: 'Trip updates', detail: 'Driver assignment, arrival, cancellations and receipts' },
  { key: 'scheduledRemindersEnabled', icon: 'calendar', label: 'Scheduled rides', detail: 'Reminders and important schedule changes' },
  { key: 'walletUpdatesEnabled', icon: 'card', label: 'Wallet & payments', detail: 'Ride payments, wallet top-ups and refunds' },
  { key: 'promotionsEnabled', icon: 'tag', label: 'Promotions & tips', detail: 'Optional offers and product tips' },
];
