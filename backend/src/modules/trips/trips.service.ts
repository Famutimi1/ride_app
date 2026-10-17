import { assertServiceCanAccept, eligibleServiceDriverIds } from '../matching/serviceEligibility';
import { db, inTransaction } from '../../shared/config/db';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env';
import { ensureRedis } from '../../shared/config/redis';
import { ApiError } from '../../shared/errors';
import { getRoute } from '../maps/maps.service';
import { acquireDriverTripLock, releaseDriverTripLock, releaseOfferLock } from '../matching/matching.service';
import { calculateFare, getFareConfig, splitFare } from './fare.service';
import { holdTripFare, releaseTripHold, settleTrip } from '../payments/tripPayments.service';
import { emitWalletUpdated } from '../../websocket/notifications';
import { transitionTrip } from './tripStateMachine';
import { emitOfferCancelled, emitTripStatus } from './tripSocket';
import { createNotificationRecord, publishNotification } from '../notifications/notifications.service';
import type { CourierDetails, PaymentMethod, TripEstimate, TripPoint, TripQuote, TripRow, TripStatus } from './trip.types';

function parseCourierDetails(value: unknown): CourierDetails {
  const input = value as Partial<CourierDetails & { acceptedRestrictions: boolean }> | null;
  const description = String(input?.description ?? '').trim();
  const recipientName = String(input?.recipientName ?? '').trim();
  const recipientPhone = String(input?.recipientPhone ?? '').trim();
  const weightKg = Number(input?.weightKg);
  const pickupInstructions = String(input?.pickupInstructions ?? '').trim();
  const dropoffInstructions = String(input?.dropoffInstructions ?? '').trim();
  if (description.length < 3 || description.length > 160 || recipientName.length < 2 || recipientName.length > 80 ||
      !/^\+[1-9]\d{7,14}$/.test(recipientPhone) || !Number.isFinite(weightKg) || weightKg <= 0 || weightKg > 5 ||
      pickupInstructions.length > 200 || dropoffInstructions.length > 200 || input?.acceptedRestrictions !== true) {
    throw new ApiError(400, 'invalid_courier_details');
  }
  return { description, recipientName, recipientPhone, weightKg,
    pickupInstructions: pickupInstructions || null, dropoffInstructions: dropoffInstructions || null };
}

function deliveryCode(tripId: string, version: number): string {
  const digest = createHmac('sha256', env.JWT_ACCESS_SECRET).update(`courier-delivery:${tripId}:${version}`).digest();
  return String(digest.readUInt32BE(0) % 1_000_000).padStart(6, '0');
}

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

function parseScheduledAt(value: unknown): Date | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) throw new ApiError(400, 'invalid_scheduled_time');
  const date = new Date(value);
  const delay = date.getTime() - Date.now();
  if (!Number.isFinite(delay) || delay < 30 * 60_000 || delay > 7 * 24 * 60 * 60_000) throw new ApiError(400, 'scheduled_time_out_of_range');
  return date;
}

export function presentTrip<T extends TripRow>(trip: T) {
  return { ...trip, fare_kobo: Number(trip.fare_kobo), commission_kobo: trip.commission_kobo === null ? null : Number(trip.commission_kobo), driver_earning_kobo: trip.driver_earning_kobo === null ? null : Number(trip.driver_earning_kobo) };
}

export async function estimateTrip(input: Record<string, unknown>): Promise<TripEstimate> {
  const pickup = parsePoint(input.pickup, 'pickup'), dropoff = parsePoint(input.dropoff, 'dropoff');
  if (pickup.latitude === dropoff.latitude && pickup.longitude === dropoff.longitude) throw new ApiError(400, 'pickup_matches_dropoff');
  const vehicleType = input.vehicleType === undefined || input.vehicleType === 'economy' ? 'economy' : String(input.vehicleType);
  const client = await db.connect();
  const config = await getFareConfig(client, vehicleType).finally(() => client.release());
  // A changed rate or disabled service cannot reuse a cached estimate from the previous configuration.
  const revision = [config.base_fare_kobo, config.per_km_kobo, config.per_min_kobo, config.min_fare_kobo, config.commission_bps].join(':');
  const cacheKey = `trip:estimate:${pickup.latitude.toFixed(5)},${pickup.longitude.toFixed(5)}:${dropoff.latitude.toFixed(5)},${dropoff.longitude.toFixed(5)}:${vehicleType}:${revision}`;
  const redis = await ensureRedis();
  const cached = await redis.get(cacheKey);
  if (cached) return JSON.parse(cached) as TripEstimate;
  const route = await getRoute(pickup, dropoff);
  {
    const distanceM = Math.max(1, Math.round(route.distanceKm * 1000)), durationS = Math.max(1, Math.round(route.durationMin * 60));
    const fareKobo = calculateFare(config, distanceM, durationS);
    const result = { vehicleType, distanceM, durationS, encodedPolyline: route.encodedPolyline, fareKobo, distanceKm: distanceM / 1000, durationMin: durationS / 60, estimatedFare: fareKobo / 100, currency: 'NGN' as const };
    await redis.set(cacheKey, JSON.stringify(result), 'EX', 60);
    return result;
  }
}

