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
  let appRedis: { disconnect(): void } | undefined;
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    process.env.DATABASE_URL = scopedUrl.toString();
    const { db } = await import('../../shared/config/db.js');
    appPool = db;
    for (const file of ['001_auth.sql', '002_trip_system.sql', '003_payments_ledger.sql', '012_auth_session_scope.sql', '014_auth_session_families.sql', '017_email_outbox.sql', '018_email_settings.sql']) {
      await db.query(await readFile(resolve(process.cwd(), 'migrations', file), 'utf8'));
    }
    const { withVerifiedOtp, generateOtp } = await import('./otp.service.js');
    const { verifyLogin, verifyRegistration, initiateLogin, initiateRegistration } = await import('./auth.service.js');
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

    await t.test('shared internal-test OTP keeps challenge and account permissions in production mode', async (t) => {
      const { env } = await import('../../config/env.js');
      const { inTransaction } = await import('../../shared/config/db.js');
      const { ensureRedis } = await import('../../shared/config/redis.js');
      const { verifyAccessToken } = await import('./jwt.service.js');
      appRedis = await ensureRedis();
      const original = { NODE_ENV: env.NODE_ENV, TEST_OTP_ENABLED: env.TEST_OTP_ENABLED, TEST_OTP_CODE: env.TEST_OTP_CODE, TERMII_API_KEY: env.TERMII_API_KEY };
      Object.assign(env, { NODE_ENV: 'production', TEST_OTP_ENABLED: true, TEST_OTP_CODE: '666666', TERMII_API_KEY: '' });
      const logs: string[] = [];
      t.mock.method(console, 'info', (message: string) => { logs.push(message); });
      const network = t.mock.method(globalThis, 'fetch', async () => { throw new Error('SMS must not be called for test login'); });
      const work = async () => 'authorized';
      try {
        await t.test('registration needs no SMS, preserves the random code and enforces resend cooldown', async () => {
          const phone = '+2348100000001';
          await inTransaction(client => initiateRegistration('Beta rider', phone, 'rider', client));
          const code = logs.at(-1)?.match(/: (\d{6})$/)?.[1];
          assert.ok(code);
          const row = (await db.query<{ code_hash: string }>('SELECT code_hash FROM otp_codes WHERE phone=$1', [phone])).rows[0];
          assert.equal(row.code_hash, createHash('sha256').update(code).digest('hex'));
          await assert.rejects(inTransaction(client => initiateRegistration('Beta rider', phone, 'rider', client)), { code: 'otp_cooldown' });
          const session = await verifyRegistration({ phone, code: '666666', fullName: 'Beta rider' }, undefined);
          assert.equal(verifyAccessToken(session.tokens.accessToken).sessionScope, 'app');
          assert.equal(session.user.platformRole, 'user');
          await assert.rejects(inTransaction(client => initiateRegistration('Beta rider', phone, 'rider', client)), { code: 'phone_already_registered' });
          await assert.rejects(verifyLogin(phone, '666666', undefined), { code: 'otp_not_found' });
          // A fresh login request generates a different purpose-specific challenge.
          const redis = await ensureRedis();
          await redis.del(`otp:cooldown:${phone}`);
          await inTransaction(client => initiateLogin(phone, client));
          const randomCode = logs.at(-1)?.match(/: (\d{6})$/)?.[1];
          assert.ok(randomCode);
          assert.ok((await verifyLogin(phone, randomCode, undefined)).tokens.accessToken);
          assert.equal(network.mock.callCount(), 0);
        });

        await t.test('admin and super-admin logins retain staff scope without granting it to customers', async () => {
          for (const role of ['admin', 'super_admin', 'user'] as const) {
            const otp = await seed('login');
            await db.query('INSERT INTO users(full_name,phone,role) VALUES($1,$2,$3)', ['Beta account', otp.phone, role]);
            if (role === 'user') {
              await assert.rejects(verifyLogin(otp.phone, '666666', undefined, 'staff'), { code: 'staff_account_required' });
              assert.equal((await state(otp.id)).consumed_at, null);
              assert.ok((await verifyLogin(otp.phone, '666666', undefined)).tokens.accessToken);
            } else {
              const session = await verifyLogin(otp.phone, '666666', undefined, 'staff');
              assert.equal(verifyAccessToken(session.tokens.accessToken).sessionScope, 'staff');
              assert.equal(session.user.platformRole, role);
              await assert.rejects(verifyLogin(otp.phone, '123456', undefined, 'staff'), { code: 'otp_not_found' });
            }
          }
        });

        await t.test('unregistered, inactive and malformed numbers still cannot log in', async () => {
          const otp = await seed('login');
          await assert.rejects(inTransaction(client => initiateLogin(otp.phone, client)), { code: 'account_not_found' });
          await assert.rejects(verifyLogin(otp.phone, '666666', undefined), { code: 'account_not_found' });
          await db.query("INSERT INTO users(full_name,phone,is_active) VALUES('Inactive beta',$1,false)", [otp.phone]);
          await assert.rejects(verifyLogin(otp.phone, '666666', undefined), { code: 'account_not_found' });
          await assert.rejects(verifyLogin('invalid', '666666', undefined));
          assert.equal((await state(otp.id)).consumed_at, null);
        });

        await t.test('missing, expired, exhausted and consumed requests still reject the shared code', async () => {
          await assert.rejects(withVerifiedOtp('+2348100000099', 'login', '666666', work), { code: 'otp_not_found' });
          const expired = await seed('login');
          await db.query("UPDATE otp_codes SET expires_at=now()-interval '1 minute' WHERE id=$1", [expired.id]);
          await assert.rejects(withVerifiedOtp(expired.phone, 'login', '666666', work), { code: 'otp_expired' });
          const exhausted = await seed('login');
          for (let i = 0; i < 5; i++) await assert.rejects(withVerifiedOtp(exhausted.phone, 'login', '000000', work), { code: 'otp_invalid' });
          await assert.rejects(withVerifiedOtp(exhausted.phone, 'login', '666666', work), { code: 'otp_attempts_exceeded' });
          const otp = await seed('login');
          const results = await Promise.allSettled(Array.from({ length: 6 }, () => withVerifiedOtp(otp.phone, 'login', '666666', work)));
          assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
          await assert.rejects(withVerifiedOtp(otp.phone, 'login', '666666', work), { code: 'otp_not_found' });
        });

        await t.test('step-up purposes require their generated OTP and still require the SMS provider', async () => {
          for (const purpose of ['withdrawal', 'payout_account', 'phone_change'] as const) {
            const otp = await seed(purpose);
            await assert.rejects(withVerifiedOtp(otp.phone, purpose, '666666', work), { code: 'otp_invalid' });
            assert.equal(await withVerifiedOtp(otp.phone, purpose, '123456', work), 'authorized');
            await assert.rejects(inTransaction(client => generateOtp(otp.phone, purpose, client)), { code: 'otp_provider_not_configured' });
          }
          assert.equal(network.mock.callCount(), 0);
        });

        await t.test('disabling the setting rejects the shared code for outstanding requests and restores SMS delivery', async () => {
          const otp = await seed('login');
          Object.assign(env, { TEST_OTP_ENABLED: false });
          await assert.rejects(withVerifiedOtp(otp.phone, 'login', '666666', work), { code: 'otp_invalid' });
          assert.equal(await withVerifiedOtp(otp.phone, 'login', '123456', work), 'authorized');
          await assert.rejects(inTransaction(client => generateOtp('+2348100000002', 'login', client)), { code: 'otp_provider_not_configured' });
        });
      } finally {
        Object.assign(env, original);
      }
    });
  } finally {
    appRedis?.disconnect();
    await appPool?.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
});
