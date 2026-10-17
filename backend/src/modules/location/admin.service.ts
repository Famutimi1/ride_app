import { recordAdminRead } from "../../shared/utils/adminAudit";
import { db } from "../../shared/config/db";
import { ensureRedis } from "../../shared/config/redis";
import { ApiError } from "../../shared/errors";
import { staffSupplyEligibility } from "../matching/matching.service";
import type { DriverCoordinate } from "./location.service";
export interface Viewport {
  south: number;
  north: number;
  west: number;
  east: number;
  service: "ride" | "courier";
  limit: number;
}
export function parseViewport(input: Record<string, unknown>): Viewport {
  for (const key of Object.keys(input))
    if (!["south", "north", "west", "east", "service", "limit"].includes(key))
      throw new ApiError(400, "unsupported_filter");
  const number = (name: string, fallback: number) => {
    const value = input[name];
    if (value === undefined) return fallback;
    if (typeof value !== "string" || !/^[-]?\d+(\.\d+)?$/.test(value))
      throw new ApiError(400, "invalid_viewport");
    return Number(value);
  };
  const viewport = {
    south: number("south", 6.2),
    north: number("north", 6.8),
    west: number("west", 3.1),
    east: number("east", 3.8),
    service: (input.service ?? "ride") as "ride" | "courier",
    limit: number("limit", 100),
  };
  if (
    viewport.south < -90 ||
    viewport.north > 90 ||
    viewport.west < -180 ||
    viewport.east > 180 ||
    viewport.south >= viewport.north ||
    viewport.west >= viewport.east ||
    !Number.isInteger(viewport.limit) ||
    viewport.limit < 1 ||
    viewport.limit > 100 ||
    !["ride", "courier"].includes(viewport.service)
  )
    throw new ApiError(400, "invalid_viewport");
  return viewport;
}
function coordinate(value: unknown, driverId: string): DriverCoordinate | null {
  if (typeof value !== "string") return null;
  try {
    const data: unknown = JSON.parse(value);
    if (
      !data ||
      typeof data !== "object" ||
      !("driverId" in data) ||
      data.driverId !== driverId ||
      !("latitude" in data) ||
      typeof data.latitude !== "number" ||
      !Number.isFinite(data.latitude) ||
      Math.abs(data.latitude) > 90 ||
      !("longitude" in data) ||
      typeof data.longitude !== "number" ||
      !Number.isFinite(data.longitude) ||
      Math.abs(data.longitude) > 180 ||
      !("timestamp" in data) ||
      typeof data.timestamp !== "number" ||
      !Number.isFinite(data.timestamp)
    )
      return null;
    return {
      driverId,
      latitude: data.latitude,
      longitude: data.longitude,
      timestamp: data.timestamp,
    };
  } catch {
    return null;
  }
}
export async function adminLiveSnapshot(viewport: Viewport, actorId: string) {
  await recordAdminRead(actorId, "live_supply_read", "driver_location", null, {
    service: viewport.service,
    limit: viewport.limit,
  });
  const { rows } = await db.query<{
    id: string;
    name: string;
    approval: string;
    vehicle: string;
    plate: string;
    courierOptIn: boolean;
    activeTripId: string | null;
    activeTripService: "ride"|"courier"|null;
    rideOptIn:boolean;
    vehicleCategory:"car"|"motorcycle"|null;
    rideServiceStatus:string;
    courierServiceStatus:string;
  }>(
    `SELECT d.user_id AS id,u.full_name AS name,d.status AS approval,concat_ws(' ',d.vehicle_make,d.vehicle_model) AS vehicle,d.plate_number AS plate,d.accepts_courier AS "courierOptIn",d.accepts_ride AS "rideOptIn",d.vehicle_category AS "vehicleCategory",d.ride_service_status AS "rideServiceStatus",d.courier_service_status AS "courierServiceStatus",t.id AS "activeTripId",t.service_type AS "activeTripService" FROM driver_profiles d JOIN users u ON u.id=d.user_id LEFT JOIN trips t ON t.driver_id=d.user_id AND t.status IN ('driver_assigned','driver_arrived','in_progress','returning') WHERE (d.status='approved' AND u.is_active=true) OR t.id IS NOT NULL ORDER BY (t.id IS NOT NULL) DESC,d.user_id LIMIT $1`,
    [viewport.limit + 1],
  );
  const capped = rows.length > viewport.limit,
    candidates = rows.slice(0, viewport.limit),
    asOf = new Date().toISOString();
  const eligible = await staffSupplyEligibility(
    candidates.map((row) => row.id),
    viewport.service,
  );
  try {
    const redis = await ensureRedis(),
      pipeline = redis.pipeline();
    for (const driver of candidates) {
      pipeline.get(`driver:${driver.id}:location`);
      pipeline.get(`driver:${driver.id}:status`);
      pipeline.exists(`driver:${driver.id}:onTrip`);
    }
    const state = await pipeline.exec();
    if (!state || state.some((cell) => cell[0]))
      throw new Error("redis_snapshot_failed");
    const drivers = candidates.flatMap((driver, index) => {
      const location = coordinate(state[index * 3]?.[1], driver.id),
        age = location ? Date.parse(asOf) - location.timestamp : null;
      const fresh = age !== null && age >= 0 && age < 30000;
      if (
        location &&
        fresh &&
        (location.latitude < viewport.south ||
          location.latitude > viewport.north ||
          location.longitude < viewport.west ||
          location.longitude > viewport.east)
      )
        return [];
      const online = state[index * 3 + 1]?.[1] === "online",
        locked = Number(state[index * 3 + 2]?.[1]) > 0;
      return [
        {
          ...driver,
          availability: driver.activeTripId
            ? "busy"
            : fresh && online && !locked && eligible.has(driver.id)
              ? "available"
              : !fresh
                ? "location_unavailable"
                : locked
                  ? "busy"
                  : "ineligible",
          location: fresh
            ? {
                latitude: location!.latitude,
                longitude: location!.longitude,
                at: new Date(location!.timestamp).toISOString(),
              }
            : null,
        },
      ];
    });
    return {
      drivers,
      asOf,
      scope: viewport,
      capped,
      locationState: "ready",
      transport: "Authorized REST snapshot",
      availableDriversInSnapshot: drivers.filter(
        (driver) => driver.availability === "available",
      ).length,
    };
  } catch {
    return {
      drivers: candidates.map((driver) => ({
        ...driver,
        availability: driver.activeTripId ? "busy" : "unknown",
        location: null,
      })),
      asOf,
      scope: viewport,
      capped,
      locationState: "unavailable",
      transport: "Authorized REST snapshot",
      availableDriversInSnapshot: null,
    };
  }
}

