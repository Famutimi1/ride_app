import { db, inTransaction } from '../../shared/config/db';
import { ensureRedis } from '../../shared/config/redis';
import { ApiError } from '../../shared/errors';
import { getRoute } from '../maps/maps.service';
import { acquireDriverTripLock, releaseDriverTripLock, releaseOfferLock } from '../matching/matching.service';
import { calculateFare, getFareConfig, splitFare } from './fare.service';
import { holdTripFare, releaseTripHold, settleTrip } from '../payments/tripPayments.service';
import { emitWalletUpdated } from '../../websocket/notifications';
import { transitionTrip } from './tripStateMachine';
import { emitOfferCancelled, emitTripStatus } from './tripSocket';
import type { PaymentMethod, TripPoint, TripRow, TripStatus } from './trip.types';

function parsePoint(value: unknown, name: string): TripPoint {
  const point = value as Partial<TripPoint> | null;
  const latitude = Number(point?.latitude), longitude = Number(point?.longitude);
  const address = String(point?.address ?? '').trim();
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180 || !address) throw new ApiError(400, `invalid_${name}`);
  return { latitude, longitude, address, ...(point?.placeId ? { placeId: String(point.placeId) } : {}) };
}

function parsePayment(value: unknown): PaymentMethod {
  if (value === 'cash' || value === 'wallet') return value;
  if (value === 'card') throw new ApiError(409, 'card_payment_not_available');
  throw new ApiError(400, 'invalid_payment_method');
}

export function presentTrip<T extends TripRow>(trip: T) {
  return { ...trip, fare_kobo: Number(trip.fare_kobo), commission_kobo: trip.commission_kobo === null ? null : Number(trip.commission_kobo), driver_earning_kobo: trip.driver_earning_kobo === null ? null : Number(trip.driver_earning_kobo) };
}

export async function estimateTrip(input: Record<string, unknown>) {
  const pickup = parsePoint(input.pickup, 'pickup'), dropoff = parsePoint(input.dropoff, 'dropoff');
  if (pickup.latitude === dropoff.latitude && pickup.longitude === dropoff.longitude) throw new ApiError(400, 'pickup_matches_dropoff');
  const vehicleType = input.vehicleType === undefined || input.vehicleType === 'economy' ? 'economy' : String(input.vehicleType);
  const cacheKey = `trip:estimate:${pickup.latitude.toFixed(5)},${pickup.longitude.toFixed(5)}:${dropoff.latitude.toFixed(5)},${dropoff.longitude.toFixed(5)}:${vehicleType}`;
  const redis = await ensureRedis();
  const cached = await redis.get(cacheKey);
  if (cached) return JSON.parse(cached) as Record<string, unknown>;
  const route = await getRoute(pickup, dropoff);
  const client = await db.connect();
  try {
    const config = await getFareConfig(client, vehicleType);
    const distanceM = Math.max(1, Math.round(route.distanceKm * 1000)), durationS = Math.max(1, Math.round(route.durationMin * 60));
    const fareKobo = calculateFare(config, distanceM, durationS);
    const result = { vehicleType, distanceM, durationS, encodedPolyline: route.encodedPolyline, fareKobo, distanceKm: distanceM / 1000, durationMin: durationS / 60, estimatedFare: fareKobo / 100, currency: 'NGN' as const };
    await redis.set(cacheKey, JSON.stringify(result), 'EX', 60);
    return result;
  } finally { client.release(); }
}

