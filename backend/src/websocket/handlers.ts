import type { Server, Socket } from 'socket.io';
import { saveDriverLocation, type DriverCoordinate } from '../modules/location/location.service';
import { refreshDriverTripLock } from '../modules/matching/matching.service';
import { ensureRedis } from '../shared/config/redis';
import { env } from '../config/env';
import { SOCKET_EVENTS } from './events';
import { db } from '../shared/config/db';
import { assertDriverCanGoOnline } from '../modules/payments/ledger.service';

interface TripMessage {
  id: string;
  tripId: string;
  senderId: string;
  senderRole: 'rider' | 'driver';
  text: string;
  sentAt: number;
}

function validCoordinate(value: Partial<DriverCoordinate>) {
  const timestamp = Number(value.timestamp);
  return Number.isFinite(value.latitude) && value.latitude! >= -90 && value.latitude! <= 90
    && Number.isFinite(value.longitude) && value.longitude! >= -180 && value.longitude! <= 180
    && Number.isFinite(timestamp) && Math.abs(Date.now() - timestamp) <= 2 * 60_000;
}

export function registerSocketHandlers(io: Server, socket: Socket) {
  const userId = String(socket.data.userId);
  socket.join(`driver:${userId}`);
  socket.join(`user:${userId}`);

  socket.on(SOCKET_EVENTS.JOIN_TRIP, async (tripId: string, acknowledge?: (result: { ok: boolean; error?: string }) => void) => {
    const { rows } = await db.query('SELECT 1 FROM trips WHERE id=$1 AND (rider_id=$2 OR driver_id=$2)', [tripId, userId]);
    if (!rows[0]) return acknowledge?.({ ok: false, error: 'trip_access_denied' });
    await socket.join(`trip:${tripId}`);
    acknowledge?.({ ok: true });
  });

  const locationHandler = async (payload: Partial<DriverCoordinate>, acknowledge?: (result: { ok: boolean; error?: string }) => void) => {
    if (!validCoordinate(payload)) { socket.emit(SOCKET_EVENTS.LOCATION_ERROR, 'Invalid coordinates'); return acknowledge?.({ ok: false, error: 'invalid_coordinates' }); }
    try {
      const active=(await db.query<{id:string}>("SELECT id FROM trips WHERE driver_id=$1 AND status IN ('driver_assigned','driver_arrived','in_progress') ORDER BY created_at DESC LIMIT 1",[userId])).rows[0];
      const {rows}=await db.query("SELECT 1 FROM driver_profiles WHERE user_id=$1 AND status='approved'",[userId]);
      if(!rows[0]&&!active) { socket.emit(SOCKET_EVENTS.LOCATION_ERROR,'Driver is not approved'); return acknowledge?.({ ok:false,error:'driver_not_approved' }); }
      if(!active) await assertDriverCanGoOnline(userId);
      const authenticatedPayload:DriverCoordinate={latitude:payload.latitude!,longitude:payload.longitude!,heading:payload.heading,driverId:userId,timestamp:payload.timestamp!};
      await saveDriverLocation(authenticatedPayload);
      if(active){
        authenticatedPayload.tripId=active.id;
        const redis=await ensureRedis();
        await Promise.all([redis.set(`trip:${active.id}:loc`,JSON.stringify(authenticatedPayload),'EX',30),refreshDriverTripLock(userId,active.id)]);
        const sample=await redis.set(`trip:${active.id}:breadcrumb`,String(payload.timestamp),'EX',env.BREADCRUMB_SAMPLE_SECONDS,'NX');
        if(sample==='OK')await db.query('INSERT INTO trip_locations (trip_id,lat,lng,recorded_at) VALUES ($1,$2,$3,to_timestamp($4/1000.0))',[active.id,payload.latitude,payload.longitude,payload.timestamp]);
        io.to(`trip:${active.id}`).emit(SOCKET_EVENTS.DRIVER_LOCATION,authenticatedPayload);
      }
      acknowledge?.({ok:true});
    } catch (error) {
      const message=error instanceof Error ? error.message : 'Location update failed';socket.emit(SOCKET_EVENTS.LOCATION_ERROR,message);acknowledge?.({ok:false,error:message});
    }
  };
  socket.on(SOCKET_EVENTS.DRIVER_LOCATION_UPDATE,locationHandler);
  socket.on(SOCKET_EVENTS.DRIVER_LOCATION,locationHandler);
  socket.on(SOCKET_EVENTS.DRIVER_OFFLINE,async(acknowledge?:(result:{ok:boolean;error?:string})=>void)=>{try{const active=(await db.query("SELECT 1 FROM trips WHERE driver_id=$1 AND status IN ('driver_assigned','driver_arrived','in_progress')",[userId])).rows[0];if(active)return acknowledge?.({ok:false,error:'active_trip_must_remain_online'});const redis=await ensureRedis();await redis.multi().del(`driver:${userId}:status`,`driver:${userId}:location`).zrem('drivers:locations',userId).exec();acknowledge?.({ok:true});}catch(error){acknowledge?.({ok:false,error:error instanceof Error?error.message:'offline_update_failed'});}});

  socket.on(SOCKET_EVENTS.TRIP_MESSAGE_SEND, async (payload: TripMessage) => {
    const text = typeof payload?.text === 'string' ? payload.text.trim() : '';
    const validRole = payload?.senderRole === 'rider' || payload?.senderRole === 'driver';
    if (!payload?.tripId || !payload?.id || !payload?.senderId || !validRole || !text || text.length > 1000) {
      socket.emit(SOCKET_EVENTS.TRIP_MESSAGE_ERROR, 'Invalid trip message');
      return;
    }

    const participant=await db.query('SELECT 1 FROM trips WHERE id=$1 AND (rider_id=$2 OR driver_id=$2)',[payload.tripId,userId]);
    if(!participant.rows[0])return socket.emit(SOCKET_EVENTS.TRIP_MESSAGE_ERROR,'Trip access denied');
    const trip=await db.query<{rider_id:string;driver_id:string|null}>('SELECT rider_id,driver_id FROM trips WHERE id=$1',[payload.tripId]);
    const senderRole=trip.rows[0]?.driver_id===userId?'driver':'rider';
    const message: TripMessage = { ...payload, senderId: userId, senderRole, text };
    await socket.join(`trip:${message.tripId}`);
    io.to(`trip:${message.tripId}`).emit(SOCKET_EVENTS.TRIP_MESSAGE, message);
  });
}
