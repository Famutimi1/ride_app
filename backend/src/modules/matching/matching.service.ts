import type { PoolClient } from 'pg';
import { env } from '../../config/env';
import { ensureRedis } from '../../shared/config/redis';
import { findNearbyDrivers } from '../location/location.service';
import { eligibleServiceDriverIds } from './serviceEligibility';

export interface DriverCandidate {
  driverId: string;
  distanceToPickupM: number;
}

export async function findEligibleDrivers(client: PoolClient, tripId: string, latitude: number, longitude: number, radiusM: number): Promise<DriverCandidate[]> {
  const requested=(await client.query<{service_type:'ride'|'courier'}>('SELECT service_type FROM trips WHERE id=$1',[tripId])).rows[0];
  if(!requested)return [];
  const nearby = await findNearbyDrivers(latitude, longitude, radiusM / 1000, requested.service_type);
  if (!nearby.length) return [];
  const ids = nearby.map((driver) => driver.driverId);
  const offered=await client.query<{driver_id:string}>('SELECT driver_id FROM trip_offers WHERE trip_id=$1',[tripId]);
  const eligible=await eligibleServiceDriverIds(ids,requested.service_type,client);
  for(const row of offered.rows)eligible.delete(row.driver_id);
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
  return candidates;
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

/** Shared supply eligibility for staff snapshots; this does not reserve a driver. */
export const staffSupplyEligibility = eligibleServiceDriverIds;
