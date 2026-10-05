import type { PoolClient } from 'pg';
import { ApiError } from '../../shared/errors';
import type { TripActor, TripRow, TripStatus } from './trip.types';

export const ALLOWED_TRANSITIONS: Readonly<Record<TripStatus, readonly TripStatus[]>> = {
  searching: ['driver_assigned', 'no_drivers_found', 'cancelled'],
  driver_assigned: ['driver_arrived', 'cancelled'],
  driver_arrived: ['in_progress', 'cancelled'],
  in_progress: ['completed'],
  completed: [],
  cancelled: [],
  no_drivers_found: [],
};

type TransitionFields = Partial<Pick<TripRow,
  'driver_id' | 'accepted_at' | 'arrived_at' | 'started_at' | 'completed_at' |
  'cancelled_at' | 'cancelled_by' | 'cancel_reason' | 'commission_kobo' | 'driver_earning_kobo'
>>;

const COLUMN_BY_FIELD: Record<keyof TransitionFields, string> = {
  driver_id: 'driver_id',
  accepted_at: 'accepted_at',
  arrived_at: 'arrived_at',
  started_at: 'started_at',
  completed_at: 'completed_at',
  cancelled_at: 'cancelled_at',
  cancelled_by: 'cancelled_by',
  cancel_reason: 'cancel_reason',
  commission_kobo: 'commission_kobo',
  driver_earning_kobo: 'driver_earning_kobo',
};

export function canTransition(from: TripStatus, to: TripStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export async function transitionTrip(client: PoolClient, input: {
  tripId: string;
  from: TripStatus;
  to: TripStatus;
  actorId?: string | null;
  actorType: TripActor;
  fields?: TransitionFields;
  metadata?: Record<string, unknown>;
}): Promise<TripRow> {
  if (!canTransition(input.from, input.to)) {
    throw new ApiError(409, 'invalid_transition', { from: input.from, to: input.to });
  }

  const values: unknown[] = [input.tripId, input.from, input.to];
  const sets = ['status=$3', 'updated_at=now()'];
  for (const [field, value] of Object.entries(input.fields ?? {}) as Array<[keyof TransitionFields, unknown]>) {
    values.push(value);
    sets.push(`${COLUMN_BY_FIELD[field]}=$${values.length}`);
  }
  const { rows } = await client.query<TripRow>(
    `UPDATE trips SET ${sets.join(', ')} WHERE id=$1 AND status=$2 RETURNING *`,
    values,
  );
  const trip = rows[0];
  if (!trip) throw new ApiError(409, 'trip_state_changed');

  await client.query(
    `INSERT INTO trip_status_history (trip_id,from_status,to_status,actor_id,actor_type,metadata)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [input.tripId, input.from, input.to, input.actorId ?? null, input.actorType, input.metadata ?? {}],
  );
  return trip;
}
