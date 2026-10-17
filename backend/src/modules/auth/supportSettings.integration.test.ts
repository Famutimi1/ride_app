import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import type { AddressInfo } from 'node:net';
import express, { type ErrorRequestHandler } from 'express';
import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();
test('support settings persist safely and customer reads reflect audited admin updates', { skip: !process.env.DATABASE_URL }, async (t) => {
  const schema = `support_settings_test_${process.pid}_${Date.now()}`;
  const owner = new Pool({ connectionString: process.env.DATABASE_URL });
  await owner.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema},public` });
  const { db } = await import('../../shared/config/db.js');
  const originalQuery = db.query;
  const originalConnect = db.connect;
  db.query = pool.query.bind(pool) as typeof db.query;
  db.connect = pool.connect.bind(pool) as typeof db.connect;
  let server: ReturnType<typeof express.application.listen> | undefined;
  try {
    for (const file of (await readdir(resolve('migrations'))).filter((name) => /^\d+_.*\.sql$/.test(name)).sort()) {
      await pool.query(await readFile(resolve('migrations', file), 'utf8'));
    }
    const ids = await pool.query<{ id: string; role: string }>(`INSERT INTO users(full_name,role)
      VALUES('Customer','user'),('Staff','admin'),('Owner','super_admin'),('Other owner','super_admin') RETURNING id,role`);
    const { signAccessToken: signFixtureAccess } = await import('./jwt.service.js');
    await pool.query("INSERT INTO refresh_tokens(user_id,session_id,token_hash,session_scope,expires_at) SELECT id,id,id::text,'staff',now()+interval '12 hours' FROM users");
    const signAccessToken=(user:{id:string},scope:'app'|'staff'='app')=>signFixtureAccess(user,scope,scope==='staff'?{id:user.id,startedAt:new Date()}:undefined);
    const customer = signAccessToken(ids.rows[0]);
    const staff = signAccessToken(ids.rows[1], 'staff');
    const admin = signAccessToken(ids.rows[2], 'staff');
    const otherAdmin = signAccessToken(ids.rows[3], 'staff');
    const { careCustomerRouter, careAdminRouter } = await import('../care/care.routes.js');
    const app = express();
    app.use(express.json());
    app.use('/api/care', careCustomerRouter);
    app.use('/api/admin', careAdminRouter);
    const errors: ErrorRequestHandler = (error, _req, res, _next) => {
      res.status(error.statusCode ?? error.status ?? 500).json({ error: error.code ?? error.message });
    };
    app.use(errors);
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((done) => server!.once('listening', done));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
    const read = (path: string, token?: string) => fetch(`${base}/${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    const change = (token: string, payload: object) => fetch(`${base}/admin/support-settings`, {
      method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    const input = { phone: '+2348012345678', email: 'SUPPORT@example.test', staffedHours: 'Mon–Fri, 09:00–17:00 WAT', availabilityMessage: 'Contact support during staffed hours.', expectedVersion: 1, reason: 'Set test support contacts', requestKey: randomUUID() };
    await t.test('authenticated defaults and staff-only updates', async () => {
      assert.equal((await read('care/settings')).status, 401);
      const response = await read('care/settings', customer);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      const defaults = await response.json();
      assert.equal(defaults.phone, null);
      assert.equal(defaults.email, null);
      assert.equal(defaults.version, 1);
      assert.match(defaults.availabilityMessage, /being set up/);
      assert.equal((await read('admin/support-settings', customer)).status, 403);
      assert.equal((await read('admin/support-settings', staff)).status, 200);
      assert.equal((await change(customer, input)).status, 403);
      assert.equal((await change(staff, input)).status, 403);
    });
    await t.test('save appears in customer reads and retry writes one audit', async () => {
      const response = await change(admin, input);
      assert.equal(response.status, 200, await response.clone().text());
      const saved = await response.json();
      assert.equal(saved.settings.version, 2);
      assert.equal(saved.settings.email, 'support@example.test');
      assert.equal((await (await read('care/settings', customer)).json()).phone, input.phone);
      const retry = await (await change(admin, input)).json();
      assert.equal(retry.auditId, saved.auditId);
      assert.equal(retry.replayed, true);
      assert.equal((await pool.query('SELECT count(*)::int AS count FROM admin_audit_log')).rows[0].count, 1);
      assert.equal((await change(admin, { ...input, phone: '+2348012345679' })).status, 409);
    });
    await t.test('reject stale, invalid or unknown fields without changes', async () => {
      assert.equal((await change(admin, { ...input, requestKey: randomUUID() })).status, 409);
      for (const fields of [{ phone: "'; DROP TABLE users;--" }, { email: 'invalid' }, { email: 42 }, { staffedHours: '' }, { availabilityMessage: 'x'.repeat(301) }, { hidden: true }]) {
        assert.equal((await change(admin, { ...input, ...fields, expectedVersion: 2, requestKey: randomUUID() })).status, 400);
      }
      assert.equal((await (await read('care/settings', customer)).json()).version, 2);
    });
    await t.test('two owners cannot overwrite each other; empty contacts can be cleared', async () => {
      const payload = { expectedVersion: 2, reason: 'Update staffed support hours', requestKey: randomUUID(), staffedHours: 'Monday WAT' };
      const results = await Promise.all([change(admin, payload), change(otherAdmin, { ...payload, requestKey: randomUUID(), staffedHours: 'Tuesday WAT' })]);
      assert.deepEqual(results.map((response) => response.status).sort(), [200, 409]);
      const response = await change(admin, { phone: null, email: null, expectedVersion: 3, reason: 'Clear test contact details', requestKey: randomUUID() });
      assert.equal(response.status, 200);
      const current = await (await read('care/settings', customer)).json();
      assert.equal(current.phone, null);
      assert.equal(current.email, null);
      assert.equal(current.version, 4);
      const audit = await pool.query("SELECT before_version,after_version FROM admin_audit_log WHERE action='support_settings_updated' ORDER BY id DESC LIMIT 1");
      assert.equal(audit.rows[0].before_version.phone, input.phone);
      assert.equal(audit.rows[0].after_version.phone, null);
    });
  } finally {
    if (server) await new Promise<void>((done, reject) => server!.close((error) => error ? reject(error) : done()));
    db.query = originalQuery;
    db.connect = originalConnect;
    await pool.end();
    await owner.query(`DROP SCHEMA ${schema} CASCADE`);
    await owner.end();
    await db.end();
    const { redis } = await import('../../shared/config/redis.js');
    await redis?.quit();
  }
});