interface StoredQuote {
  riderId: string;
  pickup: TripPoint;
  dropoff: TripPoint;
  estimate: TripEstimate;
  expiresAt: number;
}

export async function quoteTrip(riderId: string, input: Record<string, unknown>): Promise<TripQuote> {
  const pickup = parsePoint(input.pickup, 'pickup');
  const dropoff = parsePoint(input.dropoff, 'dropoff');
  if (input.vehicleType !== undefined && input.vehicleType !== 'economy' && input.vehicleType !== 'courier') {
    throw new ApiError(400, 'invalid_vehicle_type');
  }
  const estimate = await estimateTrip({ ...input, pickup, dropoff });
  const quoteId = randomUUID();
  const expiresAt = Date.now() + env.TRIP_QUOTE_TTL_SECONDS * 1000;
  const quote: StoredQuote = { riderId, pickup, dropoff, estimate, expiresAt };
  const redis = await ensureRedis();
  await redis.set(`trip:quote:${quoteId}`, JSON.stringify(quote), 'EX', env.TRIP_QUOTE_TTL_SECONDS);
  return { ...estimate, quoteId, quoteExpiresAt: new Date(expiresAt).toISOString() };
}

async function getAcceptedQuote(riderId: string, quoteId: unknown, pickup: TripPoint, dropoff: TripPoint, vehicleType: string): Promise<StoredQuote> {
  if (typeof quoteId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(quoteId)) {
    throw new ApiError(409, 'trip_quote_required');
  }
  const redis = await ensureRedis();
  const value = await redis.get(`trip:quote:${quoteId}`);
  if (!value) throw new ApiError(409, 'trip_quote_expired');
  const quote = JSON.parse(value) as StoredQuote;
  if (quote.riderId !== riderId || quote.estimate.vehicleType !== vehicleType ||
      JSON.stringify(quote.pickup) !== JSON.stringify(pickup) || JSON.stringify(quote.dropoff) !== JSON.stringify(dropoff)) {
    throw new ApiError(409, 'trip_quote_mismatch');
  }
  if (quote.expiresAt <= Date.now()) throw new ApiError(409, 'trip_quote_expired');
  return quote;
}