/** Exact current eligibility count within a bounded scan; null if scan cannot be complete. */
export async function adminAvailableCount() {
  const candidates = (
    await db.query<{ id: string }>(
      "SELECT d.user_id AS id FROM driver_profiles d JOIN users u ON u.id=d.user_id WHERE d.status='approved' AND u.is_active=true ORDER BY d.user_id LIMIT 1001",
    )
  ).rows;
  if (candidates.length > 1000) return null;
  const eligible = await staffSupplyEligibility(
    candidates.map((d) => d.id),
    "ride",
  );
  try {
    const redis = await ensureRedis(),
      pipe = redis.pipeline();
    for (const d of candidates) {
      pipe.get(`driver:${d.id}:location`);
      pipe.get(`driver:${d.id}:status`);
      pipe.exists(`driver:${d.id}:onTrip`);
    }
    const values = await pipe.exec();
    if (!values || values.some((v) => v[0])) return null;
    const now = Date.now();
    return candidates.filter((d, i) => {
      const pos = coordinate(values[i * 3]?.[1], d.id);
      return (
        eligible.has(d.id) &&
        pos &&
        now - pos.timestamp >= 0 &&
        now - pos.timestamp < 30000 &&
        values[i * 3 + 1]?.[1] === "online" &&
        Number(values[i * 3 + 2]?.[1]) === 0
      );
    }).length;
  } catch {
    return null;
  }
}

/** Current position only; permanent trip samples are never a live-location fallback. */
export async function adminDriverPosition(
  driverId: string | null,
  activeTrip: boolean,
) {
  const asOf = new Date().toISOString();
  if (!driverId || !activeTrip)
    return { location: null, state: "not_applicable" as const, asOf };
  try {
    const redis = await ensureRedis();
    const point = coordinate(
      await redis.get(`driver:${driverId}:location`),
      driverId,
    );
    const age = point ? Date.parse(asOf) - point.timestamp : null;
    if (!point || age === null || age < 0 || age >= 30000)
      return { location: null, state: "unavailable" as const, asOf };
    return {
      location: {
        latitude: point.latitude,
        longitude: point.longitude,
        at: new Date(point.timestamp).toISOString(),
      },
      state: "fresh" as const,
      asOf,
    };
  } catch {
    return { location: null, state: "unavailable" as const, asOf };
  }
}

/** Directory presence contains timestamps and reasons, never live coordinates or another location store. */
export async function adminDriverPresence(ids: string[]) {
  const result = new Map<string,{availability:string;serviceAvailability:Record<'ride'|'courier',string>;locationAt:string|null;presenceReason:string}>();
  if(!ids.length)return result;
  const [rides,couriers]=await Promise.all([staffSupplyEligibility(ids,'ride'),staffSupplyEligibility(ids,'courier')]);
  try {
    const redis=await ensureRedis();
    const pipeline=redis.pipeline();
    for(const id of ids){pipeline.get(`driver:${id}:location`);pipeline.get(`driver:${id}:status`);pipeline.exists(`driver:${id}:onTrip`);}
    const values=await pipeline.exec();
    if(!values||values.some(value=>value[0]))throw new Error('presence_unavailable');
    ids.forEach((id,index)=>{
      const location=coordinate(values[index*3]?.[1],id);
      const age=location?Date.now()-location.timestamp:null;
      const online=values[index*3+1]?.[1]==='online';
      const locked=Number(values[index*3+2]?.[1])>0;
      const fresh=age!==null&&age>=0&&age<30000;
      const unavailable=locked?'busy':!online?'offline':!fresh?'stale':null;
      const availableFor=[rides.has(id)?'passenger rides':null,couriers.has(id)?'courier deliveries':null].filter(Boolean);
      result.set(id,{
        availability:unavailable??(availableFor.length?'available':'ineligible'),
        serviceAvailability:{ride:unavailable??(rides.has(id)?'available':'ineligible'),courier:unavailable??(couriers.has(id)?'available':'ineligible')},
        locationAt:location?new Date(location.timestamp).toISOString():null,
        presenceReason:locked?'Driver trip lock is held':!online?'No current online status':!fresh?'No location update within 30 seconds':availableFor.length?`Eligible for ${availableFor.join(' and ')}`:'Service approval, preference, consent, account, wallet or active-trip check failed',
      });
    });
  }catch{
    for(const id of ids)result.set(id,{availability:'unknown',serviceAvailability:{ride:'unknown',courier:'unknown'},locationAt:null,presenceReason:'Redis presence could not be observed'});
  }
  return result;
}
