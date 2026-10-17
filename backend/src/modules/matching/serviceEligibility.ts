import type { PoolClient } from 'pg';
import { db } from '../../shared/config/db';
import { ApiError } from '../../shared/errors';
import { ensureRedis } from '../../shared/config/redis';
import { emitServiceSettingsChanged } from '../../websocket/notifications';
import { queueApplicationSubmitted } from '../notifications/email.service';

export type DriverService = 'ride' | 'courier';
export type ServiceStatus = 'none' | 'pending' | 'approved' | 'rejected' | 'suspended';
export const SERVICE_CONSENT_VERSION = 'service-choice-2026-10-16';
// Operational consent to these request types, not a replacement for platform terms.
export const SERVICE_DESCRIPTIONS = {
  ride: 'I want to receive passenger ride requests using my approved car. I can turn these requests off at any time. Disabling requests does not cancel an accepted trip.',
  courier: 'I want to receive courier requests for sealed packages up to 5 kg using my approved vehicle. I must follow pickup, delivery-code and return instructions. I can turn these requests off at any time. Disabling requests does not cancel an accepted delivery.',
} as const;

export interface ServiceProfile {
  status: 'none' | 'pending' | 'approved' | 'rejected';
  vehicle_category: 'car' | 'motorcycle' | null;
  ride_service_status: ServiceStatus;
  courier_service_status: ServiceStatus;
  accepts_ride: boolean;
  accepts_courier: boolean;
  service_settings_version: number;
  service_review_details: Record<string, unknown>;
  service_consent_history: Array<{ service: DriverService; action: 'accepted' | 'withdrawn'; version: string; at: string }>;
}

export async function lockServiceProfile(userId: string, client: PoolClient, options: { allowInactive?: boolean } = {}): Promise<ServiceProfile> {
  const user = (await client.query<{ role: string; is_active: boolean }>('SELECT role,is_active FROM users WHERE id=$1 FOR UPDATE', [userId])).rows[0];
  if (!user || user.role !== 'user' || (!user.is_active && !options.allowInactive)) throw new ApiError(403, 'driver_account_required');
  const profile = (await client.query<ServiceProfile>('SELECT * FROM driver_profiles WHERE user_id=$1 FOR UPDATE', [userId])).rows[0];
  if (!profile) throw new ApiError(409, 'personal_info_required');
  return profile;
}

export function hasConsent(profile: ServiceProfile, service: DriverService): boolean {
  if (service === 'ride' && profile.service_review_details.legacyPassengerApproval === true) return true;
  const latest = profile.service_consent_history.filter(entry => entry.service === service).at(-1);
  return latest?.action === 'accepted' && latest.version === SERVICE_CONSENT_VERSION;
}

function serviceConsent(profile: ServiceProfile, service: DriverService) {
  const latest=profile.service_consent_history.filter(entry=>entry.service===service).at(-1)??null;
  const recorded=latest?.action==='accepted'&&latest.version===SERVICE_CONSENT_VERSION;
  return {
    consentAccepted:hasConsent(profile,service),
    consentBasis:recorded?'recorded':service==='ride'&&profile.service_review_details.legacyPassengerApproval===true?'legacy_passenger_approval':'missing',
    consentRecord:latest,
  };
}

function settings(profile: ServiceProfile) {
  return {
    version: profile.service_settings_version,
    vehicleCategory: profile.vehicle_category,
    requestedVehicleCategory: profile.service_review_details.requestedVehicleCategory??null,
    services: {
      ride: { status: profile.ride_service_status, enabled: profile.accepts_ride, ...serviceConsent(profile,'ride'), review: profile.service_review_details.ride ?? null },
      courier: { status: profile.courier_service_status, enabled: profile.accepts_courier, ...serviceConsent(profile,'courier'), review: profile.service_review_details.courier ?? null },
    },
    consent: { version: SERVICE_CONSENT_VERSION, descriptions: SERVICE_DESCRIPTIONS },
  };
}

