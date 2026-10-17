import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import dotenv from 'dotenv';
import { Pool } from 'pg';

dotenv.config();
const databaseUrl = process.env.DATABASE_URL;

test('accepted quotes protect booking prices and reject invalid requests before money moves', {
  skip: !databaseUrl || !process.env.REDIS_URL,
}, async (t) => {
  const schema = `quote_test_${process.pid}_${Date.now()}`;
  const admin = new Pool({ connectionString: databaseUrl });
  const scopedUrl = new URL(databaseUrl!);
  scopedUrl.searchParams.set('options', `-c search_path=${schema},public`);
  const originalFetch = globalThis.fetch;
  let appPool: Pool | undefined;
  let cache: Awaited<ReturnType<typeof import('../../shared/config/redis.js')['ensureRedis']>> | undefined;
  const redisKeys: string[] = [];
  const driverIds: string[] = [];
  const queuePrefix = `quote_queue_test_${randomUUID()}`;
  let stopQueues: (() => Promise<void>) | undefined;
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    process.env.DATABASE_URL = scopedUrl.toString();
    process.env.GOOGLE_MAPS_SERVER_KEY = 'quote-test-key';
    process.env.TRIP_QUOTE_TTL_SECONDS = '90';
    process.env.TRIP_QUEUE_PREFIX = queuePrefix;
    const { db } = await import('../../shared/config/db.js');
    appPool = db;
    for (const file of ['001_auth.sql', '002_trip_system.sql', '003_payments_ledger.sql', '004_scheduled_trips.sql', '005_courier_trips.sql', '006_courier_returns.sql', '007_courier_return_columns.sql', '008_driver_courier_preference.sql', '009_courier_code_rotation.sql', '013_trip_commission_snapshot.sql', '015_notifications.sql', '017_email_outbox.sql', '018_email_settings.sql', '016_driver_service_eligibility.sql']) {
      await db.query(await readFile(resolve(process.cwd(), 'migrations', file), 'utf8'));
    }
    globalThis.fetch = async (url) => {
      assert.ok(String(url).startsWith('https://maps.googleapis.com/maps/api/directions/json?'));
      return new Response(JSON.stringify({ status: 'OK', routes: [{ overview_polyline: { points: 'test-route' }, legs: [{ distance: { value: 12340 }, duration: { value: 1830 } }] }] }), { status: 200 });
    };
    const { ensureRedis } = await import('../../shared/config/redis.js');
    cache = await ensureRedis();
    const { quoteTrip, createTrip } = await import('./trips.service.js');
    const { switchActiveRole, getMe } = await import('../auth/auth.service.js');
    const { inTransaction } = await import('../../shared/config/db.js');
    const { transitionTrip } = await import('./tripStateMachine.js');
    const { getOrCreateWalletAccount, getSystemAccountId, postTransaction } = await import('../payments/ledger.service.js');
    const pickup = { latitude: 6.456, longitude: 3.3 + Math.random() / 100, address: 'Quote pickup' };
    const dropoff = { latitude: 6.556, longitude: 3.496, address: 'Quote destination' };
    for (const type of ['economy', 'courier']) redisKeys.push(`trip:estimate:${pickup.latitude.toFixed(5)},${pickup.longitude.toFixed(5)}:${dropoff.latitude.toFixed(5)},${dropoff.longitude.toFixed(5)}:${type}`);
    const makeRider = async () => (await db.query<{ id: string }>("INSERT INTO users(full_name) VALUES('Quote Test') RETURNING id")).rows[0].id;
    const issue = async (riderId: string, vehicleType = 'economy') => {
      const quote = await quoteTrip(riderId, { pickup, dropoff, vehicleType });
      redisKeys.push(`trip:quote:${quote.quoteId}`);
      return quote;
    };
    const fund = async (riderId: string) => {
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        const wallet = await getOrCreateWalletAccount(client, riderId);
        const expense = await getSystemAccountId(client, 'expense_adjustments');
        await postTransaction(client, { type: 'adjustment', idempotencyKey: randomUUID(), entries: [
          { accountId: expense, direction: 'debit', amountKobo: 10_000_000 },
          { accountId: wallet, direction: 'credit', amountKobo: 10_000_000 },
        ] });
        await client.query('COMMIT');
        return wallet;
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    };
    const details = { description: 'Test books', recipientName: 'Recipient', recipientPhone: '+2348012345678', weightKg: 1, acceptedRestrictions: true };

    await t.test('the configured quote lifetime is returned and enforced by Redis', async () => {
      const riderId = await makeRider();
      const quote = await issue(riderId);
      const remaining = Date.parse(quote.quoteExpiresAt) - Date.now();
      assert.ok(remaining > 85_000 && remaining <= 90_000);
      const ttl = await cache!.ttl(`trip:quote:${quote.quoteId}`);
      assert.ok(ttl > 85 && ttl <= 90);
      await assert.rejects(quoteTrip(riderId, { pickup, dropoff, vehicleType: 'premium' }), /invalid_vehicle_type/);
    });

    await t.test('missing, expired, wrong-owner, changed-route, and changed-service quotes create no trip or hold', async () => {
      const riderId = await makeRider();
      const anotherRider = await makeRider();
      const quote = await issue(riderId);
      const base = { pickup, dropoff, paymentMethod: 'wallet', quoteId: quote.quoteId };
      await assert.rejects(createTrip(riderId, { ...base, quoteId: undefined }, randomUUID()), /trip_quote_required/);
      await assert.rejects(createTrip(anotherRider, base, randomUUID()), /trip_quote_mismatch/);
      await assert.rejects(createTrip(riderId, { ...base, dropoff: { ...dropoff, latitude: 6.557 } }, randomUUID()), /trip_quote_mismatch/);
      await assert.rejects(createTrip(riderId, { ...base, serviceType: 'courier', courierDetails: details }, randomUUID()), /trip_quote_mismatch/);
      const key = `trip:quote:${quote.quoteId}`;
      const expired = JSON.parse((await cache!.get(key))!) as { expiresAt: number };
      expired.expiresAt = Date.now() - 1;
      await cache!.set(key, JSON.stringify(expired), 'EX', 90);
      await assert.rejects(createTrip(riderId, base, randomUUID()), /trip_quote_expired/);
      await cache!.del(key);
      await assert.rejects(createTrip(riderId, base, randomUUID()), /trip_quote_expired/);
      assert.equal((await db.query('SELECT id FROM trips WHERE rider_id=ANY($1)', [[riderId, anotherRider]])).rowCount, 0);
      assert.equal((await db.query("SELECT id FROM ledger_transactions WHERE type='trip_hold'")).rowCount, 0);
    });

    await t.test('accepted price survives a tariff change; concurrent and expired retries keep one exact hold', async () => {
      const riderId = await makeRider();
      const wallet = await fund(riderId);
      const quote = await issue(riderId);
      await db.query("UPDATE fare_config SET base_fare_kobo=base_fare_kobo+100000 WHERE vehicle_type='economy'");
      await cache!.del(redisKeys[0]);
      const fresh = await issue(riderId);
      assert.ok(fresh.fareKobo > quote.fareKobo);
      const key = randomUUID();
      const input = { pickup, dropoff, paymentMethod: 'wallet', quoteId: quote.quoteId, fareKobo: 1 };
      const results = await Promise.all([createTrip(riderId, input, key), createTrip(riderId, input, key)]);
      assert.equal(new Set(results.map(({ trip }) => trip.id)).size, 1);
      assert.equal(results.filter(({ created }) => created).length, 1);
      const trip = results[0].trip;
      assert.equal(trip.fare_kobo, quote.fareKobo, 'client-supplied amount cannot change the quote');
      assert.equal((await db.query('SELECT balance_kobo FROM ledger_accounts WHERE id=$1', [wallet])).rows[0].balance_kobo, String(10_000_000 - quote.fareKobo));
      assert.equal((await db.query("SELECT id FROM ledger_transactions WHERE reference_id=$1 AND type='trip_hold'", [trip.id])).rowCount, 1);
      await cache!.del(`trip:quote:${quote.quoteId}`);
      const replay = await createTrip(riderId, input, key);
      assert.equal(replay.created, false);
      assert.equal(replay.trip.id, trip.id);
      assert.equal(replay.trip.fare_kobo, quote.fareKobo);
    });

    await t.test('scheduled and courier requests use their accepted quote', async () => {
      const scheduledRider = await makeRider();
      const scheduledQuote = await issue(scheduledRider);
      const scheduled = await createTrip(scheduledRider, { pickup, dropoff, quoteId: scheduledQuote.quoteId, paymentMethod: 'wallet', scheduledAt: new Date(Date.now() + 60 * 60_000).toISOString() }, randomUUID());
      assert.equal(scheduled.trip.status, 'scheduled');
      assert.equal(scheduled.trip.fare_kobo, scheduledQuote.fareKobo);
      assert.equal((await db.query("SELECT id FROM ledger_transactions WHERE reference_id=$1 AND type='trip_hold'", [scheduled.trip.id])).rowCount, 0);
      const courierRider = await makeRider();
      await fund(courierRider);
      const courierQuote = await issue(courierRider, 'courier');
      const courier = await createTrip(courierRider, { pickup, dropoff, quoteId: courierQuote.quoteId, paymentMethod: 'wallet', serviceType: 'courier', courierDetails: details }, randomUUID());
      assert.equal(courier.trip.fare_kobo, courierQuote.fareKobo);
      assert.equal(courier.trip.vehicle_type, 'courier');
      assert.equal(courier.trip.payment_status, 'held');
    });

    await t.test('booking and role changes cannot race past each other', async () => {
      const riderId = await makeRider();
      await db.query("INSERT INTO driver_profiles(user_id,status,vehicle_category,ride_service_status,accepts_ride,service_consent_history) VALUES($1,'approved','car','approved',true,'[{\"service\":\"ride\",\"action\":\"accepted\",\"version\":\"service-choice-2026-10-16\"}]')", [riderId]);
      const quote = await issue(riderId);
      const results = await Promise.allSettled([
        createTrip(riderId, { pickup, dropoff, quoteId: quote.quoteId, paymentMethod: 'cash' }, randomUUID()),
        inTransaction((client) => switchActiveRole(riderId, 'driver', client)),
      ]);
      assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
      const row = (await db.query('SELECT active_role FROM users WHERE id=$1', [riderId])).rows[0];
      const count = (await db.query('SELECT id FROM trips WHERE rider_id=$1', [riderId])).rowCount;
      assert.equal(count, row.active_role === 'rider' ? 1 : 0);
    });

    await t.test('active rider/driver trips prevent mode changes; revoked drivers retain their trip role', async () => {
      const riderId = await makeRider();
      const driverId = await makeRider();
      for (const id of [riderId, driverId]) await db.query("INSERT INTO driver_profiles(user_id,status,vehicle_category,ride_service_status,accepts_ride,service_consent_history) VALUES($1,'approved','car','approved',true,'[{\"service\":\"ride\",\"action\":\"accepted\",\"version\":\"service-choice-2026-10-16\"}]')", [id]);
      await inTransaction((client) => switchActiveRole(driverId, 'driver', client));
      const quote = await issue(riderId);
      const { trip } = await createTrip(riderId, { pickup, dropoff, quoteId: quote.quoteId, paymentMethod: 'cash' }, randomUUID());
      await assert.rejects(inTransaction((client) => switchActiveRole(riderId, 'driver', client)), /active_trip_prevents_role_switch/);
      await inTransaction((client) => transitionTrip(client, { tripId: trip.id, from: 'searching', to: 'driver_assigned', actorId: driverId, actorType: 'driver', fields: { driver_id: driverId, accepted_at: new Date() } }));
      await assert.rejects(inTransaction((client) => switchActiveRole(driverId, 'rider', client)), /active_trip_prevents_role_switch/);
      await db.query("UPDATE driver_profiles SET status='rejected' WHERE user_id=$1", [driverId]);
      const me = await inTransaction((client) => getMe(driverId, client));
      assert.equal(me.activeRole, 'driver');
      assert.equal(me.driverStatus, 'rejected');
    });

    await t.test('missing jobs recover, racing workers issue one offer, reconnect retrieves it, and expiry releases one hold', async () => {
      const { dispatchNext } = await import('./dispatch.service.js');
      const { getCurrentOffer } = await import('./trips.service.js');
      const { recoverPendingDispatch, stopTripWorkers } = await import('./tripQueue.js');
      stopQueues = stopTripWorkers;
      const riderId = await makeRider();
      const wallet = await fund(riderId);
      const quote = await issue(riderId);
      const { trip } = await createTrip(riderId, { pickup, dropoff, quoteId: quote.quoteId, paymentMethod: 'wallet' }, randomUUID());
      for (let index = 0; index < 2; index += 1) {
        const driverId = await makeRider();
        driverIds.push(driverId);
        await db.query("INSERT INTO driver_profiles(user_id,status,vehicle_category,ride_service_status,accepts_ride,service_consent_history) VALUES($1,'approved','car','approved',true,'[{\"service\":\"ride\",\"action\":\"accepted\",\"version\":\"service-choice-2026-10-16\"}]')", [driverId]);
        await inTransaction((client) => switchActiveRole(driverId, 'driver', client));
        await cache!.multi().geoadd('drivers:locations', pickup.longitude, pickup.latitude, driverId)
          .set(`driver:${driverId}:status`, 'online', 'EX', 30).exec();
        redisKeys.push(`driver:${driverId}:status`, `driver:offer:${driverId}`);
      }
      await recoverPendingDispatch();
      assert.ok(await cache!.exists(`${queuePrefix}:trip-search-expiry:search-${trip.id}`), 'committed booking receives its missing expiry job');
      const results = await Promise.all([dispatchNext(trip.id, 0), dispatchNext(trip.id, 0)]);
      assert.equal(results.filter((result) => result.kind === 'offered').length, 1);
      const offers = (await db.query<{ driver_id: string }>("SELECT driver_id FROM trip_offers WHERE trip_id=$1 AND status='sent'", [trip.id])).rows;
      assert.equal(offers.length, 1);
      const recovered = await getCurrentOffer(offers[0].driver_id);
      assert.equal(recovered?.tripId, trip.id);
      assert.equal(recovered?.fareKobo, quote.fareKobo);
      assert.equal(await getCurrentOffer(riderId), null);
      await recoverPendingDispatch();
      assert.ok(await cache!.exists(`${queuePrefix}:trip-offer-timeout:offer-${trip.id}-${offers[0].driver_id}`), 'committed offer receives its missing timeout');
      await db.query("UPDATE trip_offers SET expires_at=now()-interval '1 second' WHERE trip_id=$1", [trip.id]);
      await recoverPendingDispatch();
      assert.equal(await getCurrentOffer(offers[0].driver_id), null);
      assert.equal(await cache!.get(`driver:offer:${offers[0].driver_id}`), null);
      await db.query("UPDATE trips SET requested_at=now()-interval '1 day' WHERE id=$1", [trip.id]);
      await recoverPendingDispatch();
      await recoverPendingDispatch();
      const expired = (await db.query('SELECT status,payment_status FROM trips WHERE id=$1', [trip.id])).rows[0];
      assert.equal(expired.status, 'no_drivers_found');
      assert.equal(expired.payment_status, 'released');
      assert.equal((await db.query('SELECT balance_kobo FROM ledger_accounts WHERE id=$1', [wallet])).rows[0].balance_kobo, '10000000');
      assert.equal((await db.query("SELECT id FROM ledger_transactions WHERE reference_id=$1 AND type='trip_hold_release'", [trip.id])).rowCount, 1);
    });
  } finally {
    globalThis.fetch = originalFetch;
    await stopQueues?.();
    if (cache) {
      if (driverIds.length) await cache.zrem('drivers:locations', ...driverIds);
      if (redisKeys.length) await cache.del(...redisKeys);
      let cursor = '0';
      do {
        const [next, keys] = await cache.scan(cursor, 'MATCH', `${queuePrefix}:*`, 'COUNT', 1000);
        cursor = next;
        if (keys.length) await cache.del(...keys);
      } while (cursor !== '0');
      cache.disconnect();
    }
    await appPool?.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
});
