const LAGOS_OFFSET_MS = 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

export const SCHEDULE_MIN_LEAD_MS = 30 * 60_000;
export const SCHEDULE_MAX_LEAD_MS = 7 * DAY_MS;

export function scheduleDays(now = Date.now()): number[] {
  const lagos = new Date(now + LAGOS_OFFSET_MS);
  const today = Date.UTC(lagos.getUTCFullYear(), lagos.getUTCMonth(), lagos.getUTCDate()) - LAGOS_OFFSET_MS;
  return Array.from({ length: 8 }, (_, index) => today + index * DAY_MS);
}

export function scheduleSlots(dayStart: number, now = Date.now()): number[] {
  return Array.from({ length: 48 }, (_, index) => dayStart + index * 30 * 60_000)
    .filter((time) => time >= now + SCHEDULE_MIN_LEAD_MS && time <= now + SCHEDULE_MAX_LEAD_MS);
}

export function formatScheduledTime(value: number | string, options?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('en-NG', {
    timeZone: 'Africa/Lagos',
    ...options,
  }).format(new Date(value));
}
