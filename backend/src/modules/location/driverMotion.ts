export interface MotionSample {
  latitude: number; longitude: number; timestamp: number;
  sampleTimestamp?: number; accuracy?: number | null; speed?: number | null;
  motionReceivedAt?: number; stationarySince?: number | null; stationarySamples?: number;
}

/** Conservative pilot defaults. GPS evidence is a safety signal, not a guarantee. */
export const MOTION_FRESH_MS = 7_000;
export function advanceDriverMotion(previous: MotionSample | null, next: MotionSample, now: number) {
  const sampleTimestamp = next.sampleTimestamp ?? next.timestamp;
  // Presence heartbeats must never make an old GPS fix appear stationary/fresh.
  if (previous && sampleTimestamp === previous.sampleTimestamp && next.latitude === previous.latitude
    && next.longitude === previous.longitude && next.accuracy === previous.accuracy && next.speed === previous.speed) return {
    ...next, sampleTimestamp, motionReceivedAt: previous.motionReceivedAt,
    stationarySince: previous.stationarySince, stationarySamples: previous.stationarySamples,
  };
  const result = { ...next, sampleTimestamp, motionReceivedAt: now, stationarySince: null as number | null, stationarySamples: 0 };
  if (!Number.isFinite(sampleTimestamp) || now - sampleTimestamp > 10_000 || sampleTimestamp > now + 1_000
    || typeof next.accuracy !== 'number' || !Number.isFinite(next.accuracy) || next.accuracy < 0 || next.accuracy > 20
    || (next.speed != null && (!Number.isFinite(next.speed) || next.speed < 0 || next.speed > 0.5))) return result;
  if (!previous || !previous.motionReceivedAt || !previous.sampleTimestamp
    || now - previous.motionReceivedAt > MOTION_FRESH_MS || sampleTimestamp <= previous.sampleTimestamp
    || sampleTimestamp - previous.sampleTimestamp > MOTION_FRESH_MS) return { ...result, stationarySince: now, stationarySamples: 1 };
  const radians = Math.PI / 180;
  const a = Math.sin((next.latitude - previous.latitude) * radians / 2) ** 2
    + Math.cos(next.latitude * radians) * Math.cos(previous.latitude * radians)
      * Math.sin((next.longitude - previous.longitude) * radians / 2) ** 2;
  const speed = 6_371_000 * 2 * Math.asin(Math.sqrt(Math.min(1, a))) / ((sampleTimestamp - previous.sampleTimestamp) / 1000);
  if (speed > 0.5) return result;
  return { ...result, stationarySince: previous.stationarySince ?? now, stationarySamples: (previous.stationarySamples ?? 0) + 1 };
}
