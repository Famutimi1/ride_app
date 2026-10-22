import type { Href } from 'expo-router';
import type { UserRole } from '@/services/authService';

type Access = UserRole | 'shared' | 'application';

// Every signed-in route must declare its audience. Application pages are an
// intentional bridge: a rider must be able to apply before becoming a driver.
export const appRouteAccess = {
  home: 'rider', 'set-destination': 'rider', 'ride-selection': 'rider',
  'ride-details': 'rider', 'ongoing-trip': 'rider', schedule: 'rider',
  courier: 'rider', 'courier-review': 'rider',
  'driver-dashboard': 'driver', 'driver-trip': 'driver',
  'driver-onboarding': 'application', 'driver-status': 'application',
  menu: 'shared', 'notification-center': 'shared', 'trip-receipt': 'shared',
  'trip-complete': 'shared', 'trip-chat': 'shared', 'trip-call': 'shared',
  'account/[section]': 'shared',
} as const satisfies Record<string, Access>;

export const accountSectionAccess = {
  profile: 'shared', settings: 'shared', 'notification-settings': 'shared',
  'location-settings': 'shared', safety: 'shared', support: 'shared', 'top-up': 'shared',
  services: 'rider', payment: 'rider', trips: 'rider', 'saved-places': 'rider',
  'ride-plus': 'rider', promotions: 'rider', family: 'rider', work: 'rider', earn: 'application',
  'driver-services': 'driver', 'driver-wallet': 'driver', 'driver-earnings': 'driver',
  payouts: 'driver', 'driver-trips': 'driver', 'vehicle-documents': 'driver',
  'driver-rewards': 'driver', 'add-bank': 'driver', withdraw: 'driver',
} as const satisfies Record<string, Access>;

type DriverStatus = 'draft' | 'none' | 'pending' | 'approved' | 'rejected' | undefined;

export function roleHome(role: UserRole): '/driver-dashboard' | '/home' {
  return role === 'driver' ? '/driver-dashboard' : '/home';
}

function accessRedirect(access: Access | undefined, role: UserRole, status: DriverStatus): Href | null {
  if (access === 'driver' && role !== 'driver') return roleHome(role);
  if (access === 'driver' && status !== 'approved') {
    return status === 'pending' || status === 'rejected' ? '/driver-status' : '/driver-onboarding';
  }
  if (access === 'shared' || access === 'application' || access === role) return null;
  return roleHome(role);
}

export function accountSectionRedirect(section: string, role: UserRole, status: DriverStatus): Href | null {
  const access = Object.hasOwn(accountSectionAccess, section) ? accountSectionAccess[section as keyof typeof accountSectionAccess] : undefined;
  return accessRedirect(access, role, status);
}

/** Checked before mounting a screen, including direct links and browser history. */
export function appRouteRedirect(pathname: string, role: UserRole, status: DriverStatus, completingDriverTrip = false): Href | null {
  const path = pathname.replace(/^\/+|\/+$/g, '');
  if (path.startsWith('account/')) return accountSectionRedirect(path.slice('account/'.length), role, status);
  // A driver whose approval changes can still finish their assigned job.
  if (path === 'driver-trip' && role === 'driver' && completingDriverTrip) return null;
  const access = Object.hasOwn(appRouteAccess, path) ? appRouteAccess[path as keyof typeof appRouteAccess] : undefined;
  return accessRedirect(access, role, status);
}

export function tripBelongsToRole(trip: { rider_id: string; driver_id: string | null } | null, userId: string | undefined, role: UserRole): boolean {
  return Boolean(trip && userId && (role === 'driver' ? trip.driver_id === userId : trip.rider_id === userId));
}

export function canContactTrip(trip: { id: string; rider_id: string; driver_id: string | null; status: string } | null, userId: string | undefined, role: UserRole, requestedId?: string): boolean {
  return Boolean(trip && trip.driver_id && (!requestedId || requestedId === trip.id) &&
    ['driver_assigned', 'driver_arrived', 'in_progress', 'returning'].includes(trip.status) && tripBelongsToRole(trip, userId, role));
}
