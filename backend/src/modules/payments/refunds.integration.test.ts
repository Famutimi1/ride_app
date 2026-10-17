import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import dotenv from 'dotenv';
import { Pool } from 'pg';

dotenv.config();
const databaseUrl = process.env.DATABASE_URL;

test('refund limits and retries remain safe under concurrent requests', { skip: !databaseUrl }, async (t) => {
  const schema = `refunds_test_${process.pid}_${Date.now()}`;
  const admin = new Pool({ connectionString: databaseUrl });
  const scopedUrl = new URL(databaseUrl!);
  scopedUrl.searchParams.set('options', `-c search_path=${schema},public`);
  let appPool: Pool | undefined;
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    process.env.DATABASE_URL = scopedUrl.toString();
    const { db } = await import('../../shared/config/db.js');
    appPool = db;
    for (const file of ['001_auth.sql', '002_trip_system.sql', '003_payments_ledger.sql','015_notifications.sql', '017_email_outbox.sql', '018_email_settings.sql']) {
      await db.query(await readFile(resolve(process.cwd(), 'migrations', file), 'utf8'));
    }
    const { refundTrip } = await import('./admin.service.js');
    const riderId = (await db.query<{ id: string }>("INSERT INTO users(full_name) VALUES('Refund Test') RETURNING id")).rows[0].id;
    const actorId = (await db.query<{ id: string }>("INSERT INTO users(full_name,role) VALUES('Refund Admin','admin') RETURNING id")).rows[0].id;
    await db.query("INSERT INTO driver_profiles(user_id,status) VALUES($1,'approved')",[actorId]);
    const makeTrip = async (settled=true) => {const trip=(await db.query<import("../trips/trip.types").TripRow>(
      `INSERT INTO trips(rider_id,driver_id,payment_method,status,pickup_lat,pickup_lng,pickup_address,
        dropoff_lat,dropoff_lng,dropoff_address,estimated_distance_m,estimated_duration_s,fare_kobo,idempotency_key)
       VALUES($1,$3,'cash','completed',6.45,3.39,'Pickup',6.55,3.49,'Destination',1000,300,500000,$2) RETURNING *`,
      [riderId, randomUUID(),actorId],
    )).rows[0];
      if(settled){const {inTransaction}=await import("../../shared/config/db.js");const {settleTrip}=await import("./tripPayments.service.js");await inTransaction(client=>settleTrip(client,trip,75000,425000));}
      return trip.id;
    };
    const refund = (tripId: string, amountKobo: number, requestKey = randomUUID()) =>
      refundTrip(actorId, { tripId, amountKobo, requestKey, reason: 'Customer refund test' });
    const refundTotal = async (tripId: string) => Number((await db.query<{ total: string }>(
      `SELECT COALESCE(SUM(e.amount_kobo),0)::text total FROM ledger_transactions t
       JOIN ledger_entries e ON e.transaction_id=t.id
       WHERE t.type='refund' AND t.reference_id=$1 AND e.direction='credit'`, [tripId],
    )).rows[0].total);

    await t.test('unpaid or fabricated settled status cannot mint a refund',async()=>{const id=await makeTrip(false);await assert.rejects(refund(id,10000),/trip_settlement_evidence_required/);await db.query("UPDATE trips SET payment_status='settled' WHERE id=$1",[id]);await assert.rejects(refund(id,10000),/trip_settlement_evidence_required/);assert.equal(await refundTotal(id),0);});

    await t.test('partial refunds reach the fare exactly; further refunds fail; exact retries still succeed', async () => {
      const tripId = await makeTrip();
      const key = randomUUID();
      const first = await refund(tripId, 200000, key);
      await refund(tripId, 300000);
      await assert.rejects(refund(tripId, 1), /refund_exceeds_remaining_fare/);
      assert.equal((await refund(tripId, 200000, key)).transactionId, first.transactionId);
      await assert.rejects(refund(tripId, 100000, key), /idempotency_key_reused_with_different_data/);
      assert.equal(await refundTotal(tripId), 500000);
      assert.equal((await db.query('SELECT id FROM admin_audit_log WHERE ledger_transaction_id=$1', [first.transactionId])).rowCount, 1);
      assert.equal((await db.query("SELECT id FROM ledger_transactions WHERE type='refund' AND reference_id=$1", [tripId])).rowCount, 2);
    });

    await t.test('two different refund keys cannot concurrently exceed the remaining fare', async () => {
      const tripId = await makeTrip();
      await refund(tripId, 100000);
      const results = await Promise.allSettled([refund(tripId, 300000), refund(tripId, 300000)]);
      assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
      const rejected = results.find((result) => result.status === 'rejected');
      assert.ok(rejected?.status === 'rejected');
      assert.match(String(rejected.reason), /refund_exceeds_remaining_fare/);
      assert.equal(await refundTotal(tripId), 400000);
      await refund(tripId, 100000);
      assert.equal(await refundTotal(tripId), 500000);
    });

    await t.test('concurrent identical full refunds produce one posting and one audit row', async () => {
      const tripId = await makeTrip();
      const key = randomUUID();
      const results = await Promise.all(Array.from({ length: 5 }, () => refund(tripId, 500000, key)));
      assert.equal(new Set(results.map((result) => result.transactionId)).size, 1);
      assert.equal(await refundTotal(tripId), 500000);
      assert.equal((await db.query('SELECT id FROM admin_audit_log WHERE ledger_transaction_id=$1', [results[0].transactionId])).rowCount, 1);
    });

    await t.test('oversized single refunds create no ledger or audit records', async () => {
      const tripId = await makeTrip();
      await assert.rejects(refund(tripId, 500001), /refund_exceeds_fare/);
      assert.equal(await refundTotal(tripId), 0);
      assert.equal((await db.query("SELECT id FROM ledger_transactions WHERE reference_id=$1 AND type='refund'", [tripId])).rowCount, 0);
    });

    const balances = await db.query<{ balance_kobo: string; total: string }>(
      `SELECT a.balance_kobo, COALESCE(SUM(CASE WHEN e.direction=a.normal_side THEN e.amount_kobo ELSE -e.amount_kobo END),0)::text total
       FROM ledger_accounts a LEFT JOIN ledger_entries e ON e.account_id=a.id GROUP BY a.id`,
    );
    for (const row of balances.rows) assert.equal(row.balance_kobo, row.total);
    assert.equal((await db.query<{ balance_kobo: string }>("SELECT balance_kobo FROM ledger_accounts WHERE owner_user_id=$1 AND kind='user_wallet'", [riderId])).rows[0].balance_kobo, '1500000');
  } finally {
    await appPool?.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
});