export async function getServiceSettings(userId: string, client: PoolClient) {
  const profile = (await client.query<ServiceProfile>('SELECT * FROM driver_profiles WHERE user_id=$1', [userId])).rows[0];
  return profile ? settings(profile) : {
    version: 0, vehicleCategory: null, requestedVehicleCategory:null,
    services: { ride: { status: 'none' as const, enabled: false, consentAccepted: false, consentBasis:'missing',consentRecord:null,review: null }, courier: { status: 'none' as const, enabled: false, consentAccepted: false, consentBasis:'missing',consentRecord:null,review: null } },
    consent: { version: SERVICE_CONSENT_VERSION, descriptions: SERVICE_DESCRIPTIONS },
  };
}

function checkVersion(profile: ServiceProfile, value: unknown) {
  if (!Number.isSafeInteger(value) || value !== profile.service_settings_version) throw new ApiError(409, 'service_settings_changed');
}

export async function submitServiceApplication(userId: string, input: Record<string, unknown>, client: PoolClient) {
  if(!input||typeof input!=='object'||Array.isArray(input))throw new ApiError(400,'invalid_service_settings');
  const profile = await lockServiceProfile(userId, client);
  checkVersion(profile, input.expectedVersion);
  if (!Array.isArray(input.services) || !input.services.length || input.services.length > 2 || new Set(input.services).size !== input.services.length || input.services.some(service => service !== 'ride' && service !== 'courier')) throw new ApiError(400, 'choose_driver_services');
  if (input.consentVersion !== SERVICE_CONSENT_VERSION || input.consentAccepted !== true) throw new ApiError(400, 'service_consent_required');
  const category = input.vehicleCategory;
  if (category !== 'car' && category !== 'motorcycle') throw new ApiError(400, 'choose_vehicle_category');
  if (category === 'motorcycle' && input.services.includes('ride')) throw new ApiError(400, 'motorcycle_courier_only');
  if (profile.status === 'approved' && profile.vehicle_category !== null && profile.vehicle_category !== category) throw new ApiError(409, 'approved_driver_material_requires_review');
  // Unknown legacy vehicles cannot be self-reclassified while keeping passenger approval.
  // Staff must confirm a legacy category. Until then retain only its existing passenger compatibility.
  const awaitingClassification = profile.status === 'approved' && profile.vehicle_category === null;
  const services = input.services as DriverService[];
  const details: Record<string, unknown> = { ...profile.service_review_details, requestedVehicleCategory: category };
  const history = [...profile.service_consent_history];
  let rideStatus = profile.status!=='approved'&&profile.ride_service_status==='pending'?'none':profile.ride_service_status;
  let courierStatus = profile.status!=='approved'&&profile.courier_service_status==='pending'?'none':profile.courier_service_status;
  if(awaitingClassification&&category==='motorcycle')details.legacyPassengerApproval=false;
  const at = new Date().toISOString();
  for (const service of services) {
    const status = service === 'ride' ? rideStatus : courierStatus;
    if (status === 'suspended') throw new ApiError(409, 'service_suspended_contact_support');
    if (status === 'approved' && hasConsent(profile, service)) throw new ApiError(409, 'service_already_approved');
    if (status !== 'approved') { if (service === 'ride') rideStatus = 'pending'; else courierStatus = 'pending'; }
    details[service] = { submittedAt: at, requestedPreference: true };
    history.push({ service, action: 'accepted', version: SERVICE_CONSENT_VERSION, at });
  }
  await client.query(`UPDATE driver_profiles SET vehicle_category=$2,ride_service_status=$3,courier_service_status=$4,
    accepts_ride=CASE WHEN $7::boolean THEN false ELSE accepts_ride END,service_review_details=$5,service_consent_history=$6,service_settings_version=service_settings_version+1,updated_at=clock_timestamp()
    WHERE user_id=$1`, [userId, awaitingClassification ? null : category, rideStatus, courierStatus, JSON.stringify(details), JSON.stringify(history),awaitingClassification&&category==='motorcycle']);
  if(profile.status==='approved')await queueApplicationSubmitted(client,userId,`services-${profile.service_settings_version+1}`);
  return getServiceSettings(userId, client);
}

