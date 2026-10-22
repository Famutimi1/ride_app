import type { Href } from 'expo-router';
import type { SettingsDestination, SettingsRole } from '@/constants/settings';
import type { AppPermissionState } from '@/services/locationService';

/** Role-only entries cannot be opened from a stale callback after switching mode. */
export function settingsDestination(destination: SettingsDestination, role: SettingsRole): Href | null {
  const driverOnly = ['services', 'vehicle', 'payouts', 'application'];
  if (driverOnly.includes(destination) && role !== 'driver') return null;
  if (destination === 'payments' && role !== 'rider') return null;
  if (destination === 'application') return '/driver-status';
  if (destination === 'history') return '/notification-center';
  const sections = { services: 'driver-services', vehicle: 'vehicle-documents', payouts: 'payouts', payments: 'payment', profile: 'profile', notifications: 'notification-settings', location: 'location-settings', safety: 'safety', support: 'support' } as const;
  return { pathname: '/account/[section]', params: { section: sections[destination] } };
}

export const settingsLocationNotice = (role: SettingsRole) => `Open your browser’s site settings for Rakky Ride and choose Location. ${role === 'driver' ? 'Background driver location requires the installed mobile app.' : 'You can also enter your pickup address manually.'}`;
export function permissionLabel(value: AppPermissionState | null): string {
  if (value === null) return 'Not available';
  return { granted: 'Allowed', denied: 'Not allowed', blocked: 'Blocked in device settings', restricted: 'Not requested' }[value];
}
