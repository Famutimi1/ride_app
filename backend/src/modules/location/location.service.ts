import { ensureRedis } from '../../shared/config/redis';

const DRIVER_GEO_KEY = 'drivers:locations';

export interface DriverCoordinate {
  driverId: string;
  latitude: number;
  longitude: number;
  heading?: number;
  tripId?: string;
  timestamp: number;
}

export async function saveDriverLocation(location: DriverCoordinate) {
  const client = await ensureRedis();
  await client
    .multi()
    .geoadd(DRIVER_GEO_KEY, location.longitude, location.latitude, location.driverId)
    .set(`driver:${location.driverId}:status`, 'online', 'EX', 30)
    .set(`driver:${location.driverId}:location`, JSON.stringify(location), 'EX', 30)
    .exec();
}

export async function findNearbyDrivers(latitude: number, longitude: number, radiusKm: number) {
  const client = await ensureRedis();
  const rows = await client.geosearch(
    DRIVER_GEO_KEY,
    'FROMLONLAT', longitude, latitude,
    'BYRADIUS', radiusKm, 'km',
    'WITHCOORD', 'WITHDIST', 'ASC', 'COUNT', 30,
  ) as unknown as Array<[string, string, [string, string]]>;
  if (!rows.length) return [];

  const statuses = client.pipeline();
  for (const [driverId] of rows) statuses.get(`driver:${driverId}:status`);
  const statusResults = await statuses.exec();
  const staleDriverIds: string[] = [];
  const liveDrivers = rows.flatMap(([driverId, distanceKm, [lng, lat]], index) => {
    if (statusResults?.[index]?.[1] !== 'online') {
      staleDriverIds.push(driverId);
      return [];
    }
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
