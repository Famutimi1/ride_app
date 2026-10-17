import { lockServiceProfile, eligibleServiceDriverIds, refreshServiceAvailability, isServiceOfferCurrent } from '../matching/serviceEligibility';
import type { PoolClient } from 'pg';
import { env } from '../../config/env';
import { db, inTransaction } from '../../shared/config/db';
import { ensureRedis } from '../../shared/config/redis';
import { acquireOfferLock, findEligibleDrivers, releaseOfferLock } from '../matching/matching.service';
import { releaseTripHold } from '../payments/tripPayments.service';
import { emitWalletUpdated } from '../../websocket/notifications';
import { transitionTrip } from './tripStateMachine';
import { emitDriverOffer, emitOfferCancelled, emitTripStatus } from './tripSocket';
import type { TripRow } from './trip.types';
import { createNotificationRecord, notifyUserSafely, publishNotification } from '../notifications/notifications.service';
import { driverOfferNotification } from '../notifications/notificationTemplates';
import type { CreatedNotification } from '../notifications/notifications.types';

export type DispatchResult = { kind: 'stopped' | 'terminal' | 'retry' } | { kind: 'expand'; radiusIndex: number } | { kind: 'offered'; driverId: string };

async function markNoDrivers(trip: TripRow) {
  let rescinded: string[] = [];
  const updated = await inTransaction(async (client) => {
    const locked = (await client.query<TripRow>('SELECT * FROM trips WHERE id=$1 FOR UPDATE', [trip.id])).rows[0];
    if (!locked || locked.status !== 'searching') return null;
    const updated = await transitionTrip(client, { tripId: trip.id, from: 'searching', to: 'no_drivers_found', actorType: 'system' });
    rescinded = (await client.query<{ driver_id: string }>("UPDATE trip_offers SET status='rescinded',responded_at=now() WHERE trip_id=$1 AND status='sent' RETURNING driver_id", [trip.id])).rows.map((row) => row.driver_id);
    await releaseTripHold(client, locked);
    if (locked.payment_status === 'held') updated.payment_status = 'released';
    return updated;
  });
  if (updated) {
    for (const driverId of rescinded) { await releaseOfferLock(driverId, trip.id); emitOfferCancelled(driverId, trip.id); }
    emitTripStatus(updated); if (updated.payment_status==='released') emitWalletUpdated(updated.rider_id);
  }
}