export async function createTrip(riderId: string, input: Record<string, unknown>, idempotencyKey: string) {
  if (!idempotencyKey || idempotencyKey.length > 80) throw new ApiError(400, 'invalid_idempotency_key');
  const existing = (await db.query<TripRow>('SELECT * FROM trips WHERE rider_id=$1 AND idempotency_key=$2', [riderId, idempotencyKey])).rows[0];
  if (existing) return { trip: presentTrip(existing), created: false };
  const scheduledAt = parseScheduledAt(input.scheduledAt);
  const serviceType = input.serviceType === 'courier' ? 'courier' : input.serviceType === undefined || input.serviceType === 'ride' ? 'ride' : null;
  if (!serviceType || (serviceType === 'courier' && scheduledAt)) throw new ApiError(400, 'invalid_service_type');
  const courierDetails = serviceType === 'courier' ? parseCourierDetails(input.courierDetails) : null;
  if (!scheduledAt) {
    const active = (await db.query<TripRow>(`SELECT * FROM trips WHERE rider_id=$1 AND status IN ('searching','driver_assigned','driver_arrived','in_progress','returning')`,[riderId])).rows[0];
    if (active?.idempotency_key === idempotencyKey) return { trip: presentTrip(active), created: false };
    if (active) throw new ApiError(409, 'rider_has_active_trip', { tripId: active.id });
  }
  const pickup = parsePoint(input.pickup, 'pickup'), dropoff = parsePoint(input.dropoff, 'dropoff');
  const paymentMethod = parsePayment(input.paymentMethod);
  if (serviceType === 'courier' && paymentMethod !== 'wallet') throw new ApiError(400, 'courier_requires_wallet');
  const quote = await getAcceptedQuote(riderId, input.quoteId, pickup, dropoff, serviceType === 'courier' ? 'courier' : 'economy');
  const estimate = quote.estimate;
  try {
    const result = await inTransaction(async (client) => {
      const rider = (await client.query<{is_active: boolean; active_role: string}>('SELECT is_active,active_role FROM users WHERE id=$1 FOR UPDATE', [riderId])).rows[0];
      if (!rider?.is_active) throw new ApiError(403, 'account_inactive');
      if (rider.active_role !== 'rider') throw new ApiError(409, 'switch_to_rider_mode');
      if (scheduledAt) {
        const overlapping = await client.query(
          `SELECT 1 FROM trips WHERE rider_id=$1 AND status='scheduled'
           AND scheduled_at<$2 AND scheduled_at+(estimated_duration_s*interval '1 second')+interval '30 minutes'>$3 LIMIT 1`,
          [riderId, new Date(scheduledAt.getTime() + Number(estimate.durationS) * 1000 + 30 * 60_000), scheduledAt],
        );
        if (overlapping.rowCount) throw new ApiError(409, 'scheduled_trip_overlaps_existing');
      }
      // Check again after any scheduling lock wait, before creating a trip or holding money.
      if (quote.expiresAt <= Date.now()) throw new ApiError(409, 'trip_quote_expired');
      const bookingConfig = await getFareConfig(client, serviceType === "courier" ? "courier" : "economy");
      const { rows } = await client.query<TripRow>(
        `INSERT INTO trips (rider_id,payment_method,pickup_lat,pickup_lng,pickup_address,pickup_place_id,dropoff_lat,dropoff_lng,dropoff_address,dropoff_place_id,estimated_distance_m,estimated_duration_s,route_polyline,fare_kobo,idempotency_key,status,scheduled_at,service_type,courier_details,vehicle_type,commission_bps_snapshot)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING *`,
        [riderId,paymentMethod,pickup.latitude,pickup.longitude,pickup.address,pickup.placeId??null,dropoff.latitude,dropoff.longitude,dropoff.address,dropoff.placeId??null,estimate.distanceM,estimate.durationS,estimate.encodedPolyline,estimate.fareKobo,idempotencyKey,scheduledAt?'scheduled':'searching',scheduledAt,serviceType,courierDetails ? JSON.stringify(courierDetails) : null,serviceType === 'courier' ? 'courier' : 'economy',bookingConfig.commission_bps],
      );
      await client.query(`INSERT INTO trip_status_history (trip_id,from_status,to_status,actor_id,actor_type) VALUES ($1,NULL,$2,$3,'rider')`, [rows[0].id, rows[0].status, riderId]);
      const notification = scheduledAt ? await createNotificationRecord(client, {
        userId: riderId,
        type: 'scheduled_ride_confirmed',
        category: 'scheduled_reminders',
        eventKey: `trip:${rows[0].id}:scheduled-confirmed:rider`,
        title: 'Ride scheduled',
        body: `Pickup is scheduled for ${scheduledAt.toLocaleString('en-NG', { timeZone: 'Africa/Lagos', dateStyle: 'medium', timeStyle: 'short' })}.`,
        data: { tripId: rows[0].id, status: 'scheduled', scheduledAt: scheduledAt.toISOString() },
        deepLink: '/account/scheduled-rides',
      }) : null;
      if (!scheduledAt) {
        await holdTripFare(client, rows[0]);
        if (paymentMethod === 'wallet') rows[0].payment_status = 'held';
      }
      return { trip: rows[0], notification };
    });
    const trip = result.trip;
    if (result.notification) await publishNotification(result.notification).catch((error:unknown)=>console.error('[notifications] scheduled confirmation publish failed',error instanceof Error?error.message:'unknown'));
    if (paymentMethod === 'wallet' && !scheduledAt) emitWalletUpdated(riderId);
    return { trip: presentTrip(trip), created: true };
  } catch (error) {
    const pgError = error as { code?: string; constraint?: string };
    if (pgError.code === '23505' && pgError.constraint === 'trips_rider_id_idempotency_key_key') {
      const trip = (await db.query<TripRow>('SELECT * FROM trips WHERE rider_id=$1 AND idempotency_key=$2', [riderId,idempotencyKey])).rows[0];
      if (trip) return { trip: presentTrip(trip), created: false };
    }
    if (pgError.code === '23505' && pgError.constraint === 'one_active_trip_per_rider') {
      const active = (await db.query<{id:string}>(`SELECT id FROM trips WHERE rider_id=$1 AND status IN ('searching','driver_assigned','driver_arrived','in_progress','returning')`,[riderId])).rows[0];
      throw new ApiError(409, 'rider_has_active_trip', { tripId: active?.id });
    }
    throw error;
  }
}