export async function setServicePreferences(userId: string, input: Record<string, unknown>, client: PoolClient) {
  if (!input||typeof input!=='object'||Array.isArray(input))throw new ApiError(400,'invalid_service_preferences');
  if (Object.keys(input).some(key => !['acceptsRide', 'acceptsCourier', 'expectedVersion'].includes(key)) || typeof input.acceptsRide !== 'boolean' || typeof input.acceptsCourier !== 'boolean') throw new ApiError(400, 'invalid_service_preferences');
  const profile = await lockServiceProfile(userId, client);
  checkVersion(profile, input.expectedVersion);
  const details={...profile.service_review_details};
  for (const service of ['ride', 'courier'] as const) {
    const enabled = service === 'ride' ? input.acceptsRide : input.acceptsCourier;
    const prior=details[service];
    details[service]={...(prior&&typeof prior==='object'?prior:{}),requestedPreference:enabled};
    const status = service === 'ride' ? profile.ride_service_status : profile.courier_service_status;
    const validVehicle = service === 'ride' ? profile.vehicle_category === 'car' || (profile.vehicle_category === null && profile.service_review_details.legacyPassengerApproval === true) : profile.vehicle_category !== null;
    if (enabled && (profile.status !== 'approved' || status !== 'approved' || !hasConsent(profile, service) || !validVehicle)) throw new ApiError(403, 'service_not_approved');
  }
  await client.query(`UPDATE driver_profiles SET accepts_ride=$2,accepts_courier=$3,service_review_details=$4,service_settings_version=service_settings_version+1,updated_at=clock_timestamp() WHERE user_id=$1`, [userId, input.acceptsRide, input.acceptsCourier,JSON.stringify(details)]);
  return getServiceSettings(userId, client);
}

export async function withdrawServiceConsent(userId: string, service: unknown, expectedVersion: unknown, client: PoolClient) {
  if (service !== 'ride' && service !== 'courier') throw new ApiError(400, 'invalid_service_type');
  const profile = await lockServiceProfile(userId, client);
  checkVersion(profile, expectedVersion);
  const history = [...profile.service_consent_history, { service, action: 'withdrawn', version: SERVICE_CONSENT_VERSION, at: new Date().toISOString() }];
  const details = { ...profile.service_review_details, ...(service === 'ride' ? { legacyPassengerApproval: false } : {}) };
  await client.query(`UPDATE driver_profiles SET accepts_ride=CASE WHEN $2='ride' THEN false ELSE accepts_ride END,
    accepts_courier=CASE WHEN $2='courier' THEN false ELSE accepts_courier END,service_consent_history=$3,service_review_details=$4,
    service_settings_version=service_settings_version+1,updated_at=clock_timestamp() WHERE user_id=$1`, [userId, service, JSON.stringify(history), JSON.stringify(details)]);
  return getServiceSettings(userId, client);
}

/** Durable checks shared by maps/dispatch/staff; presence and Redis locks live outside SQL. */
export async function eligibleServiceDriverIds(driverIds: string[], service: DriverService, client: Pick<PoolClient, 'query'> = db): Promise<Set<string>> {
  if (!driverIds.length) return new Set();
  const { rows } = await client.query<{ user_id: string }>(`SELECT d.user_id FROM driver_profiles d JOIN users u ON u.id=d.user_id
    JOIN payment_settings s ON s.id=true LEFT JOIN ledger_accounts a ON a.owner_user_id=d.user_id AND a.kind='driver_earnings'
    WHERE d.user_id=ANY($1::uuid[]) AND u.is_active=true AND u.role='user' AND u.active_role='driver' AND driver_service_enabled(d,$2)
    AND COALESCE(a.balance_kobo,0)>-s.cash_debt_limit_kobo AND COALESCE(a.is_frozen,false)=false
    AND NOT EXISTS(SELECT 1 FROM trips t WHERE t.driver_id=d.user_id AND t.status IN ('driver_assigned','driver_arrived','in_progress','returning'))`, [driverIds, service]);
  return new Set(rows.map(row => row.user_id));
}