export async function dispatchNext(tripId: string, radiusIndex: number): Promise<DispatchResult> {
  let expiredTrip: TripRow | null = null;
  let offer: { driverId: string; payload: Record<string, unknown> } | null = null;
  let offerNotification: CreatedNotification | null = null;
  const result = await inTransaction<DispatchResult>(async (client) => {
    // Recovery jobs and multiple workers must serialize offers for the same trip.
    const trip = (await client.query<TripRow>('SELECT * FROM trips WHERE id=$1 FOR UPDATE', [tripId])).rows[0];
    if (!trip || trip.status !== 'searching') return { kind: 'stopped' };
    const activeOffer = await client.query("SELECT 1 FROM trip_offers WHERE trip_id=$1 AND status='sent' AND expires_at>now() LIMIT 1", [tripId]);
    if (activeOffer.rowCount) return { kind: 'stopped' };
    const deadline = trip.scheduled_at ? new Date(trip.scheduled_at).getTime() + 5 * 60_000
      : new Date(trip.requested_at).getTime() + env.SEARCH_TIMEOUT_SECONDS * 1000;
    const offerCount = Number((await client.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM trip_offers WHERE trip_id=$1', [tripId])).rows[0]?.count ?? 0);
    if (Date.now() >= deadline || offerCount >= env.MAX_OFFERS_PER_TRIP) {
      expiredTrip = trip;
      return { kind: 'terminal' };
    }
    const index = Math.min(Math.max(0, radiusIndex), env.DISPATCH_RADIUS_STEPS_M.length - 1);
    const candidates = await findEligibleDrivers(client, tripId, trip.pickup_lat, trip.pickup_lng, env.DISPATCH_RADIUS_STEPS_M[index]);
    for (const candidate of candidates) {
      if (!await acquireOfferLock(candidate.driverId, tripId)) continue;
      const availableLock=await client.query("SELECT id FROM users WHERE id=$1 AND is_active=true AND role='user' FOR UPDATE SKIP LOCKED",[candidate.driverId]);
      if(!availableLock.rowCount){await releaseOfferLock(candidate.driverId,tripId);continue;}
      await lockServiceProfile(candidate.driverId,client);
      if(!(await eligibleServiceDriverIds([candidate.driverId],trip.service_type,client)).has(candidate.driverId)){await releaseOfferLock(candidate.driverId,tripId);continue;}
      const { rows } = await client.query<{ expires_at: Date }>(
        `INSERT INTO trip_offers (trip_id,driver_id,distance_to_pickup_m,expires_at)
         VALUES ($1,$2,$3,now()+($4*interval '1 second')) ON CONFLICT DO NOTHING RETURNING expires_at`,
        [tripId, candidate.driverId, candidate.distanceToPickupM, env.OFFER_TIMEOUT_SECONDS],
      );
      if (!rows[0]) { await releaseOfferLock(candidate.driverId, tripId); continue; }
      offer = { driverId: candidate.driverId, payload: {
        tripId, serviceType: trip.service_type, packageDescription: trip.courier_details?.description,
        pickup: { latitude: trip.pickup_lat, longitude: trip.pickup_lng, address: trip.pickup_address },
        dropoff: { latitude: trip.dropoff_lat, longitude: trip.dropoff_lng, address: trip.dropoff_address },
        fareKobo: Number(trip.fare_kobo), distanceToPickupM: candidate.distanceToPickupM,
        expiresAt: rows[0].expires_at, serverNow: new Date().toISOString(),
      } };
      offerNotification = await createNotificationRecord(client,driverOfferNotification({driverId:candidate.driverId,tripId,fareKobo:Number(trip.fare_kobo),serviceType:trip.service_type,distanceToPickupM:candidate.distanceToPickupM,expiresAt:rows[0].expires_at}));
      return { kind: 'offered', driverId: candidate.driverId };
    }
    if (index < env.DISPATCH_RADIUS_STEPS_M.length - 1) return { kind: 'expand', radiusIndex: index + 1 };
    if (trip.scheduled_at) return { kind: 'retry' };
    expiredTrip = trip;
    return { kind: 'terminal' };
  });
  // Send only committed offers. A crash here is recoverable through the current-offer endpoint.
  if (offer) { const committed = offer as { driverId: string; payload: Record<string, unknown> }; if(await isServiceOfferCurrent(committed.driverId,tripId))emitDriverOffer(committed.driverId, committed.payload); }
  if(offerNotification)await publishNotification(offerNotification as CreatedNotification).catch((error:unknown)=>console.error('[notifications] driver offer publish failed',error instanceof Error?error.message:'unknown'));
  if (expiredTrip) await markNoDrivers(expiredTrip);
  return result;
}

/** Durable Postgres rows are the recovery source when queue submission was interrupted. */
export async function pendingSearchRecovery() {
  const { rows } = await db.query<{ id: string; requested_at: Date; scheduled_at: Date | null }>(
    "SELECT id,requested_at,scheduled_at FROM trips WHERE status='searching' ORDER BY requested_at ASC LIMIT 1000",
  );
  return rows.map((trip) => ({ tripId: trip.id, deadline: trip.scheduled_at
    ? new Date(trip.scheduled_at).getTime() + 5 * 60_000
    : new Date(trip.requested_at).getTime() + env.SEARCH_TIMEOUT_SECONDS * 1000 }));
}

export async function pendingOfferRecovery() {
  await refreshServiceAvailability();
  return (await db.query<{ trip_id: string; driver_id: string; expires_at: Date }>(
    "SELECT o.trip_id,o.driver_id,o.expires_at FROM trip_offers o JOIN trips t ON t.id=o.trip_id WHERE o.status='sent' AND t.status='searching' ORDER BY o.expires_at ASC LIMIT 1000",
  )).rows;
}

export async function expireOffer(tripId: string, driverId: string): Promise<boolean> {
  const result = await db.query(
    `UPDATE trip_offers SET status='expired',responded_at=now()
     WHERE trip_id=$1 AND driver_id=$2 AND status='sent' AND expires_at<=now()`,
    [tripId, driverId],
  );
  if (!result.rowCount) return false;
  await releaseOfferLock(driverId, tripId);
  emitOfferCancelled(driverId, tripId);
  await notifyUserSafely({userId:driverId,type:'offer_expired',category:'driver_offers',priority:'low',eventKey:`trip:${tripId}:offer_expired:${driverId}`,title:'Ride offer expired',body:'This offer is no longer available.',data:{tripId},deepLink:'/driver-dashboard',sendPush:false});
  return true;
}

export async function expireSearch(tripId: string) {
  const trip = (await db.query<TripRow>('SELECT * FROM trips WHERE id=$1', [tripId])).rows[0];
  if (trip?.status !== 'searching') return;
  if (trip.scheduled_at) {
    const activeOffer = await db.query(
      `SELECT 1 FROM trip_offers WHERE trip_id=$1 AND status='sent' AND expires_at>now() LIMIT 1`,
      [tripId],
    );
    if (activeOffer.rowCount) return;
  }
  await markNoDrivers(trip);
}

export async function logStaleTrips() {
  const { rows } = await db.query<{ id: string; status: string; driver_id: string | null }>(
    `SELECT id,status,driver_id FROM trips
     WHERE (status='driver_assigned' AND accepted_at<now()-interval '30 minutes')
        OR (status='in_progress' AND started_at<now()-interval '6 hours')`,
  );
  const redis = await ensureRedis();
  for (const trip of rows) {
    const online = trip.driver_id ? await redis.get(`driver:${trip.driver_id}:status`) : null;
    if (trip.status === 'driver_assigned' && online === 'online') continue;
    console.warn(`[trips] stale trip ${trip.id} (${trip.status}) requires review`);
  }
}
