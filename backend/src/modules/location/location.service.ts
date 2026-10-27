import { ensureRedis } from '../../shared/config/redis';
import { eligibleServiceDriverIds, type DriverService } from '../matching/serviceEligibility';
import { advanceDriverMotion, type MotionSample } from './driverMotion';

const DRIVER_GEO_KEY = 'drivers:locations';

export interface DriverCoordinate {
  driverId: string;
  latitude: number;
  longitude: number;
  heading?: number;
  tripId?: string;
  timestamp: number;
  sampleTimestamp?: number;
  accuracy?: number | null;
  speed?: number | null;
}

export async function saveDriverLocation(location: DriverCoordinate) {
  const client = await ensureRedis();
  const locationKey = `driver:${location.driverId}:location`;
  // Compare-and-set keeps evidence ordered across sockets and backend replicas.
  for (let attempt = 0; attempt < 4; attempt++) {
    const saved = await client.get(locationKey);
    const previous = saved ? JSON.parse(saved) as MotionSample : null;
    const updated = advanceDriverMotion(previous, location, Date.now());
    const applied = await client.eval(`
      if (redis.call('GET',KEYS[1]) or '') ~= ARGV[1] then return 0 end
      redis.call('SET',KEYS[1],ARGV[2],'EX',30)
      redis.call('SET',KEYS[2],'online','EX',30)
      redis.call('GEOADD',KEYS[3],ARGV[3],ARGV[4],ARGV[5])
      return 1`, 3, locationKey, `driver:${location.driverId}:status`, DRIVER_GEO_KEY,
    saved ?? '', JSON.stringify(updated), location.longitude, location.latitude, location.driverId);
    if (Number(applied) === 1) return updated;
  }
  throw new Error('location_update_conflict');
}

export async function findNearbyDrivers(latitude: number, longitude: number, radiusKm: number, service: DriverService = 'ride') {
  const client = await ensureRedis();
  const rows = await client.geosearch(
    DRIVER_GEO_KEY,
    'FROMLONLAT', longitude, latitude,
    'BYRADIUS', radiusKm, 'km',
    'WITHCOORD', 'WITHDIST', 'ASC',
  ) as unknown as Array<[string, string, [string, string]]>;
  if (!rows.length) return [];

  const ids = rows.map(([driverId]) => driverId);
  const [approvedIds, statusResults] = await Promise.all([
    eligibleServiceDriverIds(ids,service),
    (async () => {
      const statuses = client.pipeline();
      for (const driverId of ids) {
        statuses.get(`driver:${driverId}:status`);
        statuses.exists(`driver:${driverId}:onTrip`);
      }
      return statuses.exec();
    })(),
  ]);
  const staleDriverIds: string[] = [];
  const liveDrivers = rows.flatMap(([driverId, distanceKm, [lng, lat]], index) => {
    const online = statusResults?.[index * 2]?.[1] === 'online';
    const busy = Number(statusResults?.[index * 2 + 1]?.[1] ?? 0) > 0;
    if (!online) {
      staleDriverIds.push(driverId);
      return [];
    }
    if (!approvedIds.has(driverId) || busy) return [];
    return [{
      driverId,
      distanceKm: Number(distanceKm),
      latitude: Number(lat),
      longitude: Number(lng),
    }];
  });

  if (staleDriverIds.length) await client.zrem(DRIVER_GEO_KEY, ...staleDriverIds);
  return liveDrivers;
}
