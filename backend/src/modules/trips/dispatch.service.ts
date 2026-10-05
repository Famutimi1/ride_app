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

export type DispatchResult = { kind: 'stopped' | 'terminal' } | { kind: 'expand'; radiusIndex: number } | { kind: 'offered'; driverId: string };

async function markNoDrivers(trip: TripRow) {
  const updated = await inTransaction(async (client) => {
    const locked = (await client.query<TripRow>('SELECT * FROM trips WHERE id=$1 FOR UPDATE', [trip.id])).rows[0];
    if (!locked || locked.status !== 'searching') return null;
    const updated = await transitionTrip(client, { tripId: trip.id, from: 'searching', to: 'no_drivers_found', actorType: 'system' });
    await releaseTripHold(client, locked);
    if (locked.payment_status === 'held') updated.payment_status = 'released';
    return updated;
  });
  if (updated) { emitTripStatus(updated); if (updated.payment_status==='released') emitWalletUpdated(updated.rider_id); }
}

export async function dispatchNext(tripId: string, radiusIndex: number): Promise<DispatchResult> {
  const trip = (await db.query<TripRow>('SELECT * FROM trips WHERE id=$1', [tripId])).rows[0];
  if (!trip || trip.status !== 'searching') return { kind: 'stopped' };
  const ageSeconds = (Date.now() - new Date(trip.requested_at).getTime()) / 1000;
  const offerCount = Number((await db.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM trip_offers WHERE trip_id=$1', [tripId])).rows[0]?.count ?? 0);
  if (ageSeconds >= env.SEARCH_TIMEOUT_SECONDS || offerCount >= env.MAX_OFFERS_PER_TRIP) {
    await markNoDrivers(trip);
    return { kind: 'terminal' };
  }

  const index = Math.min(radiusIndex, env.DISPATCH_RADIUS_STEPS_M.length - 1);
  const radiusM = env.DISPATCH_RADIUS_STEPS_M[index];
  const client = await db.connect();
  try {
    const candidates = await findEligibleDrivers(client, tripId, trip.pickup_lat, trip.pickup_lng, radiusM);
    for (const candidate of candidates) {
      if (!await acquireOfferLock(candidate.driverId, tripId)) continue;
      const { rows } = await client.query<{ expires_at: Date }>(
        `INSERT INTO trip_offers (trip_id,driver_id,distance_to_pickup_m,expires_at)
         VALUES ($1,$2,$3,now()+($4*interval '1 second')) ON CONFLICT DO NOTHING RETURNING expires_at`,
        [tripId, candidate.driverId, candidate.distanceToPickupM, env.OFFER_TIMEOUT_SECONDS],
      );
      if (!rows[0]) {
        await releaseOfferLock(candidate.driverId, tripId);
        continue;
      }
      emitDriverOffer(candidate.driverId, {
        tripId,
        pickup: { latitude: trip.pickup_lat, longitude: trip.pickup_lng, address: trip.pickup_address },
        dropoff: { latitude: trip.dropoff_lat, longitude: trip.dropoff_lng, address: trip.dropoff_address },
        fareKobo: Number(trip.fare_kobo),
        distanceToPickupM: candidate.distanceToPickupM,
        expiresAt: rows[0].expires_at,
        serverNow: new Date().toISOString(),
      });
      return { kind: 'offered', driverId: candidate.driverId };
    }
  } finally {
    client.release();
  }

  if (index < env.DISPATCH_RADIUS_STEPS_M.length - 1) return { kind: 'expand', radiusIndex: index + 1 };
  await markNoDrivers(trip);
  return { kind: 'terminal' };
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
  return true;
}

export async function expireSearch(tripId: string) {
  const trip = (await db.query<TripRow>('SELECT * FROM trips WHERE id=$1', [tripId])).rows[0];
  if (trip?.status === 'searching') await markNoDrivers(trip);
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