export async function assertServiceCanAccept(userId: string, service: DriverService, client: PoolClient) {
  await lockServiceProfile(userId, client);
  if (!(await eligibleServiceDriverIds([userId], service, client)).has(userId)) throw new ApiError(409, 'driver_service_unavailable');
  const redis = await ensureRedis();
  if (await redis.get(`driver:${userId}:status`) !== 'online') throw new ApiError(409, 'driver_offline');
}

/** After commit only: never lock offers while holding user/profile locks. Recovery retries cleanup. */
export async function refreshServiceAvailability(userId?: string) {
  if(userId)emitServiceSettingsChanged(userId);
  const { rows } = await db.query<{ trip_id: string; driver_id: string }>(`UPDATE trip_offers o SET status='rescinded',responded_at=now()
    FROM trips t,driver_profiles d WHERE o.trip_id=t.id AND d.user_id=o.driver_id AND ($1::uuid IS NULL OR o.driver_id=$1)
    AND o.status='sent' AND NOT driver_service_enabled(d,t.service_type) RETURNING o.trip_id,o.driver_id`, [userId??null]);
  if (!rows.length) return;
  const { releaseOfferLock } = await import('./matching.service.js');
  const { emitOfferCancelled } = await import('../trips/tripSocket.js');
  const { enqueueDispatch } = await import('../trips/tripQueue.js');
  for (const offer of rows) {
    await releaseOfferLock(offer.driver_id, offer.trip_id);
    emitOfferCancelled(offer.driver_id, offer.trip_id);
    await enqueueDispatch(offer.trip_id);
  }
}

export async function notifyServiceAvailability(userId: string) {
  // The write already committed. Never report a saved preference as failed when
  // Redis is unavailable; queue recovery and acceptance checks remain authoritative.
  await refreshServiceAvailability(userId).catch((error: unknown) => console.error('[driver-services] availability refresh failed', error instanceof Error ? error.message : 'unknown'));
}

export async function assertAnyServiceEnabled(userId: string) {
  const { rows } = await db.query(`SELECT 1 FROM driver_profiles d WHERE d.user_id=$1 AND (driver_service_enabled(d,'ride') OR driver_service_enabled(d,'courier'))`, [userId]);
  if (!rows.length) throw new ApiError(409, 'no_enabled_driver_services');
}

export async function isServiceOfferCurrent(driverId: string, tripId: string): Promise<boolean> {
  const offer = (await db.query<{ service_type: DriverService }>(`SELECT t.service_type FROM trip_offers o JOIN trips t ON t.id=o.trip_id
    WHERE o.driver_id=$1 AND o.trip_id=$2 AND o.status='sent' AND o.expires_at>now() AND t.status='searching'`, [driverId, tripId])).rows[0];
  return Boolean(offer && (await eligibleServiceDriverIds([driverId], offer.service_type)).has(driverId));
}

