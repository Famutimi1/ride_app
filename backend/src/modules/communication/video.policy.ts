import { env } from '../../config/env';
import { ensureRedis } from '../../shared/config/redis';
import { MOTION_FRESH_MS, type MotionSample } from '../location/driverMotion';

export interface VideoPolicy { allowed: boolean; reason: string | null; validUntil: number; }
export async function videoPolicy(trip: {driver_id: string | null; status: string}): Promise<VideoPolicy> {
  const denied = (reason: string): VideoPolicy => ({allowed:false, reason, validUntil:0});
  if (!env.COMMUNICATION_VIDEO_ENABLED) return denied('video_disabled');
  if (!trip.driver_id || !['driver_assigned','driver_arrived'].includes(trip.status)) return denied('video_before_trip_only');
  try {
    const raw = await (await ensureRedis()).get(`driver:${trip.driver_id}:location`);
    if (!raw) return denied('driver_location_unavailable');
    const sample = JSON.parse(raw) as MotionSample;
    const now = Date.now();
    if (!sample.motionReceivedAt || !sample.sampleTimestamp || sample.motionReceivedAt > now
      || now - sample.motionReceivedAt > MOTION_FRESH_MS || now - sample.sampleTimestamp > 10_000)
      return denied('driver_location_stale');
    if (typeof sample.accuracy !== 'number' || sample.accuracy > 20 || sample.accuracy < 0
      || !Number.isFinite(sample.accuracy) || !sample.stationarySince || now - sample.stationarySince < 8_000
      || (sample.stationarySamples ?? 0) < 3 || (sample.speed != null && (!Number.isFinite(sample.speed) || sample.speed > 0.5 || sample.speed < 0)))
      return denied('driver_must_be_stationary');
    return {allowed:true, reason:null, validUntil:Math.min(sample.motionReceivedAt + MOTION_FRESH_MS, sample.sampleTimestamp + 10_000)};
  } catch { return denied('driver_location_unavailable'); }
}
