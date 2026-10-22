import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import dotenv from 'dotenv';
import { Pool } from 'pg';
import { OAuth2Client, LoginTicket } from 'google-auth-library';

dotenv.config();
test('account edits persist and phone ownership cannot be transferred with another user challenge', { skip: !process.env.DATABASE_URL }, async (t) => {
  const owner = new Pool({ connectionString: process.env.DATABASE_URL });
  const schema = `account_test_${process.pid}_${Date.now()}`;
  const url = new URL(process.env.DATABASE_URL!);
  url.searchParams.set('options', `-c search_path=${schema},public`);
  await owner.query(`CREATE SCHEMA ${schema}`);
  process.env.DATABASE_URL = url.toString();
  process.env.GOOGLE_CLIENT_ID_WEB = 'account-test.apps.googleusercontent.com';
  const { db, inTransaction } = await import('../../shared/config/db.js');
  const { ensureRedis, redis } = await import('../../shared/config/redis.js');
  const phones: string[] = [];
  const phone = () => { const value = `+23480${String(randomInt(10000000, 99999999))}`; phones.push(value); return value; };
  try {
    for (const file of (await readdir(resolve('migrations'))).filter((name) => /^\d+_.*\.sql$/.test(name)).sort()) await db.query(await readFile(resolve('migrations', file), 'utf8'));
    const auth = await import('./auth.service.js');
    const jwt = await import('./jwt.service.js');
    const { TermiiOtpProvider } = await import('./otp.provider.termii.js');
    const codes = new Map<string, string>();
    t.mock.method(TermiiOtpProvider.prototype, 'send', async (number: string, code: string) => { codes.set(number, code); });
    const users = (await db.query<{ id: string }>("INSERT INTO users(full_name,phone,email) VALUES('First',$1,'first@example.test'),('Second',$2,'second@example.test') RETURNING id", [phone(), phone()])).rows;
    const first = users[0].id;
    const second = users[1].id;
    await t.test('profile updates are persisted and protected fields cannot be patched', async () => {
      const saved = await inTransaction((client) => auth.updateProfile(first, { name: '  Updated name  ', email: ' CONTACT@example.test ' }, client));
      assert.equal(saved.user.name, 'Updated name');
      assert.equal(saved.user.email, 'contact@example.test');
      assert.equal((await inTransaction((client) => auth.getMe(first, client))).user.name, 'Updated name');
      for (const input of [null, [], { name: '' }, { email: 'invalid' }, { phone: phone() }, { role: 'super_admin' }, { is_active: false }]) {
        await assert.rejects(inTransaction((client) => auth.updateProfile(first, input, client)));
      }
      await assert.rejects(inTransaction((client) => auth.updateProfile(first, { email: 'second@example.test' }, client)), { code: 'email_already_registered' });
      assert.equal((await inTransaction((client) => auth.getMe(first, client))).user.email, 'contact@example.test');
    });
    await t.test('email contact cannot link a Google identity and inactive linked accounts cannot sign in', async () => {
      let profile = { iss: 'https://accounts.google.com', aud: process.env.GOOGLE_CLIENT_ID_WEB!, sub: 'attacker-google-sub', name: 'Test', email: 'contact@example.test', email_verified: true, iat: 1, exp: 9999999999 };
      t.mock.method(OAuth2Client.prototype, 'verifyIdToken', async () => new LoginTicket('', profile));
      await assert.rejects(inTransaction((client) => auth.googleSignIn('test-credential', undefined, client)), { code: 'google_account_link_required' });
      await db.query('UPDATE users SET google_id=$2,is_active=false WHERE id=$1', [second, 'inactive-sub']);
      profile = { ...profile, sub: 'inactive-sub', email: 'second@example.test' };
      await assert.rejects(inTransaction((client) => auth.googleSignIn('test-credential', undefined, client)), { code: 'account_inactive' });
      profile = { ...profile, email_verified: false };
      await assert.rejects(inTransaction((client) => auth.googleSignIn('test-credential', undefined, client)), { code: 'invalid_google_token' });
      await db.query('UPDATE users SET is_active=true WHERE id=$1', [second]);
    });
    await t.test('staff can complete driver personal details with the same account without changing staff sign-in identity', async () => {
      const driver = await import('../driver/driver.service.js');
      for (const role of ['admin', 'super_admin']) {
        const email = `${role}@example.test`;
        const id = (await db.query('INSERT INTO users(full_name,phone,email,role) VALUES($1,$2,$3,$4) RETURNING id', ['Combined account', phone(), email, role])).rows[0].id as string;
        await inTransaction(client => driver.savePersonalInfo(id, { fullName: 'Driver name', email, address: '12 Test Street, Lagos' }, client));
        const saved = await inTransaction(client => auth.updateProfile(id, { name: 'Updated driver name', email }, client));
        assert.equal(saved.user.name, 'Updated driver name'); assert.equal(saved.user.email, email);
        assert.equal((await db.query('SELECT role FROM users WHERE id=$1', [id])).rows[0].role, role);
        await assert.rejects(inTransaction(client => driver.savePersonalInfo(id, { fullName: 'Test', email: 'changed@example.test', address: '12 Test Street' }, client)), { code: 'staff_email_requires_admin' });
        await assert.rejects(inTransaction(client => auth.updateProfile(id, { email: 'changed@example.test' }, client)), { code: 'staff_email_requires_admin' });
        await db.query("UPDATE driver_profiles SET status='approved' WHERE user_id=$1", [id]);
        await assert.rejects(inTransaction(client => auth.updateProfile(id, { name: 'Unreviewed identity' }, client)), { code: 'approved_driver_material_requires_review' });
      }
    });
    await t.test('scoped verification tokens cannot authenticate ordinary HTTP or socket requests', () => {
      assert.throws(() => jwt.verifyAccessToken(jwt.signPhoneVerificationToken(first)));
      assert.equal(jwt.verifyPhoneVerificationToken(jwt.signPhoneVerificationToken(first)), first);
      assert.throws(() => jwt.verifyAccessToken(jwt.signPhoneChangeToken(first, phone(), first)));
      assert.equal(jwt.verifyAccessToken(jwt.signAccessToken({ id: first })).sub, first);
    });
    await t.test('phone change binds account, code and challenge; rejects reuse and earlier challenges', async () => {
      const target = phone();
      const change = await inTransaction((client) => auth.initiatePhoneChange(first, target, client));
      assert.equal(change.phone, target);
      await assert.rejects(auth.verifyPhoneChange(second, change.challenge, codes.get(target)!), { code: 'invalid_phone_change_challenge' });
      await assert.rejects(auth.verifyPhoneChange(first, change.challenge, 'not-a-code'), { code: 'invalid_phone_change' });
      const saved = await auth.verifyPhoneChange(first, change.challenge, codes.get(target)!);
      assert.equal(saved.user.phone, target);
      await assert.rejects(auth.verifyPhoneChange(first, change.challenge, codes.get(target)!), { code: 'otp_not_found' });
      await assert.rejects(inTransaction((client) => auth.initiatePhoneChange(second, target, client)), { code: 'phone_already_registered' });
      const fresh = phone();
      const old = await inTransaction((client) => auth.initiatePhoneChange(first, fresh, client));
      await (await ensureRedis()).del(`otp:cooldown:${fresh}`);
      const latest = await inTransaction((client) => auth.initiatePhoneChange(first, fresh, client));
      await assert.rejects(auth.verifyPhoneChange(first, old.challenge, codes.get(fresh)!), { code: 'phone_change_challenge_expired' });
      assert.equal((await auth.verifyPhoneChange(first, latest.challenge, codes.get(fresh)!)).user.phone, fresh);
    });
  } finally {
    t.mock.restoreAll();
    const client = await ensureRedis();
    for (const number of phones) await client.del(`otp:cooldown:${number}`, `otp:rate:${number}`);
    await redis?.quit();
    await db.end();
    await owner.query(`DROP SCHEMA ${schema} CASCADE`);
    await owner.end();
  }
});
