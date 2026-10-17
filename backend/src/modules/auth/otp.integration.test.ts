import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import dotenv from 'dotenv';
import { Pool } from 'pg';
import type { OtpPurpose } from './auth.types';

dotenv.config();
const databaseUrl = process.env.DATABASE_URL;

test('OTP rejection commits attempts and successful use stays atomic', { skip: !databaseUrl }, async (t) => {
  const schema = `otp_test_${process.pid}_${Date.now()}`;
  const admin = new Pool({ connectionString: databaseUrl });
  const scopedUrl = new URL(databaseUrl!);
  scopedUrl.searchParams.set('options', `-c search_path=${schema},public`);
  let appPool: Pool | undefined;
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    process.env.DATABASE_URL = scopedUrl.toString();
    const { db } = await import('../../shared/config/db.js');
    appPool = db;
    for (const file of ['001_auth.sql', '002_trip_system.sql', '003_payments_ledger.sql', '012_auth_session_scope.sql', '014_auth_session_families.sql', '017_email_outbox.sql', '018_email_settings.sql']) {
      await db.query(await readFile(resolve(process.cwd(), 'migrations', file), 'utf8'));
    }
    const { withVerifiedOtp } = await import('./otp.service.js');
    const { verifyLogin, verifyRegistration } = await import('./auth.service.js');
    let sequence = 0;
    const seed = async (purpose: OtpPurpose = 'withdrawal') => {
      const phone = `+234800${String(++sequence).padStart(7, '0')}`;
      const id = (await db.query<{ id: string }>(
        `INSERT INTO otp_codes(phone,purpose,code_hash,expires_at) VALUES($1,$2,$3,now()+interval '5 minutes') RETURNING id`,
        [phone, purpose, createHash('sha256').update('123456').digest('hex')],
      )).rows[0].id;
      return { phone, id, purpose };
    };
    const state = async (id: string) => (await db.query<{ attempts: number; consumed_at: Date | null }>(
      'SELECT attempts,consumed_at FROM otp_codes WHERE id=$1', [id],
    )).rows[0];

    await t.test('failed checks persist for every OTP purpose and stop at the limit', async () => {
      for (const purpose of ['registration', 'login', 'phone_change', 'withdrawal', 'payout_account'] as const) {
        const otp = await seed(purpose);
        let protectedCalls = 0;
        const work = async () => { protectedCalls++; };
        for (let attempt = 1; attempt <= 5; attempt++) {
          await assert.rejects(withVerifiedOtp(otp.phone, purpose, '000000', work), /otp_invalid/);
          assert.equal((await state(otp.id)).attempts, attempt);
        }
        await assert.rejects(withVerifiedOtp(otp.phone, purpose, '123456', work), /otp_attempts_exceeded/);
        assert.deepEqual(await state(otp.id), { attempts: 5, consumed_at: null });
        assert.equal(protectedCalls, 0);
      }
    });

    await t.test('concurrent invalid guesses cannot lose increments or exceed the attempt limit', async () => {
      const otp = await seed();
      const results = await Promise.allSettled(Array.from({ length: 12 }, () =>
        withVerifiedOtp(otp.phone, otp.purpose, '000000', async () => assert.fail('unauthorized action'))));
      assert.equal(results.filter((result) => result.status === 'rejected' && String(result.reason).includes('otp_invalid')).length, 5);
      assert.equal(results.filter((result) => result.status === 'rejected' && String(result.reason).includes('otp_attempts_exceeded')).length, 7);
      assert.deepEqual(await state(otp.id), { attempts: 5, consumed_at: null });
    });

    await t.test('concurrent valid uses authorize exactly one action and cannot revive older codes', async () => {
      const otp = await seed();
      await db.query(`INSERT INTO otp_codes(phone,purpose,code_hash,expires_at,created_at)
        VALUES($1,$2,$3,now()+interval '5 minutes',now()-interval '1 minute')`,
      [otp.phone, otp.purpose, createHash('sha256').update('654321').digest('hex')]);
      const results = await Promise.allSettled(Array.from({ length: 6 }, () =>
        withVerifiedOtp(otp.phone, otp.purpose, '123456', async (client) => {
          await client.query("INSERT INTO users(full_name) VALUES('Authorized once')");
        })));
      assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
      assert.equal((await db.query("SELECT id FROM users WHERE full_name='Authorized once'")).rowCount, 1);
      assert.ok((await state(otp.id)).consumed_at);
      await assert.rejects(withVerifiedOtp(otp.phone, otp.purpose, '654321', async () => undefined), /otp_not_found/);
    });

    await t.test('business failures roll back protected writes and consumption, allowing a safe retry', async () => {
      const otp = await seed();
      await assert.rejects(withVerifiedOtp(otp.phone, otp.purpose, '123456', async (client) => {
        await client.query("INSERT INTO users(full_name) VALUES('Must roll back')");
        throw new Error('business_operation_failed');
      }), /business_operation_failed/);
      assert.deepEqual(await state(otp.id), { attempts: 0, consumed_at: null });
      assert.equal((await db.query("SELECT id FROM users WHERE full_name='Must roll back'")).rowCount, 0);
      assert.equal(await withVerifiedOtp(otp.phone, otp.purpose, '123456', async () => 'success'), 'success');
      assert.ok((await state(otp.id)).consumed_at);
    });

    await t.test('expired, missing, and wrong-purpose codes never authorize the action', async () => {
      const otp = await seed();
      const work = async () => assert.fail('unauthorized action');
      await db.query("UPDATE otp_codes SET expires_at=now()-interval '1 minute' WHERE id=$1", [otp.id]);
      await assert.rejects(withVerifiedOtp(otp.phone, otp.purpose, '123456', work), /otp_expired/);
      assert.deepEqual(await state(otp.id), { attempts: 1, consumed_at: null });
      await assert.rejects(withVerifiedOtp(otp.phone, 'login', '123456', work), /otp_not_found/);
      await assert.rejects(withVerifiedOtp('+2348009999999', 'login', '123456', work), /otp_not_found/);
    });

    await t.test('login and registration services preserve failed attempts without creating sessions or users', async () => {
      const login = await seed('login');
      const registration = await seed('registration');
      await assert.rejects(verifyLogin(login.phone, '000000', undefined), /otp_invalid/);
      await assert.rejects(verifyRegistration({ phone: registration.phone, code: '000000', fullName: 'New User' }, undefined), /otp_invalid/);
      assert.equal((await state(login.id)).attempts, 1);
      assert.equal((await state(registration.id)).attempts, 1);
      assert.equal((await db.query('SELECT id FROM users WHERE phone=ANY($1::text[])', [[login.phone, registration.phone]])).rowCount, 0);
      assert.equal((await db.query('SELECT id FROM refresh_tokens')).rowCount, 0);
      const session = await verifyRegistration({ phone: registration.phone, code: '123456', fullName: 'New User' }, undefined);
      assert.ok(session.tokens.accessToken);
      assert.equal((await db.query('SELECT id FROM users WHERE phone=$1', [registration.phone])).rowCount, 1);
      assert.equal((await db.query('SELECT id FROM refresh_tokens')).rowCount, 1);
      assert.ok((await state(registration.id)).consumed_at);
    });
    await t.test('staff phone login has a separate session scope and ordinary accounts cannot request it', async () => {
      const { verifyAccessToken } = await import('./jwt.service.js');
      for (const scope of ['app', 'staff'] as const) {
        const otp = await seed('login');
        await db.query("INSERT INTO users(full_name,phone,role) VALUES('Staff phone test',$1,'admin')", [otp.phone]);
        const session = await verifyLogin(otp.phone, '123456', undefined, scope);
        assert.equal(verifyAccessToken(session.tokens.accessToken).sessionScope, scope);
        assert.equal(session.user.platformRole, scope === 'staff' ? 'admin' : 'user');
      }
      const otp = await seed('login');
      await db.query("INSERT INTO users(full_name,phone) VALUES('Customer phone test',$1)", [otp.phone]);
      const sessionsBefore = (await db.query('SELECT count(*)::int AS n FROM refresh_tokens')).rows[0].n;
      await assert.rejects(verifyLogin(otp.phone, '123456', undefined, 'staff'), { code: 'staff_account_required' });
      assert.equal((await db.query('SELECT count(*)::int AS n FROM refresh_tokens')).rows[0].n, sessionsBefore);
      assert.equal((await state(otp.id)).consumed_at, null);
    });
  } finally {
    await appPool?.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
});
