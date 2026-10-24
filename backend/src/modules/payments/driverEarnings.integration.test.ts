import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { Pool } from 'pg';
import type { TripRow } from '../trips/trip.types';

test('trip earnings separate cash income, wallet income and repayable commission', { skip: process.env.RAKKY_TEST_ISOLATED !== 'true' }, async t => {
  const schema = `driver_earnings_${process.pid}_${Date.now()}`;
  const originalUrl = process.env.DATABASE_URL!;
  const admin = new Pool({ connectionString: originalUrl });
  let appPool: Pool | undefined;
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    const scoped = new URL(originalUrl);
    scoped.searchParams.set('options', `-c search_path=${schema},public`);
    process.env.DATABASE_URL = scoped.toString();
    const { db, inTransaction } = await import('../../shared/config/db.js');
    appPool = db;
    for (const file of (await readdir('migrations')).filter(name => /^\d+_.*\.sql$/.test(name)).sort()) {
      await db.query(await readFile(resolve('migrations', file), 'utf8'));
    }
    const { driverEarningsSummary } = await import('./wallet.service.js');
    const { getBalances, getSystemAccountId, postTransaction } = await import('./ledger.service.js');
    const { settleTrip } = await import('./tripPayments.service.js');
    const rider = (await db.query<{ id: string }>("INSERT INTO users(full_name) VALUES('Earnings rider') RETURNING id")).rows[0].id;
    const makeDriver = async () => {
      const id = (await db.query<{ id: string }>("INSERT INTO users(full_name) VALUES('Earnings driver') RETURNING id")).rows[0].id;
      await db.query("INSERT INTO driver_profiles(user_id,status) VALUES($1,'approved')", [id]);
      return id;
    };
    const makeTrip = async (driver: string, method: 'cash' | 'wallet', fare: number, commission: number, options: { returned?: boolean; old?: boolean; settle?: boolean } = {}) => {
      const courier = Boolean(options.returned);
      const row = (await db.query<TripRow>(`INSERT INTO trips
        (rider_id,driver_id,status,service_type,courier_details,vehicle_type,payment_method,payment_status,
         pickup_lat,pickup_lng,pickup_address,dropoff_lat,dropoff_lng,dropoff_address,
         estimated_distance_m,estimated_duration_s,fare_kobo,commission_kobo,driver_earning_kobo,
         idempotency_key,completed_at,returned_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,6.4,3.4,'Pickup',6.5,3.5,'Destination',1000,300,$9,$10,$11,$12,
         CASE WHEN $13::boolean THEN NULL WHEN $14::boolean THEN now()-interval '40 days' ELSE now() END,
         CASE WHEN $13::boolean THEN now() ELSE NULL END) RETURNING *`,
        [rider, driver, courier ? 'returned' : 'completed', courier ? 'courier' : 'ride', courier ? { description: 'Parcel' } : null,
          courier ? 'courier' : 'economy', method, method === 'wallet' ? 'held' : 'unpaid', fare, commission, fare - commission, randomUUID(), courier, Boolean(options.old)])).rows[0];
      if (options.settle !== false) await inTransaction(async client => {
        if (method === 'wallet') await postTransaction(client, {
          type: 'adjustment', idempotencyKey: `fixture:${row.id}:escrow`, entries: [
            { accountId: await getSystemAccountId(client, 'expense_adjustments'), direction: 'debit', amountKobo: fare },
            { accountId: await getSystemAccountId(client, 'escrow_trips'), direction: 'credit', amountKobo: fare },
          ],
        });
        await settleTrip(client, row, commission, fare - commission);
      });
      return row;
    };

    await t.test('cash-only earnings remain positive while commission remains owed', async () => {
      const driver = await makeDriver();
      await makeTrip(driver, 'cash', 1634700, 245205);
      const balanceBefore = await getBalances(driver);
      const entriesBefore = (await db.query('SELECT id FROM ledger_entries')).rowCount;
      const summary = await driverEarningsSummary(driver, 'today');
      assert.equal(summary.netKobo, 1389495);
      assert.equal(summary.cashEarningsKobo, 1389495);
      assert.equal(summary.cashCollectedKobo, 1634700);
      assert.equal(summary.cashCommissionKobo, 245205);
      assert.equal(summary.walletEarningsKobo, 0);
      assert.equal(balanceBefore.owedKobo, 245205);
      assert.equal(balanceBefore.withdrawableKobo, 0);
      assert.deepEqual(await getBalances(driver), balanceBefore, 'summary never changes the ledger or debt');
      assert.equal((await db.query('SELECT id FROM ledger_entries')).rowCount, entriesBefore);
    });
    await t.test('mixed payments distinguish total earned from available wallet balance', async () => {
      const driver = await makeDriver();
      await makeTrip(driver, 'cash', 1634700, 245205);
      await makeTrip(driver, 'wallet', 1000000, 150000);
      const summary = await driverEarningsSummary(driver, 'today');
      assert.equal(summary.netKobo, 2239495);
      assert.equal(summary.grossKobo - summary.commissionKobo, summary.netKobo);
      assert.equal(summary.cashEarningsKobo + summary.walletEarningsKobo, summary.netKobo);
      assert.equal(summary.walletEarningsKobo, 850000);
      assert.equal(summary.cashTrips, 1); assert.equal(summary.walletTrips, 1);
      assert.equal((await getBalances(driver)).withdrawableKobo, 604795);
      assert.equal((await getBalances(driver)).owedKobo, 0);
    });
    await t.test('wallet-only returned couriers count once at return time', async () => {
      const driver = await makeDriver();
      await makeTrip(driver, 'wallet', 200000, 30000, { returned: true });
      const summary = await driverEarningsSummary(driver, 'today');
      assert.equal(summary.netKobo, 170000); assert.equal(summary.walletEarningsKobo, 170000);
      assert.equal(summary.cashCollectedKobo, 0); assert.equal(summary.cashCommissionKobo, 0);
      assert.equal(summary.trips, 1);
    });
    await t.test('zero commission, no jobs, period and unsettled filters are respected', async () => {
      const driver = await makeDriver();
      assert.equal((await driverEarningsSummary(driver, 'today')).netKobo, 0);
      await makeTrip(driver, 'cash', 100000, 0);
      await makeTrip(driver, 'cash', 200000, 30000, { old: true });
      await makeTrip(driver, 'wallet', 400000, 60000, { settle: false });
      const summary = await driverEarningsSummary(driver, 'today');
      assert.equal(summary.trips, 1); assert.equal(summary.netKobo, 100000);
      assert.equal(summary.cashCommissionKobo, 0);
      assert.equal((await driverEarningsSummary(driver, 'week')).netKobo, 100000);
      assert.equal((await driverEarningsSummary(driver, 'month')).netKobo, 100000);
      assert.equal((await driverEarningsSummary(driver, "today'); DROP TABLE trips;--")).range, 'today');
    });
  } finally {
    process.env.DATABASE_URL = originalUrl;
    await appPool?.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
});
