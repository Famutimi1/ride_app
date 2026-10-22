import type { ComponentProps } from 'react';
import type { RideIcon } from '@/components/common/RideIcon';
import type { NotificationPreferences } from '@/services/notificationService';

export type SettingsRole = 'rider' | 'driver';
export type SettingsIcon = ComponentProps<typeof RideIcon>['name'];
export type SettingsDestination = 'services' | 'vehicle' | 'payouts' | 'application' | 'payments' | 'profile' | 'notifications' | 'location' | 'history' | 'safety' | 'support';
export interface SettingsEntry { destination: SettingsDestination; icon: SettingsIcon; label: string; detail: string }
export interface SettingsContent { title: string; intro: string; section: string; entries: SettingsEntry[]; notificationTitle: string; locationTitle: string }
export type AlertPreferenceKey = 'tripUpdatesEnabled' | 'driverOffersEnabled' | 'scheduledRemindersEnabled' | 'walletUpdatesEnabled' | 'promotionsEnabled';
export interface AlertPreferenceEntry { key: AlertPreferenceKey & keyof NotificationPreferences; icon: SettingsIcon; label: string; detail: string }
