import { randomUUID } from 'node:crypto';
import { db, inTransaction } from '../../shared/config/db';
import { createNotificationRecord, publishNotification } from '../notifications/notifications.service';
import { emitCommunicationMessage, emitCommunicationReceipt } from '../../websocket/notifications';
import { conversationRow } from './communication.policy';
import { MESSAGE_COLUMNS, presentMessage, presentReceipts, type MessageRow, type CommunicationRow } from './communication.types';

interface OutboxRow {
  id: string;
  trip_id: string;
  kind: 'message_socket' | 'message_push' | 'receipt_socket';
  message_id: string | null;
  recipient_id: string | null;
  attempts: number;
  lease_token: string;
}

// A narrow boundary allows real persistence/retry tests with failed transport.
export const communicationTransport = { message: emitCommunicationMessage, receipt: emitCommunicationReceipt };

async function deliveryConversation(tripId: string) {
  return (await db.query<CommunicationRow>(`SELECT c.* FROM trip_communications c JOIN trips t ON t.id=c.trip_id
    WHERE c.trip_id=$1 AND c.rider_id=t.rider_id AND c.driver_id=t.driver_id`,[tripId])).rows[0]??null;
}

async function dispatch(row: OutboxRow): Promise<void> {
  if (row.kind === 'receipt_socket') {
    const conversation = await deliveryConversation(row.trip_id);
    if (conversation) communicationTransport.receipt(presentReceipts(conversation),[conversation.rider_id,conversation.driver_id]);
    return;
  }
  const message = (await db.query<MessageRow>(`SELECT ${MESSAGE_COLUMNS} FROM trip_messages WHERE id=$1 AND trip_id=$2`,[row.message_id,row.trip_id])).rows[0];
  if (!message) return;
  if (row.kind === 'message_socket') {
    const conversation = await deliveryConversation(row.trip_id);
    if (conversation) communicationTransport.message(presentMessage(message),[conversation.rider_id,conversation.driver_id]);
    return;
  }
  const notification = await inTransaction(async client => {
    // Same trip -> conversation lock order as writes/receipts. Presence is not
    // delivery evidence; a persisted recipient receipt suppresses fallback push.
    await client.query('SELECT id FROM trips WHERE id=$1 FOR SHARE',[row.trip_id]);
    const conversation = await conversationRow(client,row.trip_id,true);
    if (!conversation || conversation.status!=='open' || message.created_at.getTime()+300_000<=Date.now()) return null;
    const rider = row.recipient_id===conversation.rider_id;
    if (!rider && row.recipient_id!==conversation.driver_id) return null;
    const delivered = rider ? conversation.rider_delivered_sequence : conversation.driver_delivered_sequence;
    if (BigInt(delivered)>=BigInt(message.sequence)) return null;
    return createNotificationRecord(client,{
      userId:row.recipient_id!,type:'trip_message',category:'trip_updates',
      eventKey:`trip_message:${row.trip_id}:${Math.floor(message.created_at.getTime()/15000)}`,
      title:'New trip message',body:'Open Rakky Ride to read your trip message.',
      data:{tripId:row.trip_id,audience:rider?'rider':'driver',messageSequence:message.sequence},
      deepLink:`/trip-chat?tripId=${row.trip_id}`,expiresAt:new Date(message.created_at.getTime()+300_000),
    });
  });
  // Notifications have their own persisted queue-recovery lifecycle.
  if (notification) await publishNotification(notification);
}

export async function processCommunicationOutbox(limit = 50): Promise<{ dispatched: number; failed: number }> {
  const leaseToken = randomUUID();
  const rows = (await db.query<OutboxRow>(`UPDATE communication_outbox o
    SET lease_token=$1,lease_until=now()+interval '30 seconds',attempts=o.attempts+1
    FROM (SELECT id FROM communication_outbox WHERE dispatched_at IS NULL AND available_at<=now()
      AND (lease_until IS NULL OR lease_until<now()) ORDER BY available_at,created_at,id
      FOR UPDATE SKIP LOCKED LIMIT $2) pending
    WHERE o.id=pending.id RETURNING o.*`,[leaseToken,Math.min(100,Math.max(1,limit))])).rows;
  let dispatched=0,failed=0;
  for (const row of rows) {
    try {
      await dispatch(row);
      const result=await db.query(`UPDATE communication_outbox SET dispatched_at=now(),lease_token=NULL,lease_until=NULL
        WHERE id=$1 AND lease_token=$2`,[row.id,row.lease_token]);
      dispatched+=result.rowCount??0;
    } catch {
      failed+=1;
      const backoff=Math.min(60,2**Math.min(row.attempts,6));
      await db.query(`UPDATE communication_outbox SET lease_token=NULL,lease_until=NULL,available_at=now()+$3*interval '1 second'
        WHERE id=$1 AND lease_token=$2`,[row.id,row.lease_token,backoff]);
      console.error('[communication] delivery deferred',{eventId:row.id,kind:row.kind});
    }
  }
  return {dispatched,failed};
}

export async function communicationDeliveryHealth() {
  const row=(await db.query<{pending:string;oldest_seconds:string|null}>(`SELECT count(*)::text AS pending,
    max(extract(epoch FROM(now()-created_at)))::text AS oldest_seconds
    FROM (
      SELECT created_at FROM communication_outbox WHERE dispatched_at IS NULL AND available_at<=now()
      UNION ALL SELECT created_at FROM call_outbox WHERE dispatched_at IS NULL AND available_at<=now()
      UNION ALL SELECT created_at FROM call_push_deliveries WHERE status='pending' AND available_at<=now()
    ) pending`)).rows[0];
  return {pending:Number(row.pending),oldestSeconds:Number(row.oldest_seconds??0)};
}
