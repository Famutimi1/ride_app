import { ApiError } from '../../shared/errors';
import { env } from '../../config/env';
import type { CommunicationDb, CommunicationRow, CommunicationTrip } from './communication.types';

export const MAX_MESSAGE_LENGTH = 2000;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function messagingWindowOpen(trip: CommunicationTrip): boolean {
  return Boolean(trip.driver_id && ['driver_assigned','driver_arrived','in_progress','returning'].includes(trip.status));
}
export function validSequence(value: unknown): value is string {
  return typeof value === 'string' && /^(0|[1-9]\d{0,18})$/.test(value) && BigInt(value) <= 9223372036854775807n;
}
export async function authorizedTrip(client: CommunicationDb, userId: string, tripId: string, lock: 'read' | 'write') {
  if (!uuid.test(tripId)) throw new ApiError(404, 'trip_not_found');
  const query = lock === 'write'
    ? 'SELECT id,rider_id,driver_id,status FROM trips WHERE id=$1 AND (rider_id=$2 OR driver_id=$2) FOR UPDATE'
    : 'SELECT id,rider_id,driver_id,status FROM trips WHERE id=$1 AND (rider_id=$2 OR driver_id=$2) FOR SHARE';
  const trip = (await client.query<CommunicationTrip>(query, [tripId,userId])).rows[0];
  if (!trip) throw new ApiError(404, 'trip_not_found');
  const snapshot = await conversationRow(client,tripId);
  if (snapshot && (snapshot.rider_id!==trip.rider_id || snapshot.driver_id!==trip.driver_id)) throw new ApiError(404,'trip_not_found');
  return trip;
}
export async function conversationRow(client: CommunicationDb, tripId: string, write = false) {
  const query = write ? 'SELECT * FROM trip_communications WHERE trip_id=$1 FOR UPDATE' : 'SELECT * FROM trip_communications WHERE trip_id=$1';
  return (await client.query<CommunicationRow>(query, [tripId])).rows[0] ?? null;
}
export function canSend(trip: CommunicationTrip, conversation: CommunicationRow | null): boolean {
  return env.COMMUNICATION_CHAT_ENABLED && messagingWindowOpen(trip) && conversation?.status === 'open'
    && trip.rider_id === conversation.rider_id && trip.driver_id === conversation.driver_id;
}

export async function chatPushEligible(client: CommunicationDb,userId: string,data: Record<string,unknown>): Promise<boolean> {
  if (typeof data.tripId!=='string' || !validSequence(data.messageSequence)) return false;
  const conversation=await conversationRow(client,data.tripId);
  if (!conversation || conversation.status!=='open') return false;
  const delivered=userId===conversation.rider_id?conversation.rider_delivered_sequence
    :userId===conversation.driver_id?conversation.driver_delivered_sequence:null;
  return delivered!==null&&BigInt(delivered)<BigInt(data.messageSequence);
}
