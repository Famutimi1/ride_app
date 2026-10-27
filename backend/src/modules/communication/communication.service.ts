import { inTransaction } from '../../shared/config/db';
import { ApiError } from '../../shared/errors';
import { authorizedTrip, canSend, conversationRow, MAX_MESSAGE_LENGTH, validSequence } from './communication.policy';
import { presentReceipts } from './communication.types';
import { requestCommunicationDispatch } from './communicationQueue';
import { ensureRedis } from '../../shared/config/redis';
import { audioCallsEnabled,audioConnectionMode } from './call.service';
import { videoPolicy } from './video.policy';

export async function getCommunication(userId: string, tripId: string) {
  return inTransaction(async client => {
    const trip = await authorizedTrip(client,userId,tripId,'read');
    const conversation = await conversationRow(client,tripId);
    const enabled = canSend(trip,conversation);
    const peerId = trip.rider_id===userId ? trip.driver_id : trip.rider_id;
    const peer = peerId ? (await client.query<{id:string;full_name:string}>('SELECT id,full_name FROM users WHERE id=$1',[peerId])).rows[0] : null;
    const video=await videoPolicy(trip);
    return { tripId, status: conversation?.status ?? 'unavailable',
      participant: peer ? {id:peer.id,name:peer.full_name} : null,
      participantRole: trip.driver_id===userId ? 'driver' as const : 'rider' as const,
      canRead: true, canMessage: enabled, canAudioCall: audioCallsEnabled() && conversation?.status==='open',
      canVideoCall:audioCallsEnabled()&&conversation?.status==='open'&&video.allowed,
      videoUnavailableReason:video.reason,videoValidUntil:video.validUntil,
      audioConnectionMode:audioConnectionMode(),
      maxMessageLength: MAX_MESSAGE_LENGTH, highWaterSequence: conversation?.last_sequence ?? '0',
      receipts: conversation ? presentReceipts(conversation) : null,
      unavailableReason: enabled ? null : 'trip_messaging_unavailable' };
  });
}

export async function recordReceipt(userId: string, tripId: string, input: unknown) {
  const value = input as {kind?:unknown;sequence?:unknown}|null;
  if (!value || (value.kind!=='delivered'&&value.kind!=='read') || !validSequence(value.sequence)) throw new ApiError(400,'invalid_chat_receipt');
  const sequence = value.sequence;
  const redis=await ensureRedis();
  const attempts=Number(await redis.eval("local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],60) end; return n",1,`chat:receipt:rate:${userId}`));
  if(attempts>240)throw new ApiError(429,'chat_receipt_rate_limited');
  const result = await inTransaction(async client => {
    const trip = await authorizedTrip(client,userId,tripId,'write');
    const conversation = await conversationRow(client,tripId,true);
    if (!conversation || BigInt(sequence)>BigInt(conversation.last_sequence)) throw new ApiError(400,'invalid_chat_receipt');
    if (sequence!=='0' && !(await client.query('SELECT 1 FROM trip_messages WHERE trip_id=$1 AND sequence=$2 AND sender_id<>$3',[tripId,sequence,userId])).rowCount) throw new ApiError(400,'invalid_chat_receipt');
    const rider = trip.rider_id===userId;
    const delivered = rider ? conversation.rider_delivered_sequence : conversation.driver_delivered_sequence;
    const current = value.kind==='read' ? (rider ? conversation.rider_read_sequence : conversation.driver_read_sequence) : delivered;
    if (value.kind==='read' && BigInt(sequence)>BigInt(delivered)) throw new ApiError(409,'chat_receipt_not_delivered');
    if (BigInt(sequence)<=BigInt(current)) return presentReceipts(conversation);
    // Column names are selected from fixed SQL statements, never user input.
    const queries = {
      riderDelivered: 'UPDATE trip_communications SET rider_delivered_sequence=$2,receipt_version=receipt_version+1 WHERE trip_id=$1 RETURNING *',
      riderRead: 'UPDATE trip_communications SET rider_read_sequence=$2,receipt_version=receipt_version+1 WHERE trip_id=$1 RETURNING *',
      driverDelivered: 'UPDATE trip_communications SET driver_delivered_sequence=$2,receipt_version=receipt_version+1 WHERE trip_id=$1 RETURNING *',
      driverRead: 'UPDATE trip_communications SET driver_read_sequence=$2,receipt_version=receipt_version+1 WHERE trip_id=$1 RETURNING *',
    };
    const query = rider ? value.kind==='read' ? queries.riderRead : queries.riderDelivered : value.kind==='read' ? queries.driverRead : queries.driverDelivered;
    const updated = (await client.query<typeof conversation>(query,[tripId,sequence])).rows[0];
    await client.query(`INSERT INTO communication_outbox(trip_id,kind,event_key) VALUES($1,'receipt_socket',$2)`,[tripId,`receipt:${tripId}:${updated.receipt_version}`]);
    return presentReceipts(updated);
  });
  void requestCommunicationDispatch().catch(() => undefined);
  return result;
}
