import type { DriverApplicationResponse, DriverService, DriverServiceSettings } from '@/services/driverService';
import { canApplyForDriverService, driverVehicleNeedsReview } from './driverServices';

export function applicationDate(value?: string): string {
  if (!value) return 'Unavailable';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unavailable' : date.toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function applicationDecision(data: DriverApplicationResponse) {
  const states = Object.values(data.serviceSettings.services);
  const suspended = data.status === 'rejected' && states.some(state => state.status === 'suspended');
  const needsSelection = data.status === 'pending' && (data.serviceSettings.vehicleCategory === null || states.some(state => state.status === 'pending' && !state.consentAccepted));
  if (suspended) return { title: 'Service access suspended', detail: 'Contact support about this review. You can finish a job you already accepted.', tone: 'danger' as const, icon: 'lock' as const, action: 'Contact support', destination: 'support' as const };
  if (data.status === 'rejected') return { title: 'Application needs attention', detail: data.rejection_reason || 'Review your information and submit again.', tone: 'danger' as const, icon: 'info' as const, action: 'Review and resubmit', destination: 'resubmit' as const };
  if (driverVehicleNeedsReview(data.serviceSettings)) return { title: 'Vehicle review required', detail: 'Your existing vehicle type needs staff review before you can receive new jobs.', tone: 'warning' as const, icon: 'vehicle' as const, action: 'Contact support', destination: 'support' as const };
  if (data.status === 'approved') return { title: 'Application approved', detail: 'Your driver application is approved.', tone: 'success' as const, icon: 'safety' as const, action: 'Go to driver dashboard', destination: 'dashboard' as const };
  return { title: 'Application under review', detail: needsSelection ? 'Complete your service choices to continue the review.' : 'We will notify you when the review is complete.', tone: 'warning' as const, icon: 'clock' as const, action: needsSelection ? 'Complete service selection' : 'Continue as rider', destination: needsSelection ? 'selection' as const : 'rider' as const };
}

export interface ServiceApplicationChoice { category: 'car' | 'motorcycle'; services: DriverService[]; consentVersion: string; expectedVersion: number; accepted: boolean }

/** Validate the exact choices again at submission, against the latest store data. */
export function validServiceApplication(settings: DriverServiceSettings, choice: ServiceApplicationChoice): boolean {
  return choice.accepted && choice.expectedVersion === settings.version && choice.consentVersion === settings.consent.version
    && (choice.category === 'car' || choice.category === 'motorcycle')
    && (settings.vehicleCategory === null || choice.category === settings.vehicleCategory)
    && choice.services.length > 0 && new Set(choice.services).size === choice.services.length
    && choice.services.every(service => (service === 'ride' || service === 'courier') && canApplyForDriverService(settings, service)
      && (choice.category !== 'motorcycle' || service !== 'ride') && Boolean(settings.consent.descriptions[service]?.trim()));
}
