import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import dotenv from 'dotenv';
import { Pool, type PoolClient } from 'pg';
import { transitionTrip } from './tripStateMachine';
import { holdTripFare, releaseTripHold, settleTrip } from '../payments/tripPayments.service';
import { getOrCreateWalletAccount, getSystemAccountId, postTransaction } from '../payments/ledger.service';
import type { TripRow } from './trip.types';

dotenv.config();
const databaseUrl = process.env.DATABASE_URL;
const schema = `trip_test_${process.pid}_${Date.now()}`;

async function setup() {
  if (!databaseUrl) return null;
  const admin = new Pool({ connectionString: databaseUrl });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema},public` });
  for (const file of ['001_auth.sql', '002_trip_system.sql', '003_payments_ledger.sql', '004_scheduled_trips.sql', '005_courier_trips.sql', '006_courier_returns.sql', '007_courier_return_columns.sql', '008_driver_courier_preference.sql', '009_courier_code_rotation.sql', '015_notifications.sql', '017_email_outbox.sql', '018_email_settings.sql', '016_driver_service_eligibility.sql']) {
    await pool.query(await readFile(resolve(process.cwd(), 'migrations', file), 'utf8'));
  }
  return { admin, pool };
}

async function seedUsers(client: PoolClient) {
  const rider = (await client.query<{ id: string }>("INSERT INTO users(full_name,phone) VALUES('Test Rider','+2348000000001') RETURNING id")).rows[0].id;
  const drivers = (await client.query<{ id: string }>("INSERT INTO users(full_name,phone) VALUES('Driver One','+2348000000002'),('Driver Two','+2348000000003') RETURNING id")).rows.map((row) => row.id);
  for (const driver of drivers) await client.query("INSERT INTO driver_profiles(user_id,status) VALUES($1,'approved')", [driver]);
  return { rider, drivers };
}

test('Postgres trip guards resolve races and keep settlement idempotent', { skip: !databaseUrl }, async () => {
  const resources = await setup();
  assert.ok(resources);
  const { admin, pool } = resources;
  try {
    const seed = await pool.connect();
    const { rider, drivers } = await seedUsers(seed);
    assert.equal((await seed.query('SELECT accepts_courier FROM driver_profiles WHERE user_id=$1', [drivers[0]])).rows[0].accepts_courier, false);
    await seed.query("UPDATE driver_profiles SET courier_service_status='approved',accepts_courier=true WHERE user_id=$1", [drivers[0]]);
    assert.equal((await seed.query('SELECT accepts_courier FROM driver_profiles WHERE user_id=$1', [drivers[0]])).rows[0].accepts_courier, true);
    const trip = (await seed.query<TripRow>(
      `INSERT INTO trips(rider_id,payment_method,pickup_lat,pickup_lng,pickup_address,dropoff_lat,dropoff_lng,dropoff_address,estimated_distance_m,estimated_duration_s,fare_kobo,idempotency_key)
       VALUES($1,'cash',6.45,3.39,'Pickup',6.55,3.49,'Destination',12000,1800,500000,'race-test') RETURNING *`, [rider],
    )).rows[0];
    for (const driver of drivers) await seed.query("INSERT INTO trip_offers(trip_id,driver_id,expires_at) VALUES($1,$2,now()+interval '1 minute')", [trip.id, driver]);
    seed.release();

    const accept = async (driverId: string) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const locked = (await client.query<TripRow>('SELECT * FROM trips WHERE id=$1 FOR UPDATE', [trip.id])).rows[0];
        if (locked.status !== 'searching') throw new Error('trip_no_longer_available');
        await client.query("UPDATE trip_offers SET status='accepted' WHERE trip_id=$1 AND driver_id=$2 AND status='sent'", [trip.id, driverId]);
        await transitionTrip(client, { tripId: trip.id, from: 'searching', to: 'driver_assigned', actorId: driverId, actorType: 'driver', fields: { driver_id: driverId, accepted_at: new Date() } });
        await client.query('COMMIT');
        return driverId;
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    };
    const accepted = await Promise.allSettled(drivers.map(accept));
    assert.equal(accepted.filter((result) => result.status === 'fulfilled').length, 1, 'exactly one driver accepts');
    assert.equal(accepted.filter((result) => result.status === 'rejected').length, 1, 'the racing driver loses cleanly');

    const winner = (accepted.find((result): result is PromiseFulfilledResult<string> => result.status === 'fulfilled'))!.value;
    const stateClient = await pool.connect();
    await transitionTrip(stateClient, { tripId: trip.id, from: 'driver_assigned', to: 'driver_arrived', actorId: winner, actorType: 'driver', fields: { arrived_at: new Date() } });
    await transitionTrip(stateClient, { tripId: trip.id, from: 'driver_arrived', to: 'in_progress', actorId: winner, actorType: 'driver', fields: { started_at: new Date() } });
    stateClient.release();

    const complete = async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const locked = (await client.query<TripRow>('SELECT * FROM trips WHERE id=$1 FOR UPDATE', [trip.id])).rows[0];
        if (locked.status !== 'in_progress') throw new Error('trip_not_in_progress');
        await transitionTrip(client, { tripId: trip.id, from: 'in_progress', to: 'completed', actorId: winner, actorType: 'driver', fields: { completed_at: new Date(), commission_kobo: '75000', driver_earning_kobo: '425000' } });
        await settleTrip(client, locked, 75000, 425000);
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    };
    const completed = await Promise.allSettled([complete(), complete()]);
    assert.equal(completed.filter((result) => result.status === 'fulfilled').length, 1, 'completion is single-winner');
    assert.equal(Number((await pool.query("SELECT COUNT(*) AS count FROM ledger_transactions WHERE reference_id=$1 AND type='trip_commission_cash'", [trip.id])).rows[0].count), 1, 'settlement is not duplicated');
    const walletClient = await pool.connect();
    try {
      await walletClient.query('BEGIN');
      const wallet = await getOrCreateWalletAccount(walletClient, rider);
      const expense = await getSystemAccountId(walletClient, 'expense_adjustments');
      await postTransaction(walletClient, { type: 'adjustment', idempotencyKey: 'wallet-trip-test-funds', entries: [
        {accountId: expense, direction: 'debit', amountKobo: 100000},
        {accountId: wallet, direction: 'credit', amountKobo: 100000},
      ] });
      await walletClient.query('COMMIT');
      const makeWalletTrip = async (key:string) => (await pool.query<TripRow>(
        `INSERT INTO trips(rider_id,driver_id,payment_method,pickup_lat,pickup_lng,pickup_address,dropoff_lat,dropoff_lng,dropoff_address,estimated_distance_m,estimated_duration_s,fare_kobo,idempotency_key)
         VALUES($1,$2,'wallet',6.45,3.39,'Pickup',6.55,3.49,'Destination',12000,1800,50000,$3) RETURNING *`, [rider,winner,key],
      )).rows[0];
      const completedWalletTrip = await makeWalletTrip('wallet-complete');
      await walletClient.query('BEGIN');
      await holdTripFare(walletClient, completedWalletTrip);
      await walletClient.query('COMMIT');
      assert.equal((await pool.query('SELECT payment_status FROM trips WHERE id=$1',[completedWalletTrip.id])).rows[0].payment_status,'held');
      await walletClient.query('BEGIN');
      await settleTrip(walletClient,{...completedWalletTrip,payment_status:'held'},7500,42500);
      await walletClient.query('COMMIT');
      await pool.query("UPDATE trips SET status='completed',completed_at=now() WHERE id=$1",[completedWalletTrip.id]);
      const cancelledWalletTrip = await makeWalletTrip('wallet-cancel');
      await walletClient.query('BEGIN');
      await holdTripFare(walletClient,cancelledWalletTrip);
      await walletClient.query('COMMIT');
      await walletClient.query('BEGIN');
      await releaseTripHold(walletClient,{...cancelledWalletTrip,payment_status:'held'});
      await walletClient.query('COMMIT');
      await transitionTrip(walletClient, { tripId: cancelledWalletTrip.id, from: 'searching', to: 'cancelled', actorType: 'rider', actorId: rider, fields: { cancelled_at: new Date(), cancelled_by: 'rider', cancel_reason: 'Test cancellation' } });
      assert.equal((await pool.query('SELECT payment_status FROM trips WHERE id=$1',[cancelledWalletTrip.id])).rows[0].payment_status,'released');
      assert.equal(Number((await pool.query('SELECT balance_kobo FROM ledger_accounts WHERE id=$1',[wallet])).rows[0].balance_kobo),50000);
      assert.equal(Number((await pool.query("SELECT balance_kobo FROM ledger_accounts WHERE code='escrow_trips'")).rows[0].balance_kobo),0);
    } finally {walletClient.release();}
    await assert.rejects(pool.query("UPDATE ledger_entries SET amount_kobo=1 WHERE transaction_id IN (SELECT id FROM ledger_transactions WHERE reference_id=$1)", [trip.id]), /append-only/);
    await assert.rejects(pool.query("UPDATE trip_status_history SET metadata='{}' WHERE trip_id=$1", [trip.id]), /append-only/);
    const scheduled = (await pool.query<TripRow>(
      `INSERT INTO trips(rider_id,payment_method,pickup_lat,pickup_lng,pickup_address,dropoff_lat,dropoff_lng,dropoff_address,estimated_distance_m,estimated_duration_s,fare_kobo,idempotency_key,status,scheduled_at)
       VALUES($1,'cash',6.45,3.39,'Pickup',6.55,3.49,'Destination',12000,1800,500000,'scheduled-test','scheduled',now()+interval '1 hour') RETURNING *`, [rider],
    )).rows[0];
    assert.equal(scheduled.status, 'scheduled');
    const activationClient = await pool.connect();
    try {
      const activated = await transitionTrip(activationClient, { tripId: scheduled.id, from: 'scheduled', to: 'searching', actorType: 'system', fields: { requested_at: new Date() } });
      assert.equal(activated.status, 'searching');
      await transitionTrip(activationClient, { tripId: scheduled.id, from: 'searching', to: 'cancelled', actorType: 'rider', actorId: rider, fields: { cancelled_at: new Date(), cancelled_by: 'rider', cancel_reason: 'Test cancellation' } });
      assert.equal((await pool.query('SELECT status FROM trips WHERE id=$1', [scheduled.id])).rows[0].status, 'cancelled');
    } finally { activationClient.release(); }
    const courierDetails = JSON.stringify({ description: 'Books', weightKg: 1, recipientName: 'Recipient', recipientPhone: '+2348012345678', pickupInstructions: null, dropoffInstructions: null });
    await assert.rejects(pool.query(
      `INSERT INTO trips(rider_id,payment_method,pickup_lat,pickup_lng,pickup_address,dropoff_lat,dropoff_lng,dropoff_address,estimated_distance_m,estimated_duration_s,fare_kobo,idempotency_key,service_type,courier_details,vehicle_type)
       VALUES($1,'cash',6.45,3.39,'Pickup',6.55,3.49,'Destination',12000,1800,500000,'courier-cash-test','courier',$2,'courier')`, [rider, courierDetails],
    ), /courier_details_required/);
    const courier = (await pool.query<TripRow>(
      `INSERT INTO trips(rider_id,payment_method,pickup_lat,pickup_lng,pickup_address,dropoff_lat,dropoff_lng,dropoff_address,estimated_distance_m,estimated_duration_s,fare_kobo,idempotency_key,service_type,courier_details,vehicle_type)
       VALUES($1,'wallet',6.45,3.39,'Pickup',6.55,3.49,'Destination',12000,1800,500000,'courier-test','courier',$2,'courier') RETURNING *`, [rider, courierDetails],
    )).rows[0];
    assert.equal(courier.service_type, 'courier');
    assert.equal(courier.courier_details?.recipientName, 'Recipient');
    const returnClient = await pool.connect();
    try {
      await transitionTrip(returnClient, { tripId: courier.id, from: 'searching', to: 'driver_assigned', actorType: 'driver', actorId: drivers[0], fields: { driver_id: drivers[0], accepted_at: new Date() } });
      await transitionTrip(returnClient, { tripId: courier.id, from: 'driver_assigned', to: 'driver_arrived', actorType: 'driver', actorId: drivers[0], fields: { arrived_at: new Date() } });
      await transitionTrip(returnClient, { tripId: courier.id, from: 'driver_arrived', to: 'in_progress', actorType: 'driver', actorId: drivers[0], fields: { started_at: new Date() } });
      await transitionTrip(returnClient, { tripId: courier.id, from: 'in_progress', to: 'returning', actorType: 'driver', actorId: drivers[0], fields: { delivery_issue_reason: 'Recipient unavailable' } });
      const returned = await transitionTrip(returnClient, { tripId: courier.id, from: 'returning', to: 'returned', actorType: 'driver', actorId: drivers[0], fields: { returned_at: new Date(), delivery_verified_at: new Date() } });
      assert.equal(returned.status, 'returned');
    } finally { returnClient.release(); }
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});
