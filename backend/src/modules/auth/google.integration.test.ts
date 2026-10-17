import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import express from 'express';
import jwt from 'jsonwebtoken';
import test from 'node:test';
import dotenv from 'dotenv';
import { Pool } from 'pg';
import { OAuth2Client, LoginTicket, type TokenPayload } from 'google-auth-library';

dotenv.config();
const databaseUrl = process.env.DATABASE_URL;

test('Google staff login verifies the browser challenge and existing staff identity', { skip: !databaseUrl }, async (t) => {
  const schema = `google_staff_test_${process.pid}_${Date.now()}`;
  const owner = new Pool({ connectionString: databaseUrl });
  const scopedUrl = new URL(databaseUrl!);
  scopedUrl.searchParams.set('options', `-c search_path=${schema},public`);
  let pool: Pool | undefined;
  let server: ReturnType<typeof express.application.listen> | undefined;
  try {
    await owner.query(`CREATE SCHEMA ${schema}`);
    process.env.DATABASE_URL = scopedUrl.toString();
    process.env.GOOGLE_CLIENT_ID_WEB = 'staff-web-test.apps.googleusercontent.com';
    const { db, inTransaction } = await import('../../shared/config/db.js');
    pool = db;
    for (const file of (await readdir(resolve('migrations'))).filter(name => /^\d+_.*\.sql$/.test(name)).sort())
      await db.query(await readFile(resolve('migrations', file), 'utf8'));
    const { staffGoogleSignIn, googleSignIn, rotateRefreshToken } = await import('./auth.service.js');
    const { verifyAccessToken, hashToken } = await import('./jwt.service.js');
    const { authRouter } = await import('./auth.routes.js');
    const { careAdminRouter } = await import('../care/care.routes.js');
    const { requireAuth, requireApprovedDriver } = await import('./auth.middleware.js');
    const { env } = await import('../../config/env.js');
    const app = express();
    app.use(express.json());
    app.use('/api/auth', authRouter);
    app.use('/api/admin', careAdminRouter);
    app.get('/driver-check', requireAuth, requireApprovedDriver, (_req, res) => { res.json({ approved: true }); });
    app.use((error: Error & { status?: number; code?: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(error.status ?? 500).json({ error: error.code ?? 'internal_error' });
    });
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>(done => server!.once('listening', done));
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const get = (path: string, token: string) => fetch(baseUrl + path, { headers: { Authorization: `Bearer ${token}` } });
    const post = (path: string, body: object) => fetch(baseUrl + '/api/auth/' + path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const tokensForApp = async () => {
      const response = await post('google', { idToken: credential, sessionScope: 'staff' });
      assert.equal(response.status, 200, await response.clone().text());
      return response.json() as Promise<{ tokens: { accessToken: string; refreshToken: string }; user: { id: string; platformRole: string }; activeRole: string }>;
    };
    const nonce = 'a'.repeat(43);
    const credential = 'test-only-google-credential-not-a-real-token';
    const base: TokenPayload = {
      iss: 'https://accounts.google.com', aud: process.env.GOOGLE_CLIENT_ID_WEB,
      sub: 'google-staff-test', email: 'staff-test@gmail.com', email_verified: true,
      name: 'Test staff', iat: 1, exp: 9999999999, nonce,
    };
    let profile: TokenPayload = base;
    let libraryRejects = false;
    const verifier = t.mock.method(OAuth2Client.prototype, 'verifyIdToken', async (options: { idToken: string; audience: string | string[] }) => {
      assert.equal(options.idToken, credential);
      assert.ok(typeof options.audience === 'string' || options.audience.includes(base.aud));
      if (libraryRejects) throw new Error('Invalid signature or expired token');
      return new LoginTicket('', profile);
    });
    const seed = async (email: string, role = 'admin', active = true, googleId: string | null = null) =>
      (await db.query<{ id: string }>(
        'INSERT INTO users(full_name,email,role,is_active,google_id) VALUES($1,$2,$3,$4,$5) RETURNING id',
        ['Google test staff', email, role, active, googleId],
      )).rows[0].id;
    const login = () => inTransaction(client => staffGoogleSignIn(credential, nonce, 'test-browser', client));
    const denies = async (code: string) => {
      const before = (await db.query('SELECT (SELECT count(*) FROM refresh_tokens) AS sessions,(SELECT count(*) FROM admin_audit_log) AS audits,(SELECT count(*) FROM users) AS users')).rows[0];
      await assert.rejects(login(), { code });
      const after = (await db.query('SELECT (SELECT count(*) FROM refresh_tokens) AS sessions,(SELECT count(*) FROM admin_audit_log) AS audits,(SELECT count(*) FROM users) AS users')).rows[0];
      assert.deepEqual(after, before, 'denied Google sign-in creates no account, session or audit success');
    };
    await t.test('invalid signature, nonce and unverified email cannot authorize staff', async () => {
      libraryRejects = true;
      await denies('invalid_google_token');
      libraryRejects = false;
      profile = { ...base, nonce: 'wrong' };
      await denies('invalid_google_token');
      profile = { ...base, email_verified: false };
      await denies('invalid_google_token');
      profile = base;
      await denies('staff_google_account_required');
    });
    await t.test('ordinary and inactive accounts do not gain staff access', async () => {
      await seed(base.email!, 'user');
      await denies('staff_google_account_required');
      profile = { ...base, sub: 'inactive-sub', email: 'inactive@gmail.com' };
      await seed(profile.email!, 'super_admin', false, profile.sub);
      await denies('staff_google_account_required');
    });
    await t.test('matching authoritative email links only an existing active staff record', async () => {
      profile = { ...base, sub: 'approved-staff-sub', email: 'approved-staff@gmail.com' };
      const id = await seed(profile.email!);
      const result = await login();
      assert.equal(result.user.id, id);
      assert.equal(result.user.platformRole, 'admin');
      assert.ok(result.tokens.accessToken);
      assert.ok(result.tokens.refreshToken);
      assert.equal((await db.query('SELECT google_id FROM users WHERE id=$1', [id])).rows[0].google_id, profile.sub);
      assert.equal((await db.query("SELECT count(*)::int AS n FROM admin_audit_log WHERE actor_id=$1 AND action='staff_google_login'", [id])).rows[0].n, 1);
      assert.equal(verifier.mock.calls.at(-1)!.arguments[0].audience, base.aud, 'staff audience is exactly the web client');
      assert.equal(verifyAccessToken(result.tokens.accessToken).sessionScope, 'staff');
      await db.query('UPDATE users SET phone=$2 WHERE id=$1', [id, '+2348000000901']);
      const ride = await tokensForApp();
      assert.equal(ride.user.id, id);
      assert.equal(ride.user.platformRole, 'user');
      assert.equal(ride.activeRole, 'rider');
      assert.equal(verifyAccessToken(ride.tokens.accessToken).sessionScope, 'app');
      assert.equal((await get('/api/admin/support-settings', ride.tokens.accessToken)).status, 403);
      assert.equal((await get('/api/admin/support-settings', result.tokens.accessToken)).status, 200);
      assert.equal((await get('/driver-check', ride.tokens.accessToken)).status, 403, 'staff status never bypasses driver approval');
      const me = await (await get('/api/auth/me', ride.tokens.accessToken)).json();
      assert.equal(me.user.platformRole, 'user');
      const staffMe = await (await get('/api/auth/me', result.tokens.accessToken)).json();
      assert.equal(staffMe.user.platformRole, 'admin');
      for (const [tokens, scope] of [[ride.tokens, 'app'], [result.tokens, 'staff']] as const) {
        let current = tokens;
        for (let count = 0; count < 2; count++) {
          const response = await post('refresh', { refreshToken: current.refreshToken, sessionScope: scope === 'app' ? 'staff' : 'app' });
          assert.equal(response.status, 200);
          current = (await response.json()).tokens;
          assert.equal(verifyAccessToken(current.accessToken).sessionScope, scope);
          assert.equal((await db.query('SELECT session_scope FROM refresh_tokens WHERE token_hash=$1', [hashToken(current.refreshToken)])).rows[0].session_scope, scope);
          assert.equal((await get('/api/admin/support-settings', current.accessToken)).status, scope === 'staff' ? 200 : 403);
        }
      }
      assert.equal((await db.query('SELECT role FROM users WHERE id=$1', [id])).rows[0].role, 'admin');
    });
    await t.test('an email match cannot replace another linked Google subject', async () => {
      profile = { ...base, sub: 'different-sub', email: 'approved-staff@gmail.com' };
      await denies('staff_google_account_required');
      await assert.rejects(inTransaction(client => googleSignIn(credential, undefined, client)), { code: 'google_account_link_required' });
    });
    await t.test('external-provider email needs an existing subject link; Workspace can link by email', async () => {
      profile = { ...base, sub: 'external-sub', email: 'staff@external.test' };
      const id = await seed(profile.email!);
      await denies('staff_google_account_required');
      await assert.rejects(inTransaction(client => googleSignIn(credential, undefined, client)), { code: 'google_account_link_required' });
      await db.query('UPDATE users SET google_id=$1 WHERE id=$2', [profile.sub, id]);
      assert.equal((await login()).user.id, id);
      profile = { ...base, sub: 'workspace-sub', email: 'staff@workspace.test', hd: 'workspace.test' };
      const workspace = await seed(profile.email!, 'super_admin');
      assert.equal((await login()).user.id, workspace);
    });
    await t.test('ride login can link provisioned Gmail staff without creating a staff session', async () => {
      profile = { ...base, sub: 'ride-first-staff-sub', email: 'ride-first@gmail.com' };
      const id = await seed(profile.email!, 'super_admin');
      await db.query('UPDATE users SET phone=$2 WHERE id=$1', [id, '+2348000000902']);
      const ride = await tokensForApp();
      assert.equal(ride.user.id, id);
      assert.equal((await get('/api/admin/support-settings', ride.tokens.accessToken)).status, 403);
      assert.equal((await db.query("SELECT count(*)::int AS n FROM admin_audit_log WHERE actor_id=$1 AND action='staff_google_login'", [id])).rows[0].n, 0);
      profile = { ...profile, nonce: 'wrong' };
      await denies('invalid_google_token');
      profile = { ...profile, nonce };
      const staff = await login();
      assert.equal((await get('/api/admin/support-settings', staff.tokens.accessToken)).status, 200);
      await db.query("INSERT INTO driver_profiles(user_id,status) VALUES($1,'approved')", [id]);
      await db.query("UPDATE users SET active_role='driver' WHERE id=$1", [id]);
      const driver = await tokensForApp();
      assert.equal(driver.activeRole, 'driver');
      assert.equal((await get('/driver-check', driver.tokens.accessToken)).status, 200);
      assert.equal((await get('/api/admin/support-settings', driver.tokens.accessToken)).status, 403);
    });
    await t.test('staff without a phone completes the app verification flow with app-only access', async () => {
      profile = { ...base, sub: 'no-phone-staff-sub', email: 'no-phone-staff@gmail.com' };
      const id = await seed(profile.email!, 'admin', true, profile.sub);
      const result = await inTransaction(client => googleSignIn(credential, undefined, client));
      if (!('needsPhoneVerification' in result)) assert.fail('phone verification must be required');
      const phone = '+2348000000903';
      await db.query("INSERT INTO otp_codes(phone,purpose,code_hash,expires_at) VALUES($1,'registration',$2,now()+interval '5 minutes')", [phone, hashToken('123456')]);
      const response = await post('register/verify', { phone, code: '123456', phoneVerificationToken: result.phoneVerificationToken, sessionScope: 'staff' });
      assert.equal(response.status, 200, await response.clone().text());
      const session = await response.json();
      assert.equal(session.user.id, id);
      assert.equal(session.user.platformRole, 'user');
      assert.equal(verifyAccessToken(session.tokens.accessToken).sessionScope, 'app');
      assert.equal((await get('/api/admin/support-settings', session.tokens.accessToken)).status, 403);
      const staff = await login();
      assert.equal((await get('/api/admin/support-settings', staff.tokens.accessToken)).status, 200);
    });
    await t.test('legacy sessions stay app-only and staff refresh rejects a demoted account', async () => {
      const id = await seed('legacy-staff@gmail.com', 'super_admin', true, 'legacy-staff-sub');
      const oldAccess = jwt.sign({ phone: null }, env.JWT_ACCESS_SECRET, { subject: id, expiresIn: '5m' });
      assert.equal((await get('/api/auth/me', oldAccess)).status, 200);
      assert.equal((await get('/api/admin/support-settings', oldAccess)).status, 403);
      const oldRefresh = 'c'.repeat(96);
      await db.query("INSERT INTO refresh_tokens(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 day')", [id, hashToken(oldRefresh)]);
      const refreshed = await inTransaction(client => rotateRefreshToken(oldRefresh, undefined, client));
      assert.equal(refreshed.reuseDetected, false);
      if (refreshed.reuseDetected) assert.fail('unexpected reuse');
      assert.equal(verifyAccessToken(refreshed.tokens.accessToken).sessionScope, 'app');
      profile = { ...base, sub: 'legacy-staff-sub', email: 'legacy-staff@gmail.com' };
      const staff = await login();
      await db.query("UPDATE users SET role='user' WHERE id=$1", [id]);
      assert.equal((await get('/api/admin/support-settings', staff.tokens.accessToken)).status, 403);
      await assert.rejects(inTransaction(client => rotateRefreshToken(staff.tokens.refreshToken, undefined, client)), { code: 'staff_account_required' });
    });
  } finally {
    if (server) await new Promise<void>((done, reject) => server!.close(error => error ? reject(error) : done()));
    t.mock.restoreAll();
    await pool?.end();
    await owner.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await owner.end();
    const { redis } = await import('../../shared/config/redis.js');
    await redis?.quit();
  }
});
