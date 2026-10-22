import type { AlertPreferenceEntry, SettingsContent } from './types';

export const driverSettingsContent: SettingsContent = {
  title: 'Driver settings', intro: '', section: 'Preferences',
  notificationTitle: 'Notification settings', locationTitle: 'Location settings',
  entries: [
    { destination: 'services', icon: 'swap', label: 'Service settings', detail: 'Requests and service consent' },
  ],
};
export const driverAlertPreferences: AlertPreferenceEntry[] = [
  { key: 'driverOffersEnabled', icon: 'passenger', label: 'Ride & courier offers', detail: 'New requests while online for your approved services' },
  { key: 'tripUpdatesEnabled', icon: 'vehicle', label: 'Driver trip updates', detail: 'Trip changes, cancellations and completion updates' },
  { key: 'walletUpdatesEnabled', icon: 'wallet', label: 'Earnings & payout alerts', detail: 'Earnings credits, withdrawals and payout status' },
  { key: 'promotionsEnabled', icon: 'tag', label: 'Promotions & tips', detail: 'Optional offers and product tips' },
];
