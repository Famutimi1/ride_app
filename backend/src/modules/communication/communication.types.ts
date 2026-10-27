import type { PoolClient } from 'pg';

export type CommunicationDb = Pick<PoolClient, 'query'>;
export interface CommunicationTrip {
  id: string;
  rider_id: string;
  driver_id: string | null;
  status: string;
}
export interface CommunicationRow {
  trip_id: string;
  rider_id: string;
  driver_id: string;
  status: 'open' | 'closed';
  last_sequence: string;
  rider_delivered_sequence: string;
  rider_read_sequence: string;
  driver_delivered_sequence: string;
  driver_read_sequence: string;
  receipt_version: string;
}
export interface MessageRow {
  id: string;
  trip_id: string;
  sender_id: string;
  sender_role: 'rider' | 'driver';
  client_message_id: string;
  body: string;
  sequence: string;
  created_at: Date;
}
export interface TripMessage {
  id: string;
  recordId: string;
  tripId: string;
  senderId: string;
  senderRole: 'rider' | 'driver';
  text: string;
  sequence: string;
  sentAt: number;
}
export interface CommunicationReceipts {
  tripId: string;
  version: string;
  rider: { deliveredSequence: string; readSequence: string };
  driver: { deliveredSequence: string; readSequence: string };
}
export interface MessagePage {
  messages: TripMessage[];
  nextBefore: string | null;
  nextAfter: string | null;
  highWaterSequence: string;
  receipts: CommunicationReceipts | null;
}

export const MESSAGE_COLUMNS = 'id::text,trip_id,sender_id,sender_role,client_message_id,body,sequence::text,created_at';
export function presentMessage(row: MessageRow): TripMessage {
  return { id: row.client_message_id, recordId: row.id, tripId: row.trip_id, senderId: row.sender_id,
    senderRole: row.sender_role, text: row.body, sequence: row.sequence, sentAt: row.created_at.getTime() };
}
export function presentReceipts(row: CommunicationRow): CommunicationReceipts {
  return { tripId: row.trip_id, version: row.receipt_version,
    rider: { deliveredSequence: row.rider_delivered_sequence, readSequence: row.rider_read_sequence },
    driver: { deliveredSequence: row.driver_delivered_sequence, readSequence: row.driver_read_sequence } };
}
