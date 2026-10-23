import {db,inTransaction} from '../../shared/config/db';
import {ensureRedis} from '../../shared/config/redis';
import {ApiError} from '../../shared/errors';
import {emitTripMessage} from '../../websocket/notifications';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
interface MessageRow {id:string;trip_id:string;sender_id:string;sender_role:'rider'|'driver';client_message_id:string;body:string;created_at:Date}
const present=(row:MessageRow)=>({id:row.client_message_id,recordId:row.id,tripId:row.trip_id,senderId:row.sender_id,senderRole:row.sender_role,text:row.body,sentAt:row.created_at.getTime()});
export async function tripMessages(userId:string,tripId:string,before:unknown){
  if(!uuid.test(tripId))throw new ApiError(404,'trip_not_found');
  if(before!==undefined&&(typeof before!=='string'||!/^\d{1,18}$/.test(before)))throw new ApiError(400,'invalid_message_cursor');
  if(!(await db.query('SELECT 1 FROM trips WHERE id=$1 AND (rider_id=$2 OR driver_id=$2)',[tripId,userId])).rowCount)throw new ApiError(404,'trip_not_found');
  const {rows}=await db.query<MessageRow>('SELECT id::text,trip_id,sender_id,sender_role,client_message_id,body,created_at FROM trip_messages WHERE trip_id=$1 AND ($2::bigint IS NULL OR id<$2) ORDER BY trip_messages.id DESC LIMIT 51',[tripId,before??null]);
  return {messages:rows.slice(0,50).reverse().map(present),nextBefore:rows.length>50?rows[49].id:null};
}
export async function sendTripMessage(userId:string,tripId:string,input:unknown){
  const value=input as {id?:unknown;text?:unknown}|null;
  const text=typeof value?.text==='string'?value.text.trim():'';
  if(!uuid.test(tripId)||typeof value?.id!=='string'||!value.id||value.id.length>120||!text||text.length>1000)throw new ApiError(400,'invalid_trip_message');
  const redis=await ensureRedis();
  const sent=Number(await redis.eval("local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],60) end; return n",1,`chat:rate:${userId}`));
  if(sent>30)throw new ApiError(429,'trip_message_rate_limited');
  const result=await inTransaction(async client=>{
    const trip=(await client.query<{rider_id:string;driver_id:string|null;status:string}>('SELECT rider_id,driver_id,status FROM trips WHERE id=$1 AND (rider_id=$2 OR driver_id=$2) FOR SHARE',[tripId,userId])).rows[0];
    if(!trip)throw new ApiError(404,'trip_not_found');
    const previous=(await client.query<MessageRow>('SELECT id::text,trip_id,sender_id,sender_role,client_message_id,body,created_at FROM trip_messages WHERE trip_id=$1 AND sender_id=$2 AND client_message_id=$3',[tripId,userId,value!.id])).rows[0];
    if(previous){if(previous.body!==text)throw new ApiError(409,'trip_message_conflict');return {message:present(previous),created:false};}
    if(!trip.driver_id||!['driver_assigned','driver_arrived','in_progress','returning'].includes(trip.status))throw new ApiError(409,'trip_messaging_unavailable');
    const {rows}=await client.query<MessageRow>(`INSERT INTO trip_messages(trip_id,sender_id,sender_role,client_message_id,body) VALUES($1,$2,$3,$4,$5) ON CONFLICT(trip_id,sender_id,client_message_id) DO NOTHING RETURNING id::text,trip_id,sender_id,sender_role,client_message_id,body,created_at`,[tripId,userId,trip.driver_id===userId?'driver':'rider',value!.id,text]);
    const row=rows[0]??(await client.query<MessageRow>('SELECT id::text,trip_id,sender_id,sender_role,client_message_id,body,created_at FROM trip_messages WHERE trip_id=$1 AND sender_id=$2 AND client_message_id=$3',[tripId,userId,value!.id])).rows[0];
    if(row.body!==text)throw new ApiError(409,'trip_message_conflict');
    return {message:present(row),created:!!rows[0]};
  });
  // Retried messages may be re-emitted; clients deduplicate using the server record ID.
  emitTripMessage(result.message);
  return result;
}
