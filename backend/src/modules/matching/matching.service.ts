import type { PoolClient } from 'pg';
import { env } from '../../config/env';
import { ensureRedis } from '../../shared/config/redis';
import { findNearbyDrivers } from '../location/location.service';
import { getBalances } from '../payments/ledger.service';

export interface DriverCandidate {
  driverId: string;
  distanceToPickupM: number;
}

export async function findEligibleDrivers(client: PoolClient, tripId: string, latitude: number, longitude: number, radiusM: number): Promise<DriverCandidate[]> {
  const nearby = await findNearbyDrivers(latitude, longitude, radiusM / 1000);
  if (!nearby.length) return [];
  const ids = nearby.map((driver) => driver.driverId);
  const { rows } = await client.query<{ user_id: string }>(
    `SELECT dp.user_id FROM driver_profiles dp
     WHERE dp.user_id=ANY($1::uuid[]) AND dp.status='approved'
       AND NOT EXISTS (SELECT 1 FROM trips t WHERE t.driver_id=dp.user_id AND t.status IN ('driver_assigned','driver_arrived','in_progress'))
       AND NOT EXISTS (SELECT 1 FROM trip_offers o WHERE o.trip_id=$2 AND o.driver_id=dp.user_id)`,
    [ids, tripId],
  );
  const eligible = new Set(rows.map((row) => row.user_id));
  const redis = await ensureRedis();
  const pipeline = redis.pipeline();
  for (const driver of nearby) {
    pipeline.get(`driver:${driver.driverId}:status`);
    pipeline.exists(`driver:${driver.driverId}:onTrip`);
  }
  const states = await pipeline.exec();
  const candidates = nearby.flatMap((driver, index) => {
    const online = states?.[index * 2]?.[1] === 'online';
    const busy = Number(states?.[index * 2 + 1]?.[1] ?? 0) > 0;
    return eligible.has(driver.driverId) && online && !busy
      ? [{ driverId: driver.driverId, distanceToPickupM: Math.round(driver.distanceKm * 1000) }]
      : [];
  });
  const checked = await Promise.all(candidates.map(async (candidate) => ({ candidate, canGoOnline: (await getBalances(candidate.driverId)).canGoOnline })));
  return checked.filter((item) => item.canGoOnline).map((item) => item.candidate);
}

export async function acquireOfferLock(driverId: string, tripId: string): Promise<boolean> {
  const redis = await ensureRedis();
  return (await redis.set(`driver:offer:${driverId}`, tripId, 'EX', env.OFFER_TIMEOUT_SECONDS + 5, 'NX')) === 'OK';
}

export async function acquireDriverTripLock(driverId: string, tripId: string): Promise<boolean> {
  const redis = await ensureRedis();
  return (await redis.set(`driver:${driverId}:onTrip`, tripId, 'EX', 60, 'NX')) === 'OK';
}

export async function refreshDriverTripLock(driverId: string, tripId: string) {
  const redis = await ensureRedis();
  await redis.eval(
    `if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('expire',KEYS[1],ARGV[2]) else return 0 end`,
    1, `driver:${driverId}:onTrip`, tripId, 60,
  );
}

async function releaseOwnedLock(key: string, value: string) {
  const redis = await ensureRedis();
  await redis.eval(`if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end`, 1, key, value);
}

export const releaseOfferLock = (driverId: string, tripId: string) => releaseOwnedLock(`driver:offer:${driverId}`, tripId);
export const releaseDriverTripLock = (driverId: string, tripId: string) => releaseOwnedLock(`driver:${driverId}:onTrip`, tripId);
