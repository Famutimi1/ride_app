import { inTransaction } from '../../shared/config/db';
import { ensureRedis } from '../../shared/config/redis';
import { ApiError } from '../../shared/errors';
import { authorizedTrip, canSend, conversationRow, MAX_MESSAGE_LENGTH, validSequence } from './communication.policy';
import { MESSAGE_COLUMNS, presentMessage, presentReceipts, type MessagePage, type MessageRow } from './communication.types';
import { requestCommunicationDispatch } from './communicationQueue';
import { emitCommunicationMessage } from '../../websocket/notifications';

interface HistoryInput { before?: unknown; afterSeq?: unknown; throughSeq?: unknown; limit?: unknown }
export async function messageHistory(userId: string, tripId: string, input: HistoryInput = {}): Promise<MessagePage> {
  const { before,afterSeq,throughSeq } = input;
  if ((before !== undefined && (!validSequence(before) || before === '0'))
    || (afterSeq !== undefined && !validSequence(afterSeq))
    || (throughSeq !== undefined && (!validSequence(throughSeq) || afterSeq === undefined))
    || (before !== undefined && afterSeq !== undefined)) throw new ApiError(400, 'invalid_message_cursor');
  const limit = input.limit === undefined ? 50 : typeof input.limit === 'string' && /^\d{1,2}$/.test(input.limit) ? Number(input.limit) : 0;
  if (limit < 1 || limit > 50) throw new ApiError(400, 'invalid_message_limit');
  return inTransaction(async client => {
    await authorizedTrip(client,userId,tripId,'read');
    const conversation = await conversationRow(client,tripId);
    const highWater = conversation?.last_sequence ?? '0';
    const through = throughSeq === undefined ? highWater : throughSeq as string;
    if (BigInt(through) > BigInt(highWater) || (afterSeq !== undefined && BigInt(afterSeq as string) > BigInt(through))) {
      throw new ApiError(400,'invalid_message_cursor');
    }
    let beforeSequence: string | null = null;
    if (before !== undefined) {
      beforeSequence = (await client.query<{sequence:string}>('SELECT sequence::text FROM trip_messages WHERE trip_id=$1 AND id=$2',[tripId,before])).rows[0]?.sequence ?? null;
      if (!beforeSequence) throw new ApiError(400,'invalid_message_cursor');
    }
    const forward = afterSeq !== undefined;
    const query = forward
      ? `SELECT ${MESSAGE_COLUMNS} FROM trip_messages WHERE trip_id=$1 AND sequence>$2 AND sequence<=$3 ORDER BY trip_messages.sequence ASC LIMIT $4`
      : `SELECT ${MESSAGE_COLUMNS} FROM trip_messages WHERE trip_id=$1 AND ($2::bigint IS NULL OR sequence<$2) ORDER BY trip_messages.sequence DESC LIMIT $3`;
    const rows = (await client.query<MessageRow>(query,forward ? [tripId,afterSeq,through,limit+1] : [tripId,beforeSequence,limit+1])).rows;
    const page = rows.slice(0,limit);
    return { messages: (forward ? page : [...page].reverse()).map(presentMessage),
      nextBefore: !forward && rows.length>limit ? page.at(-1)!.id : null,
      nextAfter: forward && rows.length>limit ? page.at(-1)!.sequence : null,
      highWaterSequence: through, receipts: conversation ? presentReceipts(conversation) : null };
  });
}

export async function sendMessage(userId: string, tripId: string, input: unknown) {
  const value = input as { id?: unknown; text?: unknown } | null;
  const text = typeof value?.text === 'string' ? value.text.trim() : '';
  if (typeof value?.id !== 'string' || !value.id || value.id.length>120 || !text
    || [...text].length>MAX_MESSAGE_LENGTH || /\u0000/.test(text)) throw new ApiError(400,'invalid_trip_message');
  const clientId = value.id;
  const redis = await ensureRedis();
  const sent = Number(await redis.eval("local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],60) end; return n",1,`chat:rate:${userId}`));
  if (sent>30) throw new ApiError(429,'trip_message_rate_limited');
  const result = await inTransaction(async client => {
    // Always lock the trip before conversation/sequence work. Duplicate retry
    // checks happen under this lock, before allocating the next sequence.
    const trip = await authorizedTrip(client,userId,tripId,'write');
    const conversation = await conversationRow(client,tripId,true);
    const previous = (await client.query<MessageRow>(`SELECT ${MESSAGE_COLUMNS} FROM trip_messages WHERE trip_id=$1 AND sender_id=$2 AND client_message_id=$3`,[tripId,userId,clientId])).rows[0];
    if (previous) {
      if (previous.body!==text) throw new ApiError(409,'trip_message_conflict');
      return {message:presentMessage(previous),created:false,participants:[trip.rider_id,trip.driver_id!]};
    }
    if (!canSend(trip,conversation)) throw new ApiError(409,'trip_messaging_unavailable');
    const row = (await client.query<MessageRow>(`INSERT INTO trip_messages(trip_id,sender_id,sender_role,client_message_id,body)
      VALUES($1,$2,$3,$4,$5) RETURNING ${MESSAGE_COLUMNS}`,[tripId,userId,trip.driver_id===userId?'driver':'rider',clientId,text])).rows[0];
    const recipientId = trip.driver_id===userId ? trip.rider_id : trip.driver_id!;
    await client.query(`INSERT INTO communication_outbox(trip_id,kind,message_id,recipient_id,event_key,available_at)
      VALUES($1,'message_socket',$2,$3,$4,now()),($1,'message_push',$2,$3,$5,now()+interval '5 seconds')`,
    [tripId,row.id,recipientId,`message:${row.id}:socket`,`message:${row.id}:push`]);
    return {message:presentMessage(row),created:true,participants:[trip.rider_id,trip.driver_id!]};
  });
  // Dispatch is an optimization after commit. SQL recovery owns retry; neither
  // a socket failure nor Redis queue failure can turn persistence into failure.
  void requestCommunicationDispatch().catch(() => undefined);
  // Low-latency fast path; the outbox still guarantees recovery after a crash.
  // Clients deduplicate the later worker publication by record ID/retry key.
  try { emitCommunicationMessage(result.message,result.participants); } catch { /* Worker retries from SQL. */ }
  return {message:result.message,created:result.created};
}