export async function createTrip(riderId: string, input: Record<string, unknown>, idempotencyKey: string) {
  if (!idempotencyKey || idempotencyKey.length > 80) throw new ApiError(400, 'invalid_idempotency_key');
  const existing = (await db.query<TripRow>('SELECT * FROM trips WHERE rider_id=$1 AND idempotency_key=$2', [riderId, idempotencyKey])).rows[0];
  if (existing) return { trip: presentTrip(existing), created: false };
  const active = (await db.query<{id:string}>(`SELECT id FROM trips WHERE rider_id=$1 AND status IN ('searching','driver_assigned','driver_arrived','in_progress')`,[riderId])).rows[0];
  if (active) throw new ApiError(409, 'rider_has_active_trip', { tripId: active.id });
  const pickup = parsePoint(input.pickup, 'pickup'), dropoff = parsePoint(input.dropoff, 'dropoff');
  const paymentMethod = parsePayment(input.paymentMethod);
  const estimate = await estimateTrip({ pickup, dropoff, vehicleType: 'economy' });
  try {
    const trip = await inTransaction(async (client) => {
      const { rows } = await client.query<TripRow>(
        `INSERT INTO trips (rider_id,payment_method,pickup_lat,pickup_lng,pickup_address,pickup_place_id,dropoff_lat,dropoff_lng,dropoff_address,dropoff_place_id,estimated_distance_m,estimated_duration_s,route_polyline,fare_kobo,idempotency_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
        [riderId,paymentMethod,pickup.latitude,pickup.longitude,pickup.address,pickup.placeId??null,dropoff.latitude,dropoff.longitude,dropoff.address,dropoff.placeId??null,estimate.distanceM,estimate.durationS,estimate.encodedPolyline,estimate.fareKobo,idempotencyKey],
      );
      await client.query(`INSERT INTO trip_status_history (trip_id,from_status,to_status,actor_id,actor_type) VALUES ($1,NULL,'searching',$2,'rider')`, [rows[0].id, riderId]);
      await holdTripFare(client, rows[0]);
      if (paymentMethod === 'wallet') rows[0].payment_status = 'held';
      return rows[0];
    });
    if (paymentMethod === 'wallet') emitWalletUpdated(riderId);
    return { trip: presentTrip(trip), created: true };
  } catch (error) {
    const pgError = error as { code?: string; constraint?: string };
    if (pgError.code === '23505' && pgError.constraint === 'trips_rider_id_idempotency_key_key') {
      const trip = (await db.query<TripRow>('SELECT * FROM trips WHERE rider_id=$1 AND idempotency_key=$2', [riderId,idempotencyKey])).rows[0];
      if (trip) return { trip: presentTrip(trip), created: false };
    }
    if (pgError.code === '23505' && pgError.constraint === 'one_active_trip_per_rider') {
      const active = (await db.query<{id:string}>(`SELECT id FROM trips WHERE rider_id=$1 AND status IN ('searching','driver_assigned','driver_arrived','in_progress')`,[riderId])).rows[0];
      throw new ApiError(409, 'rider_has_active_trip', { tripId: active?.id });
    }
    throw error;
  }
}

const detailSelect = `SELECT t.*,du.full_name AS driver_name,du.avatar_url AS driver_avatar,du.rating_avg AS driver_rating,dp.vehicle_make,dp.vehicle_model,dp.vehicle_color,dp.plate_number,ru.full_name AS rider_name,ru.avatar_url AS rider_avatar,ru.rating_avg AS rider_rating FROM trips t JOIN users ru ON ru.id=t.rider_id LEFT JOIN users du ON du.id=t.driver_id LEFT JOIN driver_profiles dp ON dp.user_id=t.driver_id`;
interface TripDetailRow extends TripRow { driver_name:string|null;driver_avatar:string|null;driver_rating:string|null;vehicle_make:string|null;vehicle_model:string|null;vehicle_color:string|null;plate_number:string|null;rider_name:string;rider_avatar:string|null;rider_rating:string|null }

export async function getTripForParticipant(userId: string, tripId: string) {
  const trip=(await db.query<TripDetailRow>(`${detailSelect} WHERE t.id=$1 AND (t.rider_id=$2 OR t.driver_id=$2)`,[tripId,userId])).rows[0];
  if(!trip)throw new ApiError(404,'trip_not_found');return presentTrip(trip);
}

export async function getActiveTrip(userId:string,activeRole:'rider'|'driver'){
  const owner=activeRole==='driver'?'t.driver_id':'t.rider_id';
  const trip=(await db.query<TripDetailRow>(`${detailSelect} WHERE ${owner}=$1 AND t.status IN ('searching','driver_assigned','driver_arrived','in_progress') ORDER BY t.created_at DESC LIMIT 1`,[userId])).rows[0];
  if(!trip)return null;const redis=await ensureRedis();const latest=await redis.get(`trip:${trip.id}:loc`);return{...presentTrip(trip),latestDriverLocation:latest?JSON.parse(latest):null};
}

export async function acceptTrip(driverId:string,tripId:string){
  if(!await acquireDriverTripLock(driverId,tripId))throw new ApiError(409,'driver_has_active_trip');
  try{const trip=await inTransaction(async(client)=>{const locked=(await client.query<TripRow>('SELECT * FROM trips WHERE id=$1 FOR UPDATE',[tripId])).rows[0];if(!locked)throw new ApiError(404,'trip_not_found');if(locked.status!=='searching')throw new ApiError(409,'trip_no_longer_available');const accepted=await client.query(`UPDATE trip_offers SET status='accepted',responded_at=now() WHERE trip_id=$1 AND driver_id=$2 AND status='sent' AND expires_at>now()`,[tripId,driverId]);if(!accepted.rowCount)throw new ApiError(409,'offer_expired_or_invalid');return transitionTrip(client,{tripId,from:'searching',to:'driver_assigned',actorId:driverId,actorType:'driver',fields:{driver_id:driverId,accepted_at:new Date()}});});await releaseOfferLock(driverId,tripId);const detail=await getTripForParticipant(driverId,tripId);emitTripStatus(trip,{name:detail.driver_name,photo:detail.driver_avatar,rating:detail.driver_rating,vehicle:[detail.vehicle_color,detail.vehicle_make,detail.vehicle_model].filter(Boolean).join(' '),plate:detail.plate_number});return detail;}catch(error){await releaseDriverTripLock(driverId,tripId);const pgError=error as{code?:string;constraint?:string};if(pgError.code==='23505'&&pgError.constraint==='one_active_trip_per_driver')throw new ApiError(409,'driver_has_active_trip');throw error;}
}

export async function declineTrip(driverId:string,tripId:string){const result=await db.query(`UPDATE trip_offers SET status='declined',responded_at=now() WHERE trip_id=$1 AND driver_id=$2 AND status='sent' RETURNING id`,[tripId,driverId]);if(!result.rowCount)throw new ApiError(409,'offer_expired_or_invalid');await releaseOfferLock(driverId,tripId);emitOfferCancelled(driverId,tripId);return{success:true};}

async function driverTransition(driverId:string,tripId:string,from:TripStatus,to:TripStatus,field:'arrived_at'|'started_at'){
  const trip=await inTransaction(async(client)=>{const locked=(await client.query<TripRow>('SELECT * FROM trips WHERE id=$1 AND driver_id=$2 FOR UPDATE',[tripId,driverId])).rows[0];if(!locked)throw new ApiError(404,'trip_not_found');if(locked.status!==from)throw new ApiError(409,'invalid_trip_state',{expected:from,actual:locked.status});return transitionTrip(client,{tripId,from,to,actorId:driverId,actorType:'driver',fields:{[field]:new Date()}});});emitTripStatus(trip);return presentTrip(trip);
}
export const markDriverArrived=(driverId:string,tripId:string)=>driverTransition(driverId,tripId,'driver_assigned','driver_arrived','arrived_at');
export const startTrip=(driverId:string,tripId:string)=>driverTransition(driverId,tripId,'driver_arrived','in_progress','started_at');

export async function completeTrip(driverId:string,tripId:string){const trip=await inTransaction(async(client)=>{const locked=(await client.query<TripRow>('SELECT * FROM trips WHERE id=$1 AND driver_id=$2 FOR UPDATE',[tripId,driverId])).rows[0];if(!locked)throw new ApiError(404,'trip_not_found');if(locked.status!=='in_progress')throw new ApiError(409,'trip_not_in_progress');const config=await getFareConfig(client,locked.vehicle_type);const split=splitFare(Number(locked.fare_kobo),config.commission_bps);const updated=await transitionTrip(client,{tripId,from:'in_progress',to:'completed',actorId:driverId,actorType:'driver',fields:{completed_at:new Date(),commission_kobo:String(split.commissionKobo),driver_earning_kobo:String(split.driverEarningKobo)}});await settleTrip(client,locked,split.commissionKobo,split.driverEarningKobo);updated.payment_status='settled';return updated;});await releaseDriverTripLock(driverId,tripId);emitWalletUpdated(driverId);emitTripStatus(trip);return presentTrip(trip);}

export async function cancelTrip(userId:string,tripId:string,reasonValue:unknown){const reason=String(reasonValue??'').trim().slice(0,200);if(reason.length<3)throw new ApiError(400,'cancel_reason_required');let rescindedDriverId:string|null=null;const trip=await inTransaction(async(client)=>{const locked=(await client.query<TripRow>('SELECT * FROM trips WHERE id=$1 FOR UPDATE',[tripId])).rows[0];if(!locked||(locked.rider_id!==userId&&locked.driver_id!==userId))throw new ApiError(404,'trip_not_found');const actorType=locked.rider_id===userId?'rider':'driver';if(locked.status==='in_progress'||!['searching','driver_assigned','driver_arrived'].includes(locked.status))throw new ApiError(409,'trip_cannot_be_cancelled');if(actorType==='driver'&&locked.status==='searching')throw new ApiError(403,'not_trip_participant');if(locked.status==='searching'){const offer=(await client.query<{driver_id:string}>(`UPDATE trip_offers SET status='rescinded',responded_at=now() WHERE trip_id=$1 AND status='sent' RETURNING driver_id`,[tripId])).rows[0];rescindedDriverId=offer?.driver_id??null;}const updated=await transitionTrip(client,{tripId,from:locked.status,to:'cancelled',actorId:userId,actorType,fields:{cancelled_by:actorType,cancel_reason:reason,cancelled_at:new Date()}});await releaseTripHold(client,locked);updated.payment_status=locked.payment_status==='held'?'released':locked.payment_status;return updated;});if(rescindedDriverId){await releaseOfferLock(rescindedDriverId,tripId);emitOfferCancelled(rescindedDriverId,tripId);}if(trip.driver_id)await releaseDriverTripLock(trip.driver_id,tripId);if(trip.payment_status==='released')emitWalletUpdated(trip.rider_id);emitTripStatus(trip);return presentTrip(trip);}

export async function rateTrip(userId:string,tripId:string,ratingValue:unknown,commentValue:unknown){const rating=Number(ratingValue),comment=String(commentValue??'').trim().slice(0,300)||null;if(!Number.isInteger(rating)||rating<1||rating>5)throw new ApiError(400,'invalid_rating');return inTransaction(async(client)=>{const trip=(await client.query<TripRow>('SELECT * FROM trips WHERE id=$1 FOR UPDATE',[tripId])).rows[0];if(!trip||(trip.rider_id!==userId&&trip.driver_id!==userId))throw new ApiError(404,'trip_not_found');if(trip.status!=='completed'||!trip.driver_id)throw new ApiError(409,'trip_not_completed');const rateeId=trip.rider_id===userId?trip.driver_id:trip.rider_id;try{await client.query('INSERT INTO trip_ratings (trip_id,rater_id,ratee_id,rating,comment) VALUES ($1,$2,$3,$4,$5)',[tripId,userId,rateeId,rating,comment]);}catch(error){if((error as{code?:string}).code==='23505')throw new ApiError(409,'trip_already_rated');throw error;}await client.query(`UPDATE users SET rating_avg=((rating_avg*rating_count)+$1)/(rating_count+1),rating_count=rating_count+1,updated_at=now() WHERE id=$2`,[rating,rateeId]);return{success:true};});}

export async function tripHistory(userId:string,activeRole:'rider'|'driver',cursorValue:unknown,limitValue:unknown){const limit=Math.min(Math.max(Number(limitValue)||20,1),50);const cursor=typeof cursorValue==='string'&&cursorValue?new Date(cursorValue):null;if(cursor&&Number.isNaN(cursor.getTime()))throw new ApiError(400,'invalid_cursor');const owner=activeRole==='driver'?'driver_id':'rider_id',values:unknown[]=[userId,limit+1];const cursorSql=cursor?'AND created_at<$3':'';if(cursor)values.push(cursor);const{rows}=await db.query<TripRow>(`SELECT * FROM trips WHERE ${owner}=$1 AND status IN ('completed','cancelled','no_drivers_found') ${cursorSql} ORDER BY created_at DESC LIMIT $2`,values);const hasMore=rows.length>limit,items=rows.slice(0,limit).map(presentTrip);return{trips:items,nextCursor:hasMore?rows[limit-1]?.created_at.toISOString():null};}
