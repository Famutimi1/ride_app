import type { DriverService, DriverServiceSettings } from '@/services/driverService';

/** Unknown vehicles can request classification, but cannot receive work yet. */
export function driverVehicleServices(category: DriverServiceSettings['vehicleCategory']): DriverService[] {
  return category === 'motorcycle' ? ['courier'] : ['ride', 'courier'];
}

export function driverServiceAvailable(settings: DriverServiceSettings, service: DriverService): boolean {
  const state = settings.services[service];
  return (service === 'ride' ? settings.vehicleCategory === 'car' : settings.vehicleCategory !== null)
    && state.status === 'approved' && state.consentAccepted;
}

export function driverServiceEnabled(settings: DriverServiceSettings, service: DriverService): boolean {
  return driverServiceAvailable(settings, service) && settings.services[service].enabled;
}

export function driverVehicleNeedsReview(settings: DriverServiceSettings): boolean {
  return settings.vehicleReviewRequired === true || (settings.vehicleCategory === null
    && Object.values(settings.services).some(state => state.status === 'approved' || state.status === 'suspended'));
}

/** Matches enrollment eligibility; approval and consent are still enforced by the server. */
export function canApplyForDriverService(settings: DriverServiceSettings, service: DriverService): boolean {
  const state = settings.services[service];
  return !(service === 'ride' && settings.vehicleCategory === 'motorcycle')
    && state.status !== 'suspended'
    && (state.status !== 'pending' || !state.consentAccepted)
    && (state.status !== 'approved' || !state.consentAccepted);
}

export function driverServiceStatus(settings: DriverServiceSettings['services'][DriverService]): string {
  if (settings.status === 'approved') return settings.consentAccepted ? 'Approved' : 'Consent required';
  return { none: 'Not requested', pending: 'Under review', rejected: 'Rejected', suspended: 'Suspended' }[settings.status];
}
