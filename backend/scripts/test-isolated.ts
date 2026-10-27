import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import dotenv from 'dotenv';
import { Client } from 'pg';
import Redis from 'ioredis';

dotenv.config({ quiet: true });

async function main() {
  if (!['development', 'test'].includes(process.env.NODE_ENV ?? 'development'))
    throw new Error('Tests refuse a production environment. Use a local test database administrator.');
  if (process.env.PAYSTACK_SECRET_KEY?.startsWith('sk_live_'))
    throw new Error('Tests refuse live payment configuration.');
  const configured = process.env.TEST_DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
  if (!configured) throw new Error('A local TEST_DATABASE_ADMIN_URL or DATABASE_URL is required.');
  const adminUrl = new URL(configured);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(adminUrl.hostname))
    throw new Error('The test database administrator must be local; production and remote databases are refused.');
  const database = `rakky_test_${process.pid}_${randomBytes(8).toString('hex')}`;
  const testUrl = new URL(adminUrl);
  testUrl.pathname = `/${database}`;
  testUrl.searchParams.delete('options');
  const admin = new Client({ connectionString: adminUrl.toString(), connectionTimeoutMillis: 5000 });
  const directory = await mkdtemp(join(tmpdir(), 'rakky-test-'));
  let created = false;
  let redisServer: ChildProcess | undefined;
  let suite: ChildProcess | undefined;
  let redis: Redis | undefined;
  const stop = () => { suite?.kill('SIGTERM'); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    await admin.connect();
    // This identifier is generated here, never read from user input or an environment variable.
    await admin.query(`CREATE DATABASE "${database}"`);
    created = true;
    const bootstrap = new Client({ connectionString: testUrl.toString() });
    await bootstrap.connect();
    try { await bootstrap.query('CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public'); }
    finally { await bootstrap.end(); }
    const reservation = createServer();
    await new Promise<void>((done, reject) => { reservation.once('error', reject); reservation.listen(0, '127.0.0.1', done); });
    const port = (reservation.address() as AddressInfo).port;
    await new Promise<void>((done, reject) => reservation.close(error => error ? reject(error) : done()));
    redisServer = spawn('redis-server', ['--bind', '127.0.0.1', '--port', String(port), '--save', '', '--appendonly', 'no', '--dir', directory], { stdio: 'ignore' });
    let startupError: Error | undefined;
    redisServer.on('error', error => { startupError = error; });
    redis = new Redis(`redis://127.0.0.1:${port}`, { lazyConnect: true, maxRetriesPerRequest: 1, retryStrategy: () => null, connectTimeout: 1000 });
    redis.on('error', () => undefined);
    let ready = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      if (startupError) throw new Error('redis-server is required for isolated tests; install/configure the existing Redis runtime.');
      if (redisServer.exitCode !== null) throw new Error('The disposable Redis server failed to start.');
      try { await redis.connect(); await redis.ping(); ready = true; break; }
      catch { redis.disconnect(); await new Promise(done => setTimeout(done, 50)); }
    }
    if (!ready) throw new Error('The disposable Redis server did not become ready.');
    const build=spawn(process.execPath,[resolve('node_modules/typescript/lib/tsc.js')],{stdio:'inherit'});
    if(await new Promise<number>((done,reject)=>{build.once('error',reject);build.once('exit',code=>done(code??1));})!==0)throw new Error('The compiled backend build failed before tests.');
    const requested = process.argv.slice(2);
    const files = requested.length ? requested : (await Promise.all(['trips', 'payments', 'auth', 'notifications', 'communication'].map(async module =>
      (await readdir(resolve('src/modules', module))).filter(file => file.endsWith('.test.ts')).map(file => `src/modules/${module}/${file}`)
    ))).flat();
    console.info('[tests] Using a disposable PostgreSQL database and a separate temporary Redis process.');
    suite = spawn(process.execPath, [resolve('node_modules/tsx/dist/cli.mjs'), '--test', ...files], {
      stdio: 'inherit',
      env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: testUrl.toString(), REDIS_URL: `redis://127.0.0.1:${port}`,
        JWT_ACCESS_SECRET: randomBytes(32).toString('hex'), PAYSTACK_SECRET_KEY: 'sk_test_isolated_fixture',
        COMMUNICATION_AUDIO_ENABLED:'false',COMMUNICATION_VIDEO_ENABLED:'false',COMMUNICATION_AUDIO_ALLOW_DIRECT_ONLY:'false',STUN_URLS:'',TURN_URLS:'',TURN_SHARED_SECRET:'',
        COMMUNICATION_NATIVE_CALLS_ENABLED:'false',CALL_PUSH_TOKEN_KEY:'',CALL_FCM_CREDENTIALS_FILE:'',CALL_FCM_PROJECT_ID:'',GOOGLE_APPLICATION_CREDENTIALS:'',CALL_APNS_KEY_FILE:'',CALL_APNS_KEY_ID:'',CALL_APNS_TEAM_ID:'',
        PAYSTACK_BASE_URL: 'http://127.0.0.1:9', TERMII_API_KEY: '', TEST_OTP_ENABLED: 'false', TEST_OTP_CODE: '', ALERT_WEBHOOK_URL: '', RAKKY_TEST_ISOLATED: 'true',
        CLOUDINARY_ENABLED:'false',CLOUDINARY_CLOUD_NAME:'',CLOUDINARY_API_KEY:'',CLOUDINARY_API_SECRET:'',EMAIL_ENABLED:'false',RESEND_API_KEY:'',RESEND_WEBHOOK_SECRET:'',EMAIL_ADMIN_RECIPIENTS:'' },
    });
    process.exitCode = await new Promise<number>((done, reject) => { suite!.once('error', reject); suite!.once('exit', code => done(code ?? 1)); });
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    redis?.disconnect();
    if (redisServer && redisServer.exitCode === null && redisServer.pid) {
      const exited = new Promise<void>(done => redisServer!.once('exit', () => done()));
      redisServer.kill('SIGTERM');
      await exited;
    }
    if (created) {
      await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()', [database]);
      await admin.query(`DROP DATABASE "${database}"`);
    }
    await admin.end();
    await rm(directory, { recursive: true, force: true });
  }
}
main().catch(() => { console.error('[tests] Isolated test setup/cleanup failed. Check the local PostgreSQL administrator and redis-server availability; no operational database is used by the suite.'); process.exitCode = 1; });