export async function listScheduledTrips(riderId: string) {
  const { rows } = await db.query<TripRow>(
    `SELECT * FROM trips WHERE rider_id=$1 AND scheduled_at IS NOT NULL
      AND (status='scheduled' OR (scheduled_at>now()-interval '24 hours' AND status<>'completed'))
      ORDER BY scheduled_at ASC LIMIT 50`, [riderId],
  );
  return rows.map(presentTrip);
}

export async function activateDueScheduledTrips(): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM trips WHERE status='scheduled' AND scheduled_at<=now()+interval '5 minutes' ORDER BY scheduled_at ASC LIMIT 50`,
  );
  const activated: string[] = [];
  for (const { id } of rows) {
    try {
      const trip = await inTransaction(async (client) => {
        const locked = (await client.query<TripRow>('SELECT * FROM trips WHERE id=$1 FOR UPDATE', [id])).rows[0];
        if (!locked || locked.status !== 'scheduled' || !locked.scheduled_at || locked.scheduled_at.getTime() > Date.now() + 5 * 60_000) return null;
        if (locked.scheduled_at.getTime() < Date.now() - 5 * 60_000) {
          return transitionTrip(client, { tripId: id, from: 'scheduled', to: 'cancelled', actorType: 'system',
            fields: { cancelled_by: 'system', cancel_reason: 'pickup_time_passed', cancelled_at: new Date() } });
        }
        const active = await client.query(`SELECT 1 FROM trips WHERE rider_id=$1 AND id<>$2 AND status IN ('searching','driver_assigned','driver_arrived','in_progress','returning') LIMIT 1`, [locked.rider_id, id]);
        if (active.rowCount) throw new ApiError(409, 'rider_has_active_trip');
        await holdTripFare(client, locked);
        return transitionTrip(client, { tripId: id, from: 'scheduled', to: 'searching', actorType: 'system', fields: { requested_at: new Date() } });
      });
      if (trip) {
        if (trip.status === 'searching') {
          activated.push(id);
          if (trip.payment_method === 'wallet') emitWalletUpdated(trip.rider_id);
        }
        emitTripStatus(trip);
      }
    } catch (error) {
      const pg = error as { code?: string; constraint?: string };
      const reason = error instanceof ApiError && error.code === 'insufficient_funds' ? 'wallet_balance_insufficient'
        : error instanceof ApiError && error.code === 'account_frozen' ? 'wallet_unavailable'
        : error instanceof ApiError && error.code === 'rider_has_active_trip' || pg.constraint === 'one_active_trip_per_rider' ? 'another_trip_active' : null;
      if (!reason) throw error;
      const cancelled = await inTransaction(async (client) => {
        const locked = (await client.query<TripRow>('SELECT * FROM trips WHERE id=$1 FOR UPDATE', [id])).rows[0];
        if (!locked || locked.status !== 'scheduled') return null;
        return transitionTrip(client, { tripId: id, from: 'scheduled', to: 'cancelled', actorType: 'system', fields: { cancelled_by: 'system', cancel_reason: reason, cancelled_at: new Date() } });
      });
      if (cancelled) emitTripStatus(cancelled);
    }
  }
  return activated;
}

export async function scheduledSearchesWithoutOffers(): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT t.id FROM trips t WHERE t.status='searching' AND t.scheduled_at IS NOT NULL
      AND t.scheduled_at+interval '5 minutes'>now()
      AND NOT EXISTS (SELECT 1 FROM trip_offers o WHERE o.trip_id=t.id AND o.status='sent')
      ORDER BY t.requested_at ASC LIMIT 50`,
  );
  return rows.map((row) => row.id);
}