/** Called after staff authorization, evidence validation and user/profile locks. */
export async function reviewDriverServices(userId: string, input: Record<string, unknown>, actorId: string, reason: string, client: PoolClient) {
  // Staff must be able to restrict future work even if an account is inactive,
  // its legacy category is unknown, or its documents are no longer readable.
  const explicitDecisions = input.services;
  const restrictionsOnly = explicitDecisions === undefined
    ? input.decision === 'rejected'
    : Boolean(explicitDecisions && typeof explicitDecisions === 'object' && !Array.isArray(explicitDecisions)
      && Object.keys(explicitDecisions).length && Object.values(explicitDecisions).every(value => value === 'rejected' || value === 'suspended'));
  const profile = await lockServiceProfile(userId, client, { allowInactive: restrictionsOnly });
  const requested = input.services ?? Object.fromEntries((['ride', 'courier'] as const)
    .filter(service => (service === 'ride' ? profile.ride_service_status : profile.courier_service_status) === 'pending')
    .map(service => [service, input.decision]));
  if (!requested || typeof requested !== 'object' || Array.isArray(requested)) throw new ApiError(400, 'service_decisions_required');
  const decisions = requested as Record<string, unknown>;
  if (Object.keys(decisions).some(key => key !== 'ride' && key !== 'courier') || Object.values(decisions).some(value => value !== 'approved' && value !== 'rejected' && value !== 'suspended')) throw new ApiError(400, 'invalid_service_decisions');
  const hasReviewedVehicle=[profile.ride_service_status,profile.courier_service_status].some(status=>status==='approved'||status==='suspended');
  const canClassify=profile.vehicle_category===null||(profile.status==='pending'&&!hasReviewedVehicle);
  const classificationOnly=Object.keys(decisions).length===0&&canClassify&&input.vehicleCategory!==undefined;
  if(!Object.keys(decisions).length&&!classificationOnly)throw new ApiError(400,'service_decisions_required');
  const category = input.vehicleCategory ?? profile.vehicle_category;
  if (category !== 'car' && category !== 'motorcycle' && !(category === null && restrictionsOnly && input.vehicleCategory === undefined)) throw new ApiError(409, 'vehicle_classification_requires_review');
  if(profile.vehicle_category!==null&&category!==profile.vehicle_category&&(profile.status!=='pending'||hasReviewedVehicle))throw new ApiError(409,'approved_driver_material_requires_review');
  if(category==='motorcycle'&&profile.ride_service_status==='pending'&&decisions.ride!=='rejected')throw new ApiError(409,'motorcycle_passenger_application_requires_rejection');
  let ride = profile.ride_service_status;
  let courier = profile.courier_service_status;
  let rideEnabled = profile.accepts_ride;
  let courierEnabled = profile.accepts_courier;
  const details = { ...profile.service_review_details };
  if (category === 'motorcycle' && ride === 'approved') { ride = 'suspended'; rideEnabled = false; details.legacyPassengerApproval = false; }
  for (const service of Object.keys(decisions) as DriverService[]) {
    const decision = decisions[service] as ServiceStatus;
    const previous = service === 'ride' ? profile.ride_service_status : profile.courier_service_status;
    if (previous !== 'pending' && !(previous === 'approved' && decision === 'suspended') && !(previous === 'suspended' && decision === 'approved')) throw new ApiError(409, 'service_application_changed');
    if (decision === 'approved' && (!hasConsent(profile, service) || (service === 'ride' && category !== 'car'))) throw new ApiError(409, 'service_requirements_not_met');
    const prior = details[service] as { requestedPreference?: boolean } | undefined;
    // A restored service stays off until the driver explicitly enables it again.
    const enabled = decision === 'approved' && previous === 'pending' && prior?.requestedPreference === true;
    details[service] = { ...prior, reviewedAt: new Date().toISOString(), reviewedBy: actorId, reason };
    if (service === 'ride') { ride = decision; rideEnabled = enabled; } else { courier = decision; courierEnabled = enabled; }
  }
  const status = ride === 'approved' || courier === 'approved' ? 'approved' : ride === 'pending' || courier === 'pending' ? 'pending' : 'rejected';
  await client.query(`UPDATE driver_profiles SET status=$2,vehicle_category=$3,ride_service_status=$4,courier_service_status=$5,
    accepts_ride=$6,accepts_courier=$7,service_review_details=$8,rejection_reason=$9,reviewed_at=now(),updated_at=clock_timestamp(),
    service_settings_version=service_settings_version+1 WHERE user_id=$1`,
  [userId, status, category, ride, courier, rideEnabled, courierEnabled, JSON.stringify(details), status === 'rejected' ? reason : null]);
  return { status, serviceSettings: await getServiceSettings(userId, client) };
}
