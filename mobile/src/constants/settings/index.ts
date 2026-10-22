import { driverAlertPreferences, driverSettingsContent } from './driver';
import { riderAlertPreferences, riderSettingsContent } from './rider';
import type { SettingsRole } from './types';
export type { AlertPreferenceKey, SettingsContent, SettingsDestination, SettingsEntry, SettingsRole } from './types';
export const getSettingsContent = (role: SettingsRole) => role === 'driver' ? driverSettingsContent : riderSettingsContent;
export const getAlertPreferences = (role: SettingsRole) => role === 'driver' ? driverAlertPreferences : riderAlertPreferences;
