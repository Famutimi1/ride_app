import type { PoolClient } from 'pg';
import { ApiError } from '../../shared/errors';
import type { FareConfigRow } from './trip.types';

export function calculateFare(config: FareConfigRow, distanceM: number, durationS: number): number {
  const raw = Number(config.base_fare_kobo)
    + Math.round((distanceM / 1000) * Number(config.per_km_kobo))
    + Math.round((durationS / 60) * Number(config.per_min_kobo));
  return Math.ceil(Math.max(Number(config.min_fare_kobo), raw) / 100) * 100;
}

export function splitFare(fareKobo: number, commissionBps: number) {
  const commissionKobo = Math.floor((fareKobo * commissionBps) / 10_000);
  return { commissionKobo, driverEarningKobo: fareKobo - commissionKobo };
}

export async function getFareConfig(client: PoolClient, vehicleType = 'economy'): Promise<FareConfigRow> {
  const { rows } = await client.query<FareConfigRow>(
    'SELECT * FROM fare_config WHERE vehicle_type=$1 AND is_active=true',
    [vehicleType],
  );
  if (!rows[0]) throw new ApiError(409, 'vehicle_type_unavailable');
  return rows[0];
}