export async function scheduledSearchExpiryDelay(tripId: string): Promise<number> {
  const trip = (await db.query<{ scheduled_at: Date | null }>('SELECT scheduled_at FROM trips WHERE id=$1', [tripId])).rows[0];
  if (!trip?.scheduled_at) return 0;
  return Math.max(0, trip.scheduled_at.getTime() + 5 * 60_000 - Date.now());
}

export async function overdueScheduledSearches(): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM trips WHERE status='searching' AND scheduled_at IS NOT NULL
      AND scheduled_at+interval '5 minutes'<=now() ORDER BY scheduled_at ASC LIMIT 50`,
  );
  return rows.map((row) => row.id);
}

const detailSelect = `SELECT t.*,du.full_name AS driver_name,du.avatar_url AS driver_avatar,du.rating_avg AS driver_rating,dp.vehicle_make,dp.vehicle_model,dp.vehicle_color,dp.plate_number,ru.full_name AS rider_name,ru.avatar_url AS rider_avatar,ru.rating_avg AS rider_rating FROM trips t JOIN users ru ON ru.id=t.rider_id LEFT JOIN users du ON du.id=t.driver_id LEFT JOIN driver_profiles dp ON dp.user_id=t.driver_id`;
interface TripDetailRow extends TripRow { driver_name:string|null;driver_avatar:string|null;driver_rating:string|null;vehicle_make:string|null;vehicle_model:string|null;vehicle_color:string|null;plate_number:string|null;rider_name:string;rider_avatar:string|null;rider_rating:string|null }

export async function getTripForParticipant(userId: string, tripId: string) {
  const trip=(await db.query<TripDetailRow>(`${detailSelect} WHERE t.id=$1 AND (t.rider_id=$2 OR t.driver_id=$2)`,[tripId,userId])).rows[0];
  if(!trip)throw new ApiError(404,'trip_not_found');return presentTrip(trip);
}

export async function getCourierDeliveryCode(riderId: string, tripId: string) {
  const trip = (await db.query<TripRow>('SELECT * FROM trips WHERE id=$1 AND rider_id=$2', [tripId, riderId])).rows[0];
  if (!trip || trip.service_type !== 'courier') throw new ApiError(404, 'courier_trip_not_found');
  if (['cancelled', 'no_drivers_found', 'completed'].includes(trip.status)) throw new ApiError(409, 'delivery_code_unavailable');
  return { code: deliveryCode(tripId, trip.delivery_code_version) };
}

export async function rotateCourierDeliveryCode(riderId:string,tripId:string){
  return inTransaction(async(client)=>{
    const trip=(await client.query<TripRow>('SELECT * FROM trips WHERE id=$1 AND rider_id=$2 FOR UPDATE',[tripId,riderId])).rows[0];
    if(!trip||trip.service_type!=='courier')throw new ApiError(404,'courier_trip_not_found');
    if(!['in_progress','returning'].includes(trip.status))throw new ApiError(409,'delivery_code_rotation_unavailable');
    if(trip.delivery_reset_count>=2)throw new ApiError(429,'delivery_code_reset_limit');
    const updated=(await client.query<TripRow>('UPDATE trips SET delivery_attempts=0,delivery_code_version=delivery_code_version+1,delivery_reset_count=delivery_reset_count+1 WHERE id=$1 RETURNING *',[tripId])).rows[0];
    return {code:deliveryCode(tripId,updated.delivery_code_version)};
  });
}

export async function getActiveTrip(userId:string,activeRole:'rider'|'driver'){
  const owner=activeRole==='driver'?'t.driver_id':'t.rider_id';
  const trip=(await db.query<TripDetailRow>(`${detailSelect} WHERE ${owner}=$1 AND t.status IN ('searching','driver_assigned','driver_arrived','in_progress','returning') ORDER BY t.created_at DESC LIMIT 1`,[userId])).rows[0];
  if(!trip)return null;const redis=await ensureRedis();const latest=await redis.get(`trip:${trip.id}:loc`);return{...presentTrip(trip),latestDriverLocation:latest?JSON.parse(latest):null};
}

export async function getCurrentOffer(driverId: string) {
  const { rows } = await db.query<{
    trip_id: string; service_type: string; courier_details: CourierDetails | null;
    pickup_lat: number; pickup_lng: number; pickup_address: string;
    dropoff_lat: number; dropoff_lng: number; dropoff_address: string;
    fare_kobo: string; distance_to_pickup_m: number; expires_at: Date;
  }>(
    `SELECT o.trip_id,o.distance_to_pickup_m,o.expires_at,t.service_type,t.courier_details,
      t.pickup_lat,t.pickup_lng,t.pickup_address,t.dropoff_lat,t.dropoff_lng,t.dropoff_address,t.fare_kobo
     FROM trip_offers o JOIN trips t ON t.id=o.trip_id JOIN users u ON u.id=o.driver_id
     JOIN driver_profiles dp ON dp.user_id=u.id
     WHERE o.driver_id=$1 AND o.status='sent' AND o.expires_at>now() AND t.status='searching'
       AND u.is_active=true AND u.active_role='driver' AND driver_service_enabled(dp,t.service_type)
     ORDER BY o.sent_at DESC LIMIT 1`, [driverId],
  );
  const offer = rows[0];
  if(offer&&!(await eligibleServiceDriverIds([driverId],offer.service_type as 'ride'|'courier')).has(driverId))return null;
  return offer ? {
    tripId: offer.trip_id, serviceType: offer.service_type, packageDescription: offer.courier_details?.description,
    pickup: { latitude: offer.pickup_lat, longitude: offer.pickup_lng, address: offer.pickup_address },
    dropoff: { latitude: offer.dropoff_lat, longitude: offer.dropoff_lng, address: offer.dropoff_address },
    fareKobo: Number(offer.fare_kobo), distanceToPickupM: offer.distance_to_pickup_m,
    expiresAt: offer.expires_at, serverNow: new Date().toISOString(),
  } : null;
}

export async function acceptTrip(driverId:string,tripId:string){
  if(!await acquireDriverTripLock(driverId,tripId))throw new ApiError(409,'driver_has_active_trip');
  try {
    const trip=await inTransaction(async(client)=>{
      const locked=(await client.query<TripRow>('SELECT * FROM trips WHERE id=$1 FOR UPDATE',[tripId])).rows[0];
      if(!locked)throw new ApiError(404,'trip_not_found');
      if(locked.status!=='searching')throw new ApiError(409,'trip_no_longer_available');
      const driver=(await client.query<{is_active:boolean;active_role:string}>('SELECT is_active,active_role FROM users WHERE id=$1 FOR UPDATE',[driverId])).rows[0];
      if(!driver?.is_active)throw new ApiError(403,'account_inactive');
      if(driver.active_role!=='driver')throw new ApiError(409,'switch_to_driver_mode');
      await assertServiceCanAccept(driverId,locked.service_type,client);
      const accepted=await client.query(`UPDATE trip_offers SET status='accepted',responded_at=now() WHERE trip_id=$1 AND driver_id=$2 AND status='sent' AND expires_at>now()`,[tripId,driverId]);
      if(!accepted.rowCount)throw new ApiError(409,'offer_expired_or_invalid');
      return transitionTrip(client,{tripId,from:'searching',to:'driver_assigned',actorId:driverId,actorType:'driver',fields:{driver_id:driverId,accepted_at:new Date()}});
    });
    await releaseOfferLock(driverId,tripId);
    const detail=await getTripForParticipant(driverId,tripId);
    emitTripStatus(trip,{name:detail.driver_name,photo:detail.driver_avatar,rating:detail.driver_rating,vehicle:[detail.vehicle_color,detail.vehicle_make,detail.vehicle_model].filter(Boolean).join(' '),plate:detail.plate_number});
    return detail;
  } catch(error) {
    await releaseDriverTripLock(driverId,tripId);
    const pgError=error as{code?:string;constraint?:string};
    if(pgError.code==='23505'&&pgError.constraint==='one_active_trip_per_driver')throw new ApiError(409,'driver_has_active_trip');
    throw error;
  }
}

export async function declineTrip(driverId:string,tripId:string){const result=await db.query(`UPDATE trip_offers SET status='declined',responded_at=now() WHERE trip_id=$1 AND driver_id=$2 AND status='sent' RETURNING id`,[tripId,driverId]);if(!result.rowCount)throw new ApiError(409,'offer_expired_or_invalid');await releaseOfferLock(driverId,tripId);emitOfferCancelled(driverId,tripId);return{success:true};}

async function driverTransition(driverId:string,tripId:string,from:TripStatus,to:TripStatus,field:'arrived_at'|'started_at'){
  const trip=await inTransaction(async(client)=>{const locked=(await client.query<TripRow>('SELECT * FROM trips WHERE id=$1 AND driver_id=$2 FOR UPDATE',[tripId,driverId])).rows[0];if(!locked)throw new ApiError(404,'trip_not_found');if(locked.status!==from)throw new ApiError(409,'invalid_trip_state',{expected:from,actual:locked.status});return transitionTrip(client,{tripId,from,to,actorId:driverId,actorType:'driver',fields:{[field]:new Date()}});});emitTripStatus(trip);return presentTrip(trip);
}
export const markDriverArrived=(driverId:string,tripId:string)=>driverTransition(driverId,tripId,'driver_assigned','driver_arrived','arrived_at');
export const startTrip=(driverId:string,tripId:string)=>driverTransition(driverId,tripId,'driver_arrived','in_progress','started_at');

export async function returnCourierDelivery(driverId:string,tripId:string,reasonValue:unknown){
  const reason=String(reasonValue??'').trim().slice(0,200);
  if(reason.length<3)throw new ApiError(400,'delivery_issue_reason_required');
  const trip=await inTransaction(async(client)=>{
    const locked=(await client.query<TripRow>('SELECT * FROM trips WHERE id=$1 AND driver_id=$2 FOR UPDATE',[tripId,driverId])).rows[0];
    if(!locked)throw new ApiError(404,'trip_not_found');
    if(locked.service_type!=='courier'||locked.status!=='in_progress')throw new ApiError(409,'return_not_available');
    return transitionTrip(client,{tripId,from:'in_progress',to:'returning',actorId:driverId,actorType:'driver',fields:{delivery_issue_reason:reason}});
  });
  emitTripStatus(trip);
  return presentTrip(trip);
}

export async function completeTrip(driverId:string,tripId:string,codeValue?:unknown){const trip=await inTransaction(async(client)=>{const locked=(await client.query<TripRow>('SELECT * FROM trips WHERE id=$1 AND driver_id=$2 FOR UPDATE',[tripId,driverId])).rows[0];if(!locked)throw new ApiError(404,'trip_not_found');if(locked.status!=='in_progress'&&!(locked.service_type==='courier'&&locked.status==='returning'))throw new ApiError(409,'trip_not_in_progress');if(locked.service_type==='courier'){
    if(locked.delivery_attempts>=5)throw new ApiError(409,'delivery_code_locked');
    const code=typeof codeValue==='string'?codeValue:'';
    const correct=deliveryCode(tripId,locked.delivery_code_version);
    if(!/^\d{6}$/.test(code)||!timingSafeEqual(Buffer.from(code),Buffer.from(correct))){
      await client.query('UPDATE trips SET delivery_attempts=delivery_attempts+1 WHERE id=$1',[tripId]);
      return null;
    }
  }
  const commissionBps = locked.commission_bps_snapshot ?? (await getFareConfig(client,locked.vehicle_type,false)).commission_bps;const split=splitFare(Number(locked.fare_kobo),commissionBps);const returning=locked.status==='returning';const updated=await transitionTrip(client,{tripId,from:locked.status,to:returning?'returned':'completed',actorId:driverId,actorType:'driver',fields:{...(returning?{returned_at:new Date()}:{completed_at:new Date()}),commission_kobo:String(split.commissionKobo),driver_earning_kobo:String(split.driverEarningKobo),...(locked.service_type==='courier'?{delivery_verified_at:new Date()}:{})}});await settleTrip(client,locked,split.commissionKobo,split.driverEarningKobo);updated.payment_status='settled';return updated;});if(!trip)throw new ApiError(400,'invalid_delivery_code');await releaseDriverTripLock(driverId,tripId);emitWalletUpdated(driverId);emitTripStatus(trip);return presentTrip(trip);}

export async function cancelTrip(userId:string,tripId:string,reasonValue:unknown){const reason=String(reasonValue??'').trim().slice(0,200);if(reason.length<3)throw new ApiError(400,'cancel_reason_required');let rescindedDriverId:string|null=null;const trip=await inTransaction(async(client)=>{const locked=(await client.query<TripRow>('SELECT * FROM trips WHERE id=$1 FOR UPDATE',[tripId])).rows[0];if(!locked||(locked.rider_id!==userId&&locked.driver_id!==userId))throw new ApiError(404,'trip_not_found');const actorType=locked.rider_id===userId?'rider':'driver';if(locked.status==='in_progress'||!['scheduled','searching','driver_assigned','driver_arrived'].includes(locked.status))throw new ApiError(409,'trip_cannot_be_cancelled');if(actorType==='driver'&&['scheduled','searching'].includes(locked.status))throw new ApiError(403,'not_trip_participant');if(locked.status==='searching'){const offer=(await client.query<{driver_id:string}>(`UPDATE trip_offers SET status='rescinded',responded_at=now() WHERE trip_id=$1 AND status='sent' RETURNING driver_id`,[tripId])).rows[0];rescindedDriverId=offer?.driver_id??null;}const updated=await transitionTrip(client,{tripId,from:locked.status,to:'cancelled',actorId:userId,actorType,fields:{cancelled_by:actorType,cancel_reason:reason,cancelled_at:new Date()}});await releaseTripHold(client,locked);updated.payment_status=locked.payment_status==='held'?'released':locked.payment_status;return updated;});if(rescindedDriverId){await releaseOfferLock(rescindedDriverId,tripId);emitOfferCancelled(rescindedDriverId,tripId);}if(trip.driver_id)await releaseDriverTripLock(trip.driver_id,tripId);if(trip.payment_status==='released')emitWalletUpdated(trip.rider_id);emitTripStatus(trip);return presentTrip(trip);}

export async function rateTrip(userId:string,tripId:string,ratingValue:unknown,commentValue:unknown){const rating=Number(ratingValue),comment=String(commentValue??'').trim().slice(0,300)||null;if(!Number.isInteger(rating)||rating<1||rating>5)throw new ApiError(400,'invalid_rating');return inTransaction(async(client)=>{const trip=(await client.query<TripRow>('SELECT * FROM trips WHERE id=$1 FOR UPDATE',[tripId])).rows[0];if(!trip||(trip.rider_id!==userId&&trip.driver_id!==userId))throw new ApiError(404,'trip_not_found');if(trip.status!=='completed'||!trip.driver_id)throw new ApiError(409,'trip_not_completed');const rateeId=trip.rider_id===userId?trip.driver_id:trip.rider_id;try{await client.query('INSERT INTO trip_ratings (trip_id,rater_id,ratee_id,rating,comment) VALUES ($1,$2,$3,$4,$5)',[tripId,userId,rateeId,rating,comment]);}catch(error){if((error as{code?:string}).code==='23505')throw new ApiError(409,'trip_already_rated');throw error;}await client.query(`UPDATE users SET rating_avg=((rating_avg*rating_count)+$1)/(rating_count+1),rating_count=rating_count+1,updated_at=now() WHERE id=$2`,[rating,rateeId]);return{success:true};});}

export async function tripHistory(userId:string,activeRole:'rider'|'driver',cursorValue:unknown,limitValue:unknown,statusValue?:unknown,serviceTypeValue?:unknown){
  const limit=Math.min(Math.max(Number(limitValue)||20,1),50);
  const cursor=typeof cursorValue==='string'&&cursorValue?new Date(cursorValue):null;
  if(cursor&&Number.isNaN(cursor.getTime()))throw new ApiError(400,'invalid_cursor');
  const statuses=['completed','returned','cancelled','no_drivers_found'];
  if(statusValue!==undefined&&(typeof statusValue!=='string'||!statuses.includes(statusValue)))throw new ApiError(400,'invalid_status');
  if(serviceTypeValue!==undefined&&serviceTypeValue!=='ride'&&serviceTypeValue!=='courier')throw new ApiError(400,'invalid_service_type');
  const owner=activeRole==='driver'?'driver_id':'rider_id';
  const values:unknown[]=[userId];
  const conditions=[`${owner}=$1`,`status IN ('completed','returned','cancelled','no_drivers_found')`];
  if(statusValue){values.push(statusValue);conditions.push(`status=$${values.length}`);}
  if(serviceTypeValue){values.push(serviceTypeValue);conditions.push(`service_type=$${values.length}`);}
  if(cursor){values.push(cursor);conditions.push(`created_at<$${values.length}`);}
  values.push(limit+1);
  const{rows}=await db.query<TripRow>(`SELECT * FROM trips WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC LIMIT $${values.length}`,values);
  const hasMore=rows.length>limit,items=rows.slice(0,limit).map(presentTrip);
  return{trips:items,nextCursor:hasMore?rows[limit-1]?.created_at.toISOString():null};
}
