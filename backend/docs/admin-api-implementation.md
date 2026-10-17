# Rakky admin API implementation snapshot

Read the [API reference](admin-api-reference.md) first for endpoint contracts, auth, examples and operational limits. This appendix contains the current checked-out source, including uncommitted work. Source files are authoritative. Regenerate after code changes with `node --experimental-strip-types scripts/document-admin-api.ts` from the backend directory.

This generator reads only the explicit TypeScript source list below. It never loads `.env`, contacts PostgreSQL/Redis, issues tokens or writes operational records. Checksums let reviewers detect a stale snapshot. Internal imports point to the existing domain services rather than duplicating ledger/matching/auth implementations.

- [src/app.ts](../src/app.ts)
- [src/index.ts](../src/index.ts)
- [src/routes/health.ts](../src/routes/health.ts)
- [src/shared/config/db.ts](../src/shared/config/db.ts)
- [src/shared/config/migrate.ts](../src/shared/config/migrate.ts)
- [src/modules/auth/auth.middleware.ts](../src/modules/auth/auth.middleware.ts)
- [src/modules/auth/auth.routes.ts](../src/modules/auth/auth.routes.ts)
- [src/modules/auth/auth.controller.ts](../src/modules/auth/auth.controller.ts)
- [src/modules/auth/auth.service.ts](../src/modules/auth/auth.service.ts)
- [src/modules/auth/auth.types.ts](../src/modules/auth/auth.types.ts)
- [src/modules/auth/jwt.service.ts](../src/modules/auth/jwt.service.ts)
- [src/modules/auth/otp.service.ts](../src/modules/auth/otp.service.ts)
- [src/websocket/index.ts](../src/websocket/index.ts)
- [src/websocket/notifications.ts](../src/websocket/notifications.ts)
- [src/modules/auth/google.service.ts](../src/modules/auth/google.service.ts)
- [src/modules/auth/admin.routes.ts](../src/modules/auth/admin.routes.ts)
- [src/modules/auth/admin.controller.ts](../src/modules/auth/admin.controller.ts)
- [src/modules/auth/admin.service.ts](../src/modules/auth/admin.service.ts)
- [src/modules/trips/admin.routes.ts](../src/modules/trips/admin.routes.ts)
- [src/modules/trips/admin.controller.ts](../src/modules/trips/admin.controller.ts)
- [src/modules/trips/admin.service.ts](../src/modules/trips/admin.service.ts)
- [src/modules/trips/fare.service.ts](../src/modules/trips/fare.service.ts)
- [src/modules/trips/trips.service.ts](../src/modules/trips/trips.service.ts)
- [src/modules/trips/tripStateMachine.ts](../src/modules/trips/tripStateMachine.ts)
- [src/modules/driver/admin.routes.ts](../src/modules/driver/admin.routes.ts)
- [src/modules/driver/admin.controller.ts](../src/modules/driver/admin.controller.ts)
- [src/modules/driver/admin.service.ts](../src/modules/driver/admin.service.ts)
- [src/modules/driver/driver.service.ts](../src/modules/driver/driver.service.ts)
- [src/modules/location/admin.routes.ts](../src/modules/location/admin.routes.ts)
- [src/modules/location/admin.controller.ts](../src/modules/location/admin.controller.ts)
- [src/modules/location/admin.service.ts](../src/modules/location/admin.service.ts)
- [src/modules/care/care.routes.ts](../src/modules/care/care.routes.ts)
- [src/modules/care/care.controller.ts](../src/modules/care/care.controller.ts)
- [src/modules/care/care.service.ts](../src/modules/care/care.service.ts)
- [src/modules/payments/dashboard.routes.ts](../src/modules/payments/dashboard.routes.ts)
- [src/modules/payments/dashboard.controller.ts](../src/modules/payments/dashboard.controller.ts)
- [src/modules/payments/dashboard.service.ts](../src/modules/payments/dashboard.service.ts)
- [src/modules/payments/admin.routes.ts](../src/modules/payments/admin.routes.ts)
- [src/modules/payments/admin.service.ts](../src/modules/payments/admin.service.ts)
- [src/shared/utils/queueHealth.ts](../src/shared/utils/queueHealth.ts)
- [src/modules/trips/tripQueue.ts](../src/modules/trips/tripQueue.ts)
- [src/modules/payments/paymentQueue.ts](../src/modules/payments/paymentQueue.ts)
- [src/modules/payments/reconciliation.service.ts](../src/modules/payments/reconciliation.service.ts)
- [src/modules/payments/gateway.ts](../src/modules/payments/gateway.ts)
- [src/modules/payments/tripPayments.service.ts](../src/modules/payments/tripPayments.service.ts)
- [src/modules/payments/topups.service.ts](../src/modules/payments/topups.service.ts)
- [src/modules/payments/withdrawals.service.ts](../src/modules/payments/withdrawals.service.ts)
- [src/modules/payments/webhook.service.ts](../src/modules/payments/webhook.service.ts)
- [src/modules/payments/ledger.service.ts](../src/modules/payments/ledger.service.ts)
- [src/modules/payments/payoutAccounts.service.ts](../src/modules/payments/payoutAccounts.service.ts)
- [src/config/env.ts](../src/config/env.ts)
- [src/shared/utils/adminQuery.ts](../src/shared/utils/adminQuery.ts)
- [src/shared/utils/adminPagination.ts](../src/shared/utils/adminPagination.ts)
- [src/shared/utils/adminAudit.ts](../src/shared/utils/adminAudit.ts)
- [src/shared/utils/adminSearch.ts](../src/shared/utils/adminSearch.ts)
- [src/shared/errors.ts](../src/shared/errors.ts)

## src/app.ts

[Open source](../src/app.ts)

SHA-256: `1f90f1b9917fc6ac4bd250bc70206e592b7948f578e31520b59b0eec5e824f7b`

<details>
<summary>Full TypeScript implementation</summary>

```ts
import { careAdminRouter, careCustomerRouter } from './modules/care/care.routes';
import { locationAdminRouter } from './modules/location/admin.routes';
import { driverAdminRouter } from './modules/driver/admin.routes';
import { tripAdminRouter } from './modules/trips/admin.routes';
import { peopleAdminRouter } from './modules/auth/admin.routes';
import { financeDashboardRouter } from './modules/payments/dashboard.routes';
import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import {randomUUID} from 'node:crypto';
import {env} from './config/env';
import { healthRouter } from './routes/health';
import { mapsRouter } from './modules/maps/maps.routes';
import { tripsRouter } from './modules/trips/trips.routes';
import { locationRouter } from './modules/location/location.routes';
import { authRouter } from './modules/auth/auth.routes';
import { driverRouter } from './modules/driver/driver.routes';
import { ApiError } from './shared/errors';
import { walletRouter, paymentsRouter, payoutAccountsRouter, withdrawalsRouter, driverEarningsRouter } from './modules/payments/payments.routes';
import { receivePaystackWebhook } from './modules/payments/webhook.service';
import { paymentAdminRouter } from './modules/payments/admin.routes';

/**
 * Build and configure the Express application.
 * Kept separate from the server bootstrap so it can be imported in tests.
 */
export function createApp(): Express {
  const app = express();
  if(env.TRUSTED_PROXY_CIDRS.length)app.set('trust proxy',env.TRUSTED_PROXY_CIDRS);
  app.use((_req,res,next)=>{res.set('X-Request-Id',randomUUID());next();});

  // Security & parsing middleware
  app.use(helmet());
  app.use(cors());
  app.post('/webhooks/paystack',express.raw({type:'application/json'}),(req,res,next)=>{void receivePaystackWebhook(req,res).catch(next);});
  app.use(express.json({limit:'16kb'}));
  morgan.token('request-id',(_req,res)=>String(res.getHeader('X-Request-Id')??''));
  morgan.token('route',(req)=>{const value=req as Request;return typeof value.route?.path==='string'?`${value.baseUrl}${value.route.path}`:'unmatched';});
  app.use(morgan(env.NODE_ENV==='production'?':request-id :method :route :status :response-time ms':'dev'));

  // Routes
  app.get('/', (_req: Request, res: Response) => {
    res.json({ name: 'ride-app-backend', status: 'running' });
  });
  app.use('/api/health', healthRouter);
  app.use('/api', mapsRouter);
  app.use('/api/trips', tripsRouter);
  app.use('/api/location', locationRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/driver', driverRouter);
  app.use('/api/wallet',walletRouter);
  app.use('/api/payments',paymentsRouter);
  app.use('/api/payout-accounts',payoutAccountsRouter);
  app.use('/api/withdrawals',withdrawalsRouter);
  app.use('/api/driver/earnings',driverEarningsRouter);
  app.use('/api/admin/payments',paymentAdminRouter);
  app.use('/api/admin',careAdminRouter);
  app.use('/api/care',careCustomerRouter);
  app.use('/api/admin',tripAdminRouter);
  app.use('/api/admin',peopleAdminRouter);
  app.use('/api/admin',driverAdminRouter);
  app.use('/api/admin',locationAdminRouter);
  app.use('/api/admin',financeDashboardRouter);

  app.use((error: Error, _req: Request, res: Response, _next: unknown) => {
    if (error instanceof ApiError) return void res.status(error.status).json({ error: error.code, ...error.details });
    const inputError=error as Error & {type?:string};
    if(inputError.type==='entity.too.large')return void res.status(413).json({error:'request_too_large'});
    if(inputError.type==='entity.parse.failed')return void res.status(400).json({error:'invalid_json'});
    console.error(error.message);
    res.status(error.name === 'TimeoutError' ? 504 : 500).json({ error: 'internal_server_error' });
  });

  // 404 fallback
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'Not Found' });
  });

  return app;
}
```

</details>

## src/index.ts

[Open source](../src/index.ts)

SHA-256: `2e7d4e675de5ce3ad122d3642fb3d277a11c477862bc93add4c08a772f037ac4`

<details>
<summary>Full TypeScript implementation</summary>

```ts
import { createServer } from 'node:http';
import type { Server as SocketServer } from 'socket.io';
import { createApp } from './app';
import { env } from './config/env';
import { attachWebsocket } from './websocket';
import { registerTripSocketServer } from './modules/trips/tripSocket';
import { startTripWorkers, stopTripWorkers } from './modules/trips/tripQueue';
import { startPaymentWorkers, stopPaymentWorkers } from './modules/payments/paymentQueue';
import { setServerReadiness } from './modules/auth/admin.service';
import { db } from './shared/config/db';
import { redis } from './shared/config/redis';

const server = createServer(createApp());
let io: SocketServer | undefined;
let stopping = false;
let startupWork:Promise<void>=Promise.resolve();
async function shutdown(exitCode: number) {
  if (stopping) return;
  stopping = true;
  setServerReadiness(false);
  const deadline = setTimeout(() => { console.error('[shutdown] Drain deadline exceeded'); process.exit(1); }, 25_000);
  deadline.unref();
  try {
    await startupWork.catch(()=>undefined);
    const closed = new Promise<void>(done => { if (!server.listening) done(); else server.close(() => done()); });
    if (io) await new Promise<void>(done => io!.close(() => done()));
    await Promise.all([closed, stopTripWorkers(), stopPaymentWorkers()]);
    await db.end();
    if (redis?.status !== 'end') await redis?.quit();
    clearTimeout(deadline);
    process.exitCode = exitCode;
  } catch { console.error('[shutdown] Resource cleanup failed'); process.exit(1); }
}
process.once('SIGTERM', () => { void shutdown(0); });
process.once('SIGINT', () => { void shutdown(0); });
async function start() {
  await db.query('SELECT 1');
  if (stopping) return;
  io = await attachWebsocket(server);
  if(stopping)return;
  registerTripSocketServer(io);
  const workers=await Promise.allSettled([startTripWorkers(), startPaymentWorkers()]);
  if(workers.some(result=>result.status==='rejected'))throw new Error('required_worker_initialization_failed');
  if (stopping) return;
  await new Promise<void>((done, reject) => {
    server.once('error', reject);
    server.listen(env.PORT, () => { server.removeListener('error', reject); done(); });
  });
  setServerReadiness(true);
  console.info(`[startup] Backend ready in ${env.NODE_ENV} mode on port ${env.PORT}`);
}
server.on('error', () => { console.error('[server] HTTP server unavailable'); void shutdown(1); });
startupWork=start();
void startupWork.catch(() => { console.error('[startup] Required database, Redis or workers failed to initialize'); void shutdown(1); });
```

</details>

## src/routes/health.ts

[Open source](../src/routes/health.ts)

SHA-256: `d6d78c5441e6ccba8524c151a89dc8d22f8663d53a3c4f5888aa196d6a82ef3c`

<details>
<summary>Full TypeScript implementation</summary>

```ts
import { Router, Request, Response } from 'express';
import { serverReady } from '../modules/auth/admin.service';

export const healthRouter = Router();

healthRouter.get('/', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});
healthRouter.get('/live', (_req, res) => { res.set('Cache-Control', 'no-store').json({ status: 'alive' }); });
healthRouter.get('/ready', async (_req, res, next) => {
  try { const ready = await serverReady(); res.set('Cache-Control', 'no-store').status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'not_ready' }); }
  catch (error) { next(error); }
});
```

</details>

## src/shared/config/db.ts

[Open source](../src/shared/config/db.ts)

SHA-256: `6652afae083224717a2fe2cb7ad6927b3a3c8140b14804c67be766f6997c78ad`

<details>
<summary>Full TypeScript implementation</summary>

```ts
import { Pool, type PoolClient } from 'pg';
import { env } from '../../config/env';

export const db = new Pool({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 5000 });

export async function inTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
```

</details>

## src/shared/config/migrate.ts

[Open source](../src/shared/config/migrate.ts)

SHA-256: `737b8066585d3e8255488613f4c208c9b9a4475933f2e7deb77deff1070b317f`

<details>
<summary>Full TypeScript implementation</summary>

```ts
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { db } from './db';

async function migrate() {
  const directory = resolve(process.cwd(), 'migrations');
  const lock=await db.connect();
  try {
  await lock.query("SET lock_timeout='10s'");
  await lock.query("SELECT pg_advisory_lock(hashtext('rakky_schema_migrations'))");
  await lock.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    filename TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  const files = (await readdir(directory)).filter((file) => /^\d+_.*\.sql$/.test(file)).sort();
  for (const filename of files) {
    const applied = await lock.query('SELECT 1 FROM schema_migrations WHERE filename=$1', [filename]);
    if (applied.rowCount) continue;
    const sql = await readFile(resolve(directory, filename), 'utf8');
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
      await client.query('COMMIT');
      console.info(`Migration applied: ${filename}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  } finally {
    try {await lock.query("SELECT pg_advisory_unlock(hashtext('rakky_schema_migrations'))");}
    finally {lock.release();await db.end();}
  }
}
migrate().catch(async(error)=>{const value=error as {message?:string;code?:string;errors?:Array<{code?:string}>};console.error(value.message||value.code||value.errors?.[0]?.code||'Migration failed');try{await db.end();}catch{}process.exitCode=1;});
```

</details>

## src/modules/auth/auth.middleware.ts

[Open source](../src/modules/auth/auth.middleware.ts)

SHA-256: `19a6b54e9efb624bbb676f29105304f6f40c79931e68b17a56a069a64c1d02d6`

<details>
<summary>Full TypeScript implementation</summary>

```ts
import type { NextFunction, Request, Response } from 'express';
import { db } from '../../shared/config/db';
import { verifyAccessToken } from './jwt.service';
import { ApiError } from '../../shared/errors';
import { authenticatedSessionUser } from './auth.service';
import {createHmac} from 'node:crypto';
import {ensureRedis} from '../../shared/config/redis';
import {env} from '../../config/env';

export async function limitPublicAuth(req:Request,res:Response,next:NextFunction) {
  const identity=createHmac('sha256',env.JWT_ACCESS_SECRET).update(req.ip??req.socket.remoteAddress??'unknown').digest('hex');
  try{
    const redis=await ensureRedis();
    const[count,ttl]=await redis.eval("local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],60) end; return {n,redis.call('TTL',KEYS[1])}",1,`auth:request-rate:${identity}`) as [number,number];
    if(count>env.AUTH_RATE_LIMIT_PER_MINUTE){const retryAfterSeconds=Math.max(1,ttl);res.set('Retry-After',String(retryAfterSeconds));return void res.status(429).json({error:'authentication_rate_limited',retryAfterSeconds});}
    next();
  }catch{next(new ApiError(503,'authentication_service_unavailable'));}
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return void res.status(401).json({ error: 'missing_token' });
  let payload: ReturnType<typeof verifyAccessToken>;
  try { payload = verifyAccessToken(header.slice(7)); }
  catch { return void res.status(401).json({ error: 'invalid_or_expired_token' }); }
  try {
    const user = await authenticatedSessionUser(payload);
    if (!user) return void res.status(401).json({ error: 'invalid_or_expired_token' });
    req.userId = user.id; req.authUser = user; req.sessionScope = payload.sessionScope; next();
  } catch { next(new ApiError(503, 'authentication_service_unavailable')); }
}

export async function requireApprovedDriver(req: Request, res: Response, next: NextFunction) {
  const { rows } = await db.query('SELECT status FROM driver_profiles WHERE user_id=$1', [req.userId]);
  if (rows[0]?.status !== 'approved') {
    const tripId = typeof req.params.id === 'string' ? req.params.id : null;
    const active = tripId ? (await db.query(
      `SELECT 1 FROM trips WHERE id=$1 AND driver_id=$2 AND status IN ('driver_assigned','driver_arrived','in_progress','returning')`,
      [tripId, req.userId],
    )).rows[0] : null;
    if (!active) return void res.status(403).json({ error: 'driver_not_approved', driverStatus: rows[0]?.status ?? 'none' });
  }
  next();
}

export function requireStaffRole(...roles: Array<'admin' | 'super_admin'>) {
  return (req: Request, res: Response, next: NextFunction) => req.sessionScope === 'staff' && req.authUser && roles.includes(req.authUser.role as 'admin' | 'super_admin') ? next() : void res.status(403).json({ error: 'insufficient_permissions' });
}
```

</details>

## src/modules/auth/auth.routes.ts

[Open source](../src/modules/auth/auth.routes.ts)

SHA-256: `367e7f0c0a77fb3122e8940abd7cbf09916dac18da690c7e65ba4d37744cefd7`

<details>
<summary>Full TypeScript implementation</summary>

```ts
import { Router } from 'express';
import { activeRole, google, staffGoogle, loginInitiate, loginVerify, staffLoginVerify, logout, logoutAll, me, refresh, registerInitiate, registerVerify, resend, profileUpdate, phoneChangeInitiate, phoneChangeVerify } from './auth.controller';
import { requireAuth,limitPublicAuth } from './auth.middleware';

export const authRouter = Router();
const publicAuthPaths=new Set(['/register/initiate','/register/verify','/login/initiate','/login/verify','/login/staff/verify','/otp/resend','/refresh','/google','/google/staff','/logout']);
authRouter.use((req,res,next)=>{if(req.method==='POST'&&publicAuthPaths.has(req.path))void limitPublicAuth(req,res,next);else next();});
authRouter.use((req,res,next)=>{if(['POST','PATCH'].includes(req.method)&&req.path!=='/logout-all'&&(!req.body||typeof req.body!=='object'||Array.isArray(req.body)))return void res.status(400).json({error:'invalid_request_body'});next();});
authRouter.post('/register/initiate', registerInitiate);
authRouter.post('/register/verify', registerVerify);
authRouter.post('/login/initiate', loginInitiate);
authRouter.post('/login/verify', loginVerify);
authRouter.post('/login/staff/verify', staffLoginVerify);
authRouter.post('/otp/resend', resend);
authRouter.post('/refresh', refresh);
authRouter.post('/google', google);
authRouter.post('/google/staff', staffGoogle);
authRouter.get('/me', requireAuth, me);
authRouter.patch('/profile', requireAuth, profileUpdate);
authRouter.post('/phone-change/initiate', requireAuth, phoneChangeInitiate);
authRouter.post('/phone-change/verify', requireAuth, phoneChangeVerify);
authRouter.patch('/active-role', requireAuth, activeRole);
// The refresh credential authenticates its own revocation, including after access expiry.
authRouter.post('/logout', logout);
authRouter.post('/logout-all', requireAuth, logoutAll);
```

</details>

## src/modules/auth/auth.controller.ts

[Open source](../src/modules/auth/auth.controller.ts)

SHA-256: `a735b1e90173dd7c1be797377efcf35beaf478c28e580970f74a7084e80ec57f`

<details>
<summary>Full TypeScript implementation</summary>

```ts
import type { NextFunction, Request, Response } from 'express';
import { inTransaction } from '../../shared/config/db';
import * as auth from './auth.service';
import { ApiError } from '../../shared/errors';
import { disconnectAccountSockets, disconnectSessionSockets } from '../../websocket/notifications';

const device = (req: Request) => req.get('user-agent');
const run = (handler: (req: Request) => Promise<unknown>) => async (req: Request, res: Response, next: NextFunction) => { try { res.json(await handler(req)); } catch (error) { next(error); } };

export const registerInitiate = run((req) => inTransaction((client) => auth.initiateRegistration(req.body.fullName, req.body.phone, req.body.accountType, client)));
export const registerVerify = run((req) => auth.verifyRegistration(req.body, device(req)));
export const loginInitiate = run((req) => inTransaction((client) => auth.initiateLogin(req.body.phone, client)));
export const loginVerify = run((req) => auth.verifyLogin(req.body.phone, req.body.code, device(req)));
export const staffLoginVerify = run((req) => auth.verifyLogin(req.body.phone, req.body.code, device(req), 'staff'));
export const resend = run((req) => inTransaction((client) => auth.resendOtp(req.body.phone, req.body.purpose, client)));
export const refresh = async (req: Request, res: Response, next: NextFunction) => { try { const result=await inTransaction((client)=>auth.rotateRefreshToken(req.body?.refreshToken,device(req),client));if(result.reuseDetected){disconnectSessionSockets(result.sessionId);throw new ApiError(401,'refresh_token_reuse_detected');}res.json({tokens:result.tokens}); } catch(error){next(error);} };
export const google = run((req) => inTransaction((client) => auth.googleSignIn(req.body.idToken, device(req), client)));
export const staffGoogle = run((req) => inTransaction((client) => auth.staffGoogleSignIn(req.body?.idToken, req.body?.expectedNonce, device(req), client)));
export const me = run((req) => inTransaction((client) => auth.getMe(req.userId!, client, req.sessionScope)));
export const profileUpdate = run((req) => inTransaction((client) => auth.updateProfile(req.userId!, req.body, client)));
export const phoneChangeInitiate = run((req) => inTransaction((client) => auth.initiatePhoneChange(req.userId!, req.body?.phone, client)));
export const phoneChangeVerify = run((req) => auth.verifyPhoneChange(req.userId!, req.body?.challenge, req.body?.code));
export const activeRole = run((req) => inTransaction((client) => auth.switchActiveRole(req.userId!, req.body.role, client)));
export const logout = run(async (req) => { const session=await inTransaction((client) => auth.revokePresentedToken(req.body?.refreshToken, client));if(session)disconnectSessionSockets(session.sessionId);return { success: true }; });
export const logoutAll = run(async (req) => { await inTransaction((client) => auth.revokeAll(req.userId!, client));disconnectAccountSockets(req.userId!);return { success: true }; });
```

</details>

## src/modules/auth/auth.service.ts

[Open source](../src/modules/auth/auth.service.ts)

SHA-256: `73bf8e4b912830814c334432256506375756a24e832c38549619ac70fcbabe22`

<details>
<summary>Full TypeScript implementation</summary>

```ts
import type { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { db } from '../../shared/config/db';
import { assertDriverMaterialEditable } from '../driver/driver.service';
import { env } from '../../config/env';
import { ApiError } from '../../shared/errors';
import { normalizeNigerianPhone } from '../../shared/utils/phone';
import { publicUser, type AccountType, type AuthUserRow, type DriverStatus, type OtpPurpose, type SessionScope } from './auth.types';
import { generateOtp, withVerifiedOtp } from './otp.service';
import { createRefreshToken, hashToken, signAccessToken, signPhoneVerificationToken, verifyPhoneVerificationToken, signPhoneChangeToken, verifyPhoneChangeToken } from './jwt.service';
import { verifyGoogleToken, verifyStaffGoogleToken } from './google.service';

export async function getDriverStatus(userId: string, client: PoolClient): Promise<DriverStatus> {
  const { rows } = await client.query('SELECT status FROM driver_profiles WHERE user_id=$1', [userId]);
  return rows[0]?.status ?? 'none';
}
const effectiveRole = (user: AuthUserRow, status: DriverStatus): AccountType => user.active_role === 'driver' && status === 'approved' ? 'driver' : 'rider';
async function sessionRole(user: AuthUserRow, status: DriverStatus, client: PoolClient): Promise<AccountType> {
  if (effectiveRole(user, status) === 'driver') return 'driver';
  if (user.active_role !== 'driver') return 'rider';
  const active = await client.query(
    "SELECT 1 FROM trips WHERE driver_id=$1 AND status IN ('driver_assigned','driver_arrived','in_progress','returning') LIMIT 1", [user.id],
  );
  return active.rowCount ? 'driver' : 'rider';
}

export async function issueTokenPair(user: AuthUserRow, deviceInfo: string | undefined, client: PoolClient, scope: SessionScope = 'app', family?:{id:string;startedAt:Date}) {
  if (scope === 'staff' && !['admin', 'super_admin'].includes(user.role)) throw new ApiError(403, 'staff_account_required');
  const locked=(await client.query<AuthUserRow>('SELECT * FROM users WHERE id=$1 AND is_active=true FOR UPDATE',[user.id])).rows[0];
  if(!locked)throw new ApiError(401,'account_inactive');
  if(scope==='staff'&&!['admin','super_admin'].includes(locked.role))throw new ApiError(403,'staff_account_required');
  const session=family??{id:randomUUID(),startedAt:new Date()};
  if(scope==='staff'&&session.startedAt.getTime()+12*60*60*1000<=Date.now())throw new ApiError(401,'staff_session_expired');
  const accessToken = signAccessToken(locked, scope, session);
  const refreshToken = createRefreshToken();
  await client.query(`INSERT INTO refresh_tokens (user_id,token_hash,device_info,expires_at,session_scope,session_id,session_started_at) VALUES ($1,$2,$3,CASE WHEN $5='staff' THEN LEAST(now()+($4*interval '1 day'),$7::timestamptz+interval '12 hours') ELSE now()+($4*interval '1 day') END,$5,$6,$7)`, [user.id, hashToken(refreshToken), deviceInfo?.slice(0, 255), env.REFRESH_TOKEN_EXPIRY_DAYS, scope,session.id,session.startedAt]);
  return { accessToken, refreshToken };
}

async function sessionPayload(user: AuthUserRow, deviceInfo: string | undefined, client: PoolClient, scope: SessionScope = 'app') {
  const driverStatus = await getDriverStatus(user.id, client);
  return { tokens: await issueTokenPair(user, deviceInfo, client, scope), user: publicUser(user, scope), driverStatus, activeRole: await sessionRole(user, driverStatus, client) };
}

export async function initiateRegistration(fullName: unknown, phoneValue: unknown, accountType: unknown, client: PoolClient) {
  const name = String(fullName ?? '').trim();
  if (name.length < 2 || name.length > 120) throw new ApiError(400, 'invalid_full_name');
  if (accountType !== 'rider' && accountType !== 'driver') throw new ApiError(400, 'invalid_account_type');
  const phone = normalizeNigerianPhone(phoneValue);
  if ((await client.query('SELECT 1 FROM users WHERE phone=$1', [phone])).rowCount) throw new ApiError(409, 'phone_already_registered');
  await generateOtp(phone, 'registration', client);
  return { phone, retryAfterSeconds: env.OTP_RESEND_COOLDOWN_SECONDS };
}

export async function verifyRegistration(input: { fullName?: unknown; phone?: unknown; code?: unknown; accountType?: unknown; phoneVerificationToken?: unknown }, deviceInfo: string | undefined) {
  const phone = normalizeNigerianPhone(input.phone);
  const code = String(input.code ?? '');
  const accountType: AccountType = input.accountType === 'driver' ? 'driver' : 'rider';
  return withVerifiedOtp(phone, 'registration', code, async (client) => {
    let user: AuthUserRow;
    if (input.phoneVerificationToken) {
      let userId: string;
      try { userId = verifyPhoneVerificationToken(String(input.phoneVerificationToken)); } catch { throw new ApiError(401, 'invalid_phone_verification_token'); }
      const { rows } = await client.query(`UPDATE users SET phone=$1,phone_verified_at=now(),updated_at=now() WHERE id=$2 AND phone IS NULL AND is_active=true RETURNING *`, [phone, userId]);
      if (!rows[0]) throw new ApiError(409, 'phone_link_failed');
      user = rows[0];
    } else {
      const fullName = String(input.fullName ?? '').trim();
      if (fullName.length < 2 || fullName.length > 120) throw new ApiError(400, 'invalid_full_name');
      const { rows } = await client.query(`INSERT INTO users (full_name,phone,phone_verified_at) VALUES ($1,$2,now()) RETURNING *`, [fullName, phone]);
      user = rows[0];
    }
    return { ...(await sessionPayload(user, deviceInfo, client)), accountType };
  });
}

export async function initiateLogin(phoneValue: unknown, client: PoolClient) {
  const phone = normalizeNigerianPhone(phoneValue);
  if (!(await client.query('SELECT 1 FROM users WHERE phone=$1 AND is_active=true', [phone])).rowCount) throw new ApiError(404, 'account_not_found');
  await generateOtp(phone, 'login', client);
  return { phone, retryAfterSeconds: env.OTP_RESEND_COOLDOWN_SECONDS };
}

export async function verifyLogin(phoneValue: unknown, codeValue: unknown, deviceInfo: string | undefined, scope: SessionScope = 'app') {
  const phone = normalizeNigerianPhone(phoneValue);
  return withVerifiedOtp(phone, 'login', String(codeValue ?? ''), async (client) => {
    const { rows } = await client.query('SELECT * FROM users WHERE phone=$1 AND is_active=true', [phone]);
    if (!rows[0]) throw new ApiError(404, 'account_not_found');
    return sessionPayload(rows[0], deviceInfo, client, scope);
  });
}

export async function resendOtp(phoneValue: unknown, purpose: unknown, client: PoolClient) {
  if (!['registration','login'].includes(String(purpose))) throw new ApiError(400, 'invalid_otp_purpose');
  const phone = normalizeNigerianPhone(phoneValue);
  await generateOtp(phone, purpose as OtpPurpose, client);
  return { retryAfterSeconds: env.OTP_RESEND_COOLDOWN_SECONDS };
}

export async function rotateRefreshToken(raw: unknown, deviceInfo: string | undefined, client: PoolClient) {
  if (typeof raw !== 'string' || raw.length < 64) throw new ApiError(401, 'invalid_refresh_token');
  const owner=(await client.query<{user_id:string}>('SELECT user_id FROM refresh_tokens WHERE token_hash=$1',[hashToken(raw)])).rows[0];
  if(!owner)throw new ApiError(401,'invalid_refresh_token');
  const user = (await client.query<AuthUserRow>('SELECT * FROM users WHERE id=$1 AND is_active=true FOR UPDATE', [owner.user_id])).rows[0];
  if (!user) throw new ApiError(401, 'account_inactive');
  const { rows } = await client.query("SELECT *, (replaced_by IS NOT NULL AND revoked_at>now()-interval '5 seconds') AS recently_rotated FROM refresh_tokens WHERE token_hash=$1 FOR UPDATE", [hashToken(raw)]);
  const existing = rows[0];
  if (!existing) throw new ApiError(401, 'invalid_refresh_token');
  if (existing.revoked_at || existing.replaced_by) {
    // A duplicate in flight gets no new credentials and does not invalidate the
    // winner. Later reuse still revokes this family. Clients keep their tokens
    // on 409 and retry using the credential saved by the winning request.
    if(existing.recently_rotated)throw new ApiError(409,'refresh_already_rotated');
    await client.query('UPDATE refresh_tokens SET revoked_at=COALESCE(revoked_at,now()) WHERE user_id=$1 AND session_id=$2 AND revoked_at IS NULL', [existing.user_id,existing.session_id]);
    return { reuseDetected: true as const, sessionId:existing.session_id as string };
  }
  if (new Date(existing.expires_at).getTime() <= Date.now()) throw new ApiError(401, 'refresh_token_expired');
  if (existing.session_scope !== 'app' && existing.session_scope !== 'staff') throw new ApiError(401, 'invalid_refresh_token');
  await client.query('UPDATE refresh_tokens SET revoked_at=now() WHERE id=$1',[existing.id]);
  const pair = await issueTokenPair(user, deviceInfo, client, existing.session_scope,{id:existing.session_id,startedAt:new Date(existing.session_started_at)});
  await client.query(`UPDATE refresh_tokens SET replaced_by=(SELECT id FROM refresh_tokens WHERE token_hash=$1) WHERE id=$2`, [hashToken(pair.refreshToken), existing.id]);
  return { reuseDetected: false as const, tokens: pair };
}

export async function revokeToken(userId: string, raw: unknown, client: PoolClient) {
  await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[userId]);
  if (typeof raw === 'string') await client.query('UPDATE refresh_tokens SET revoked_at=COALESCE(revoked_at,now()) WHERE user_id=$1 AND session_id=(SELECT session_id FROM refresh_tokens WHERE user_id=$1 AND token_hash=$2)', [userId, hashToken(raw)]);
}
/** Possession of this opaque credential authorizes revoking only its own session. */
export async function revokePresentedToken(raw: unknown, client: PoolClient) {
  if (typeof raw !== 'string' || !/^[0-9a-f]{64,512}$/i.test(raw)) throw new ApiError(400, 'invalid_refresh_token');
  const token = (await client.query<{ user_id: string; session_id:string }>(
    'SELECT user_id,session_id FROM refresh_tokens WHERE token_hash=$1', [hashToken(raw)],
  )).rows[0];
  if (token) await revokeToken(token.user_id, raw, client);
  return token ? {userId:token.user_id,sessionId:token.session_id} : null;
  // Unknown/already revoked credentials have the same response, with no identity disclosure.
}
export async function revokeAll(userId: string, client: PoolClient) { await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[userId]);await client.query('UPDATE refresh_tokens SET revoked_at=COALESCE(revoked_at,now()) WHERE user_id=$1 AND revoked_at IS NULL', [userId]); }

/** Current account/session authority is shared by HTTP and socket authentication. */
export async function authenticatedSessionUser(payload: ReturnType<typeof import('./jwt.service').verifyAccessToken>) {
  if(!payload.sessionId){
    if(payload.sessionScope==='staff')return null;
    return (await db.query<AuthUserRow>('SELECT * FROM users WHERE id=$1 AND is_active=true',[payload.sub])).rows[0]??null;
  }
  const probe={text:`SELECT u.* FROM users u WHERE u.id=$1 AND u.is_active=true AND EXISTS(
    SELECT 1 FROM refresh_tokens r WHERE r.user_id=u.id AND r.session_id=$2 AND r.session_scope=$3
      AND r.revoked_at IS NULL AND r.expires_at>now()
      AND (r.session_scope<>'staff' OR r.session_started_at+interval '12 hours'>now()))`,values:[payload.sub,payload.sessionId,payload.sessionScope],query_timeout:2000};
  return (await db.query<AuthUserRow>(probe)).rows[0]??null;
}

export async function getMe(userId: string, client: PoolClient, scope: SessionScope = 'app') {
  const user = (await client.query('SELECT * FROM users WHERE id=$1 AND is_active=true', [userId])).rows[0];
  if (!user) throw new ApiError(404, 'account_not_found');
  const driverStatus = await getDriverStatus(userId, client);
  return { user: publicUser(user, scope), driverStatus, activeRole: await sessionRole(user, driverStatus, client) };
}

export async function updateProfile(userId: string, input: unknown, client: PoolClient) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ApiError(400, 'invalid_profile');
  const fields = input as Record<string, unknown>;
  if (Object.keys(fields).some((key) => !['name', 'email'].includes(key))) throw new ApiError(400, 'unsupported_profile_field');
  const hasName = Object.prototype.hasOwnProperty.call(fields, 'name');
  const hasEmail = Object.prototype.hasOwnProperty.call(fields, 'email');
  if (!hasName && !hasEmail) throw new ApiError(400, 'missing_profile_changes');
  const name = typeof fields.name === 'string' ? fields.name.trim() : '';
  const email = fields.email === null ? null : typeof fields.email === 'string' ? fields.email.trim().toLowerCase() || null : undefined;
  if (hasName && (name.length < 2 || name.length > 120 || /[\u0000-\u001f]/.test(name))) throw new ApiError(400, 'invalid_full_name');
  if (hasEmail && (email === undefined || (email !== null && (email.length > 160 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))))) throw new ApiError(400, 'invalid_email');
  const user = (await client.query<AuthUserRow>('SELECT * FROM users WHERE id=$1 AND is_active=true FOR UPDATE', [userId])).rows[0];
  if (!user) throw new ApiError(401, 'account_inactive');
  // Customer-entered contact email must never change a staff authentication identity.
  if (user.role !== 'user') throw new ApiError(403, 'staff_profile_requires_admin');
  if(hasName&&name!==user.full_name)await assertDriverMaterialEditable(userId,client);
  try {
    await client.query(`UPDATE users SET full_name=CASE WHEN $2 THEN $3 ELSE full_name END,
      email=CASE WHEN $4 THEN $5 ELSE email END,updated_at=now() WHERE id=$1`, [userId, hasName, name, hasEmail, email]);
  } catch (error) {
    if ((error as { code?: string }).code === '23505') throw new ApiError(409, 'email_already_registered');
    throw error;
  }
  return getMe(userId, client);
}

export async function initiatePhoneChange(userId: string, phoneValue: unknown, client: PoolClient) {
  const phone = normalizeNigerianPhone(phoneValue);
  const user = (await client.query<AuthUserRow>('SELECT * FROM users WHERE id=$1 AND is_active=true FOR UPDATE', [userId])).rows[0];
  if (!user || user.role !== 'user') throw new ApiError(403, 'phone_change_unavailable');
  await assertDriverMaterialEditable(userId,client);
  if (user.phone === phone) throw new ApiError(400, 'phone_unchanged');
  if ((await client.query('SELECT 1 FROM users WHERE phone=$1', [phone])).rowCount) throw new ApiError(409, 'phone_already_registered');
  const otpId = await generateOtp(phone, 'phone_change', client);
  return { phone, challenge: signPhoneChangeToken(userId, phone, otpId), retryAfterSeconds: env.OTP_RESEND_COOLDOWN_SECONDS };
}

export async function verifyPhoneChange(userId: string, challenge: unknown, code: unknown) {
  if (typeof challenge !== 'string' || typeof code !== 'string' || !/^\d{6}$/.test(code)) throw new ApiError(400, 'invalid_phone_change');
  let verified: { phone: string; otpId: string };
  try { verified = verifyPhoneChangeToken(challenge, userId); } catch { throw new ApiError(400, 'invalid_phone_change_challenge'); }
  return withVerifiedOtp(verified.phone, 'phone_change', code, async (client) => {
    const user = (await client.query<AuthUserRow>('SELECT * FROM users WHERE id=$1 AND is_active=true FOR UPDATE', [userId])).rows[0];
    if (!user || user.role !== 'user') throw new ApiError(403, 'phone_change_unavailable');
    await assertDriverMaterialEditable(userId,client);
    try { await client.query('UPDATE users SET phone=$2,phone_verified_at=now(),updated_at=now() WHERE id=$1', [userId, verified.phone]); }
    catch (error) { if ((error as { code?: string }).code === '23505') throw new ApiError(409, 'phone_already_registered'); throw error; }
    return getMe(userId, client);
  }, verified.otpId);
}

export async function switchActiveRole(userId: string, requestedRole: unknown, client: PoolClient) {
  if (requestedRole !== 'rider' && requestedRole !== 'driver') throw new ApiError(400, 'invalid_role');
  const user = (await client.query<{ active_role: string }>('SELECT active_role FROM users WHERE id=$1 FOR UPDATE', [userId])).rows[0];
  if (!user) throw new ApiError(404, 'account_not_found');
  if (user.active_role !== requestedRole) {
    const active = await client.query(
      `SELECT id FROM trips WHERE (rider_id=$1 OR driver_id=$1)
       AND status IN ('searching','driver_assigned','driver_arrived','in_progress','returning') LIMIT 1`, [userId],
    );
    if (active.rowCount) throw new ApiError(409, 'active_trip_prevents_role_switch');
  }
  if (requestedRole === 'driver') { const status = await getDriverStatus(userId, client); if (status !== 'approved') throw new ApiError(403, 'driver_not_approved', { driverStatus: status }); }
  await client.query('UPDATE users SET active_role=$1,updated_at=now() WHERE id=$2', [requestedRole, userId]);
  return { activeRole: requestedRole };
}

export async function googleSignIn(idToken: unknown, deviceInfo: string | undefined, client: PoolClient) {
  if (typeof idToken !== 'string') throw new ApiError(400, 'missing_google_token');
  const profile = await verifyGoogleToken(idToken);
  let user = (await client.query('SELECT * FROM users WHERE google_id=$1 FOR UPDATE', [profile.sub])).rows[0] as AuthUserRow | undefined;
  if (!user) {
    const emailMatches = (await client.query<AuthUserRow>('SELECT * FROM users WHERE lower(email)=lower($1) FOR UPDATE', [profile.email])).rows;
    if (emailMatches.length > 1) throw new ApiError(403, 'google_account_link_required');
    const emailMatch = emailMatches[0];
    if (emailMatch) {
      // Contact email is not an identity link for customers. Staff emails are
      // provisioned by the owner; Google must be authoritative before linking.
      const authoritativeEmail = profile.email!.toLowerCase().endsWith('@gmail.com') || Boolean(profile.hd);
      if (emailMatch.role === 'user' || emailMatch.google_id || !authoritativeEmail) throw new ApiError(403, 'google_account_link_required');
      user = emailMatch;
    }
  }
  if (user) {
    if (!user.is_active) throw new ApiError(403, 'account_inactive');
    if (!user.google_id) {
      const updated = (await client.query('UPDATE users SET google_id=$1,avatar_url=COALESCE(avatar_url,$2),updated_at=now() WHERE id=$3 RETURNING *', [profile.sub, profile.picture ?? null, user.id])).rows[0] as AuthUserRow | undefined;
      if (!updated) throw new ApiError(409, 'google_link_failed');
      user = updated;
    }
    if (!user.phone) return { needsPhoneVerification: true, phoneVerificationToken: signPhoneVerificationToken(user.id), user: publicUser(user) };
    return sessionPayload(user, deviceInfo, client);
  }
  const created = (await client.query(`INSERT INTO users (full_name,email,google_id,avatar_url) VALUES ($1,$2,$3,$4) RETURNING *`, [profile.name, profile.email, profile.sub, profile.picture ?? null])).rows[0] as AuthUserRow | undefined;
  if (!created) throw new ApiError(500, 'google_account_creation_failed');
  return { needsPhoneVerification: true, phoneVerificationToken: signPhoneVerificationToken(created.id), user: publicUser(created) };
}

/** Staff sign-in never creates an account or grants a role. */
export async function staffGoogleSignIn(idToken: unknown, expectedNonce: unknown, deviceInfo: string | undefined, client: PoolClient) {
  if (typeof idToken !== 'string' || idToken.length < 20 || idToken.length > 12000 ||
      typeof expectedNonce !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(expectedNonce))
    throw new ApiError(400, 'invalid_google_sign_in');
  const profile = await verifyStaffGoogleToken(idToken, expectedNonce);
  // Google is authoritative for Gmail/Workspace. Other email providers require
  // a Google subject already linked to the staff account, not email-only linking.
  const authoritativeEmail = profile.email!.toLowerCase().endsWith('@gmail.com') || Boolean(profile.hd);
  const linked = (await client.query<AuthUserRow>(
    'SELECT * FROM users WHERE google_id=$1 FOR UPDATE', [profile.sub],
  )).rows[0];
  let user = linked;
  if (!user && authoritativeEmail) {
    const candidates = await client.query<AuthUserRow>(
      "SELECT * FROM users WHERE lower(email)=lower($1) AND google_id IS NULL AND is_active=true AND role IN ('admin','super_admin') FOR UPDATE",
      [profile.email],
    );
    if (candidates.rows.length === 1) user = candidates.rows[0];
  }
  if (!user || !user.is_active || !['admin', 'super_admin'].includes(user.role))
    throw new ApiError(403, 'staff_google_account_required');
  if (!user.google_id) {
    const updated = (await client.query<AuthUserRow>(
      'UPDATE users SET google_id=$1,updated_at=now() WHERE id=$2 RETURNING *', [profile.sub, user.id],
    )).rows[0];
    if (!updated) throw new ApiError(409, 'google_link_failed');
    user = updated;
  }
  await client.query(
    "INSERT INTO admin_audit_log(actor_id,action,reason,object_type,object_id) VALUES($1,'staff_google_login','Staff authenticated using Google','user',$1)",
    [user.id],
  );
  return sessionPayload(user, deviceInfo, client, 'staff');
}
```

</details>

## src/modules/auth/auth.types.ts

[Open source](../src/modules/auth/auth.types.ts)

SHA-256: `7615664543f24117cb3ebb2c4470ca02e0ecf33c01c37faf1629e8f8fb1fdebc`

<details>
<summary>Full TypeScript implementation</summary>

```ts
export type OtpPurpose = 'registration' | 'login' | 'phone_change' | 'withdrawal' | 'payout_account';
export type AccountType = 'rider' | 'driver';
export type SessionScope = 'app' | 'staff';
export type DriverStatus = 'none' | 'pending' | 'approved' | 'rejected';
export interface AuthUserRow { id: string; full_name: string; phone: string | null; email: string | null; google_id: string | null; avatar_url: string | null; role: 'user' | 'admin' | 'super_admin'; active_role: AccountType; is_active: boolean }
export function publicUser(user: AuthUserRow, scope: SessionScope = 'app') { return { id: user.id, name: user.full_name, phone: user.phone, email: user.email, avatarUrl: user.avatar_url, platformRole: scope === 'staff' ? user.role : 'user' as const }; }
```

</details>

## src/modules/auth/jwt.service.ts

[Open source](../src/modules/auth/jwt.service.ts)

SHA-256: `70f7f40997f31e3d91d2f64bde49cf733413bb917a72368f53beaae19b167d49`

<details>
<summary>Full TypeScript implementation</summary>

```ts
import { createHash, randomBytes } from 'node:crypto';
import jwt, { type JwtPayload, type SignOptions } from 'jsonwebtoken';
import { env } from '../../config/env';
import type { SessionScope } from './auth.types';

export function signAccessToken(user: { id: string; phone?: string | null }, sessionScope: SessionScope = 'app', session?: {id:string;startedAt:Date}) {
  return jwt.sign({ phone: user.phone ?? undefined, sessionScope, sessionId: session?.id,
    ...(sessionScope==='staff' && session ? {sessionExpiresAt:Math.floor(session.startedAt.getTime()/1000)+12*60*60} : {}),
  }, env.JWT_ACCESS_SECRET, { subject: user.id, expiresIn: env.JWT_ACCESS_EXPIRY as SignOptions['expiresIn'] });
}
export function createRefreshToken() { return randomBytes(48).toString('hex'); }
export function hashToken(token: string) { return createHash('sha256').update(token).digest('hex'); }
function verifiedPayload(token: string): JwtPayload {
  const payload = jwt.verify(token, env.JWT_ACCESS_SECRET);
  if (typeof payload === 'string' || !payload.sub) throw new Error('invalid_token');
  return payload;
}
export function verifyAccessToken(token: string): JwtPayload & { sessionScope: SessionScope; sessionId?:string } {
  const payload = verifiedPayload(token);
  if (payload.tokenType !== undefined) throw new Error('invalid_access_token_type');
  if (payload.sessionScope !== undefined && payload.sessionScope !== 'app' && payload.sessionScope !== 'staff') throw new Error('invalid_session_scope');
  if(typeof payload.iat!=='number'||typeof payload.exp!=='number')throw new Error('missing_token_lifetime');
  if(payload.sessionId!==undefined && (typeof payload.sessionId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.sessionId)))throw new Error('invalid_session_id');
  if(payload.sessionExpiresAt!==undefined && (typeof payload.sessionExpiresAt!=='number'||payload.sessionExpiresAt<=Date.now()/1000))throw new Error('session_expired');
  if(!payload.sessionId && payload.iat+15*60<=Date.now()/1000)throw new Error('legacy_access_expired');
  // Older tokens have customer access only; staff must sign in again.
  return { ...payload, sessionScope: payload.sessionScope ?? 'app' };
}
export function signPhoneVerificationToken(userId: string) { return jwt.sign({ tokenType: 'phone_verification' }, env.JWT_ACCESS_SECRET, { subject: userId, expiresIn: '10m' }); }
export function verifyPhoneVerificationToken(token: string) {
  const payload = verifiedPayload(token);
  if (payload.tokenType !== 'phone_verification' || !payload.sub) throw new Error('invalid_phone_verification_token');
  return payload.sub;
}
export function signPhoneChangeToken(userId: string, phone: string, otpId: string) {
  return jwt.sign({ tokenType: 'phone_change', phone, otpId }, env.JWT_ACCESS_SECRET, { subject: userId, expiresIn: '5m' });
}
export function verifyPhoneChangeToken(token: string, userId: string) {
  const payload = verifiedPayload(token);
  if (payload.tokenType !== 'phone_change' || payload.sub !== userId || typeof payload.phone !== 'string' || typeof payload.otpId !== 'string') throw new Error('invalid_phone_change_token');
  return { phone: payload.phone, otpId: payload.otpId };
}
```

</details>

## src/modules/auth/otp.service.ts

[Open source](../src/modules/auth/otp.service.ts)

SHA-256: `c211c2c7a9dcffd26cd53e2dc843a1f9c39a149c478f556bd12445c735cd4400`

<details>
<summary>Full TypeScript implementation</summary>

```ts
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import type { PoolClient } from 'pg';
import { env } from '../../config/env';
import { inTransaction } from '../../shared/config/db';
import { ensureRedis } from '../../shared/config/redis';
import { ApiError } from '../../shared/errors';
import type { OtpPurpose } from './auth.types';
import type { OtpProvider } from './otp.provider.interface';
import { TermiiOtpProvider } from './otp.provider.termii';

const provider: OtpProvider = new TermiiOtpProvider();
const digest = (value: string) => createHash('sha256').update(value).digest();

export async function enforceOtpRateLimit(phone: string) {
  const redis = await ensureRedis();
  const cooldownKey = `otp:cooldown:${phone}`;
  const rateKey = `otp:rate:${phone}`;
  const [state, retryAfter] = await redis.eval(`
    if redis.call('EXISTS',KEYS[1])==1 then return {2,math.max(1,redis.call('TTL',KEYS[1]))} end
    local count=tonumber(redis.call('GET',KEYS[2]) or '0')
    if count>=tonumber(ARGV[1]) then return {3,math.max(1,redis.call('TTL',KEYS[2]))} end
    count=redis.call('INCR',KEYS[2])
    if count==1 then redis.call('EXPIRE',KEYS[2],ARGV[2]) end
    redis.call('SET',KEYS[1],'1','EX',ARGV[3])
    return {1,0}
  `, 2, cooldownKey, rateKey, env.OTP_RATE_LIMIT_MAX, env.OTP_RATE_LIMIT_WINDOW_MINUTES * 60, env.OTP_RESEND_COOLDOWN_SECONDS) as [number, number];
  if (state !== 1) throw new ApiError(429, state === 2 ? 'otp_cooldown' : 'otp_rate_limited', { retryAfterSeconds: retryAfter });
}

export async function generateOtp(phone: string, purpose: OtpPurpose, client: PoolClient) {
  await enforceOtpRateLimit(phone);
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const { rows } = await client.query<{ id: string }>(`INSERT INTO otp_codes (phone, code_hash, purpose, expires_at) VALUES ($1,$2,$3,now() + interval '5 minutes') RETURNING id`, [phone, digest(code).toString('hex'), purpose]);
  await provider.send(phone, code);
  return rows[0].id;
}

interface OtpRow {
  id: string;
  code_hash: string;
  attempts: number;
  max_attempts: number;
  expires_at: Date;
  consumed_at: Date | null;
}

// Return validation errors so the transaction can commit the failed attempt.
// Database errors still throw and roll back normally.
async function verifyOtp(phone: string, purpose: OtpPurpose, submitted: string, client: PoolClient, expectedOtpId?: string): Promise<ApiError | null> {
  const { rows } = await client.query<OtpRow>(`SELECT * FROM otp_codes WHERE phone=$1 AND purpose=$2 ORDER BY created_at DESC,id DESC LIMIT 1 FOR UPDATE`, [phone, purpose]);
  const record = rows[0];
  // Never fall back to an older code after the newest code has been consumed.
  if (!record || record.consumed_at) return new ApiError(400, 'otp_not_found');
  if (expectedOtpId && record.id !== expectedOtpId) return new ApiError(400, 'phone_change_challenge_expired');
  if (record.attempts >= record.max_attempts) return new ApiError(429, 'otp_attempts_exceeded');
  await client.query('UPDATE otp_codes SET attempts=attempts+1 WHERE id=$1', [record.id]);
  if (record.expires_at.getTime() <= Date.now()) return new ApiError(400, 'otp_expired');
  const expected = Buffer.from(record.code_hash, 'hex');
  const actual = digest(submitted);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return new ApiError(400, 'otp_invalid');
  await client.query('UPDATE otp_codes SET consumed_at=now() WHERE id=$1', [record.id]);
  return null;
}

/** Owns the transaction: rejected attempts commit, while successful consumption
 * and the protected action commit or roll back together. Do not nest in another transaction. */
export async function withVerifiedOtp<T>(
  phone: string,
  purpose: OtpPurpose,
  submitted: string,
  work: (client: PoolClient) => Promise<T>,
  expectedOtpId?: string,
): Promise<T> {
  const result = await inTransaction(async (client) => {
    const error = await verifyOtp(phone, purpose, submitted, client, expectedOtpId);
    if (error) return { ok: false as const, error };
    return { ok: true as const, value: await work(client) };
  });
  if (!result.ok) throw result.error;
  return result.value;
}
```

</details>

## src/websocket/index.ts

[Open source](../src/websocket/index.ts)

SHA-256: `4fc3b06b156c4fc78817c10474a6107164927bc8c2407689061ce9cd81da916f`

<details>
<summary>Full TypeScript implementation</summary>

```ts
import { createAdapter } from '@socket.io/redis-adapter';
import { ensureRedis } from '../shared/config/redis';
import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { registerSocketHandlers } from './handlers';
import { verifyAccessToken } from '../modules/auth/jwt.service';
import { db } from '../shared/config/db';
import { registerNotificationServer } from './notifications';
import { authenticatedSessionUser } from '../modules/auth/auth.service';

export async function attachWebsocket(server: HttpServer) {
  const connection = await ensureRedis();
  const pub = connection.duplicate({ lazyConnect: true });
  const sub = connection.duplicate({ lazyConnect: true });
  pub.on('error', () => console.error('[socket] Redis publisher unavailable'));
  sub.on('error', () => console.error('[socket] Redis subscriber unavailable'));
  try { await Promise.all([pub.connect(), sub.connect()]); }
  catch (error) { pub.disconnect(); sub.disconnect(); throw error; }
  const io = new Server(server, { cors: { origin: '*' } });
  io.adapter(createAdapter(pub, sub, { key: 'rakky:socket.io', publishOnSpecificResponseChannel: true }));
  server.once('close', () => { pub.disconnect(); sub.disconnect(); });
  registerNotificationServer(io);
  io.use(async(socket,next)=>{try{const token=socket.handshake.auth?.token;if(typeof token!=='string')throw new Error('missing');const payload=verifyAccessToken(token);if(typeof payload.exp!=='number')throw new Error('missing_expiry');const user=await authenticatedSessionUser(payload);if(!user)throw new Error('inactive');socket.data.userId=user.id;socket.data.sessionId=payload.sessionId;socket.data.accessExpiresAt=Math.min(payload.exp,typeof payload.sessionExpiresAt==='number'?payload.sessionExpiresAt:Infinity)*1000;next();}catch{next(new Error('unauthorized'));}});
  io.on('connection', (socket) => {
    if(socket.data.sessionId)socket.join(`session:${socket.data.sessionId}`);
    const expire = setTimeout(() => socket.disconnect(true), Math.max(0, Math.min(2_147_483_647, Number(socket.data.accessExpiresAt) - Date.now())));
    expire.unref();
    let recheck: ReturnType<typeof setTimeout> | undefined;
    const checkAccount = async () => {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const payload=verifyAccessToken(socket.handshake.auth.token);
        const active = await Promise.race([
          authenticatedSessionUser(payload),
          new Promise<never>((_done,reject)=>{timeout=setTimeout(()=>reject(new Error('socket_auth_timeout')),2000);}),
        ]);
        if (!active) throw new Error('inactive');
      } catch { socket.disconnect(true); }
      finally { if(timeout)clearTimeout(timeout); }
      if(socket.connected){recheck=setTimeout(()=>void checkAccount(),2500);recheck.unref();}
    };
    recheck=setTimeout(()=>void checkAccount(),2500);
    recheck.unref();
    socket.once('disconnect',()=>{clearTimeout(expire);if(recheck)clearTimeout(recheck);});
    // Recheck expiry and account revocation before processing every packet.
    socket.use(async (_packet, next) => {
      try {
        const payload=verifyAccessToken(socket.handshake.auth.token);
        const active=await authenticatedSessionUser(payload);
        if(!active)throw new Error('inactive');
        next();
      } catch { next(new Error('unauthorized')); socket.disconnect(true); }
    });
    registerSocketHandlers(io, socket);
  });
  return io;
}
```

</details>

## src/websocket/notifications.ts

[Open source](../src/websocket/notifications.ts)

SHA-256: `a3fc5e01bf775c3dcfe9a46f5bca0f7b17a272c8a3e94e1e77ab405ca7718b12`

<details>
<summary>Full TypeScript implementation</summary>

```ts
import type { Server } from 'socket.io';
import { SOCKET_EVENTS } from './events';

let server:Server|null=null;
export function registerNotificationServer(io:Server) {server=io;}
export function emitWalletUpdated(userId:string) {server?.to(`user:${userId}`).emit(SOCKET_EVENTS.WALLET_UPDATED,{at:Date.now()});}
export function disconnectSessionSockets(sessionId:string) {server?.in(`session:${sessionId}`).disconnectSockets(true);}
export function disconnectAccountSockets(userId:string) {server?.in(`user:${userId}`).disconnectSockets(true);}
```

</details>

## src/modules/auth/google.service.ts

[Open source](../src/modules/auth/google.service.ts)

SHA-256: `765d8a79150c983a953eeeec0df053fd4eea618456e2c23f032a7805bc3dc6f8`

<details>
<summary>Full TypeScript implementation</summary>

```ts
import { OAuth2Client } from 'google-auth-library';
import { env } from '../../config/env';
import { ApiError } from '../../shared/errors';

const client = new OAuth2Client();
export async function verifyStaffGoogleToken(idToken: string, expectedNonce: string) {
  if (!env.GOOGLE_CLIENT_ID_WEB) throw new ApiError(503, 'google_sign_in_not_configured');
  try {
    const ticket = await client.verifyIdToken({ idToken, audience: env.GOOGLE_CLIENT_ID_WEB });
    const profile = ticket.getPayload();
    if (!profile?.sub || !profile.email || profile.email_verified !== true || profile.nonce !== expectedNonce)
      throw new ApiError(401, 'invalid_google_token');
    return profile;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(401, 'invalid_google_token');
  }
}
export async function verifyGoogleToken(idToken: string) {
  const audience = [env.GOOGLE_CLIENT_ID_IOS, env.GOOGLE_CLIENT_ID_ANDROID, env.GOOGLE_CLIENT_ID_WEB].filter(Boolean);
  if (!audience.length) throw new ApiError(503, 'google_sign_in_not_configured');
  const ticket = await client.verifyIdToken({ idToken, audience });
  const payload = ticket.getPayload();
  if (!payload?.sub || !payload.email || !payload.name || payload.email_verified !== true) throw new ApiError(401, 'invalid_google_token');
  return payload;
}
```

</details>

## src/modules/auth/admin.routes.ts

[Open source](../src/modules/auth/admin.routes.ts)

SHA-256: `76f850ea360b1d5c166536281ad9147c938259325a0533975b51002ea68efe86`

<details>
<summary>Full TypeScript implementation</summary>

```ts
import {
  getAdminHealth,
  getAdminTeam,
  getAdminEnvironment,
} from "./admin.service";
import { Router } from "express";
import { adminQuery } from "../../shared/utils/adminQuery";
import { requireAuth, requireStaffRole } from "./auth.middleware";
import {
  adminPeopleList,
  adminPersonDetail,
  adminPersonUpdate,
  adminRecordSearch,
} from "./admin.controller";
export const peopleAdminRouter = Router();
peopleAdminRouter.use(requireAuth, requireStaffRole("admin", "super_admin"));
peopleAdminRouter.use((_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
peopleAdminRouter.post("/search", adminRecordSearch);
peopleAdminRouter.get("/users", adminPeopleList(false));
peopleAdminRouter.get("/users/:id", adminPersonDetail);
peopleAdminRouter.patch(
  "/users/:id",
  requireStaffRole("super_admin"),
  adminPersonUpdate,
);
peopleAdminRouter.get("/drivers", adminPeopleList(true));
peopleAdminRouter.get("/drivers/:id", adminPersonDetail);
peopleAdminRouter.get("/driver-applications", adminPeopleList(true));

peopleAdminRouter.get("/health", async (_req, res, next) => {
  try {
    res.json(await getAdminHealth());
  } catch (error) {
    next(error);
  }
});

peopleAdminRouter.get(
  "/team",
  requireStaffRole("super_admin"),
  async (req, res, next) => {
    try {
      res.json(
        await getAdminTeam(adminQuery(req.query, ["admin", "super_admin"])),
      );
    } catch (error) {
      next(error);
    }
  },
);

peopleAdminRouter.get("/environment", (_req, res) =>
  res.json(getAdminEnvironment()),
);
```

</details>

## src/modules/auth/admin.controller.ts

[Open source](../src/modules/auth/admin.controller.ts)

SHA-256: `ce99105181eeeba2738e061eac5f6d3f59219ec0874e0e778822e989fcef01e6`

<details>
<summary>Full TypeScript implementation</summary>

```ts
import type { Request, Response, NextFunction } from "express";
import { ApiError } from "../../shared/errors";
import { adminId, adminQuery } from "../../shared/utils/adminQuery";
import {
  getAdminPerson,
  listAdminPeople,
  updateAdminPerson,
} from "./admin.service";
export const adminPeopleList =
  (driversOnly: boolean) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const query = adminQuery(
        req.query,
        ["pending", "approved", "rejected"],
        ["active", "inactive"],
      );
      if (query.service) throw new ApiError(400, "unsupported_filter");
      res.json(await listAdminPeople(query, driversOnly));
    } catch (error) {
      next(error);
    }
  };
export async function adminPersonDetail(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    res.json(await getAdminPerson(adminId(req.params.id), req.userId!));
  } catch (error) {
    next(error);
  }
}

export async function adminRecordSearch(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const { parseStaffSearch } =
      await import("../../shared/utils/adminSearch.js");
    const { searchStaffRecords } = await import("./admin.service.js");
    res.json(
      await searchStaffRecords(
        parseStaffSearch(req.body),
        req.userId!,
        req.authUser!.role,
      ),
    );
  } catch (error) {
    next(error);
  }
}
export async function adminPersonUpdate(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    res.json(
      await updateAdminPerson(req.userId!, adminId(req.params.id), req.body),
    );
  } catch (error) {
    next(error);
  }
}
```

</details>

## src/modules/auth/admin.service.ts

[Open source](../src/modules/auth/admin.service.ts)

SHA-256: `2551c273fa23135e0ff40aa11e765328eb0fef84085b117aa0740471dd230fcd`

<details>
<summary>Full TypeScript implementation</summary>

```ts
import { readAdminRows } from "../../shared/utils/adminPagination";
import { staffSearchRows } from "../../shared/utils/adminSearch";
import {
  auditInput,
  recordAdminRead,
  replayAdminOperation,
} from "../../shared/utils/adminAudit";
import { env } from "../../config/env";
import { db, inTransaction } from "../../shared/config/db";
import {
  adminPage,
  maskedEmail,
  maskedPhone,
  type AdminQuery,
} from "../../shared/utils/adminQuery";
import { ApiError } from "../../shared/errors";
import { assertDriverMaterialEditable } from '../driver/driver.service';
import { disconnectAccountSockets } from '../../websocket/notifications';
interface PersonRow {
  id: string;
  _cursor: string;
  name: string;
  platformRole: string;
  version: string;
  phone: string | null;
  email: string | null;
  joinedAt: Date;
  active: boolean;
  trips: string;
  driver: Record<string, unknown> | null;
}
let acceptingTraffic = false;
export function setServerReadiness(ready: boolean) { acceptingTraffic = ready; }
/** Public probe returns only readiness, never credentials or operational diagnostics. */
export async function serverReady() {
  if (!acceptingTraffic) return false;
  const { tripWorkersReady,tripQueuesAccepting } = await import('../trips/tripQueue.js');
  const { paymentWorkersReady,paymentQueueAccepting } = await import('../payments/paymentQueue.js');
  const { ensureRedis } = await import('../../shared/config/redis.js');
  if (!tripWorkersReady() || !paymentWorkersReady()) return false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const databaseProbe = { text: 'SELECT 1', query_timeout: 2000 };
  try {
    const checks=await Promise.race([
      Promise.all([db.query(databaseProbe), ensureRedis().then(client => client.ping()),tripQueuesAccepting(),paymentQueueAccepting()]),
      new Promise<never>((_done, reject) => { timer = setTimeout(() => reject(new Error('readiness_timeout')), 2500); }),
    ]);
    return acceptingTraffic && tripWorkersReady() && paymentWorkersReady() && checks[2] && checks[3];
  } catch { return false; }
  finally { if (timer) clearTimeout(timer); }
}
const personProjection = `u.id,u.full_name AS name,u.role AS "platformRole",u.updated_at::text AS version,u.phone,u.email,u.created_at AS "joinedAt",u.is_active AS active,u.created_at::text AS _cursor,
 (SELECT COUNT(*)::text FROM trips t WHERE t.rider_id=u.id OR t.driver_id=u.id) AS trips,
 CASE WHEN d.user_id IS NOT NULL AND d.status<>'none' THEN json_build_object('status',d.status,'vehicle',concat_ws(' ',d.vehicle_make,d.vehicle_model,d.vehicle_color),'plate',d.plate_number,'courierOptIn',d.accepts_courier,'availability','unknown','locationAt',NULL,'rating',CASE WHEN u.rating_count>0 THEN u.rating_avg ELSE NULL END,'ratingCount',u.rating_count,'submittedAt',d.submitted_at,'updatedAt',d.updated_at,'rejectionReason',d.rejection_reason,'activeTripId',(SELECT t.id FROM trips t WHERE t.driver_id=u.id AND t.status IN ('driver_assigned','driver_arrived','in_progress','returning') ORDER BY t.requested_at DESC LIMIT 1),'activeRole',u.active_role,'payoutAccounts',(SELECT COALESCE(json_agg(json_build_object('bank',p.bank_name,'last4',p.account_last4,'active',p.is_active)),'[]') FROM payout_accounts p WHERE p.user_id=u.id AND p.is_active=true)) ELSE NULL END AS driver`;
function publicPerson(row: PersonRow) {
  const { phone, email, ...person } = row;
  return {
    ...person,
    trips: Number(person.trips),
    phoneMasked: maskedPhone(phone),
    emailMasked: maskedEmail(email),
  };
}
export async function listAdminPeople(query: AdminQuery, driversOnly = false) {
  const { rows, ...paging } = await readAdminRows<PersonRow>(
    {
      select: `SELECT ${personProjection} FROM users u LEFT JOIN driver_profiles d ON d.user_id=u.id
 WHERE (NOT $1::boolean OR d.status IN ('pending','approved','rejected')) AND ($2::text IS NULL OR d.status::text=$2)
 AND ($7::text IS NULL OR u.is_active=($7='active')) AND ($3::uuid IS NULL OR u.id=$3) AND ($4::timestamptz IS NULL OR (u.created_at,u.id)<($4::timestamptz,$5::uuid))`,
      orderBy: `u.created_at DESC,u.id DESC`,
      limitParameter: 6,
    },
    [
      driversOnly,
      query.status,
      query.id,
      query.cursor?.at ?? null,
      query.cursor?.id ?? null,
      query.limit + 1,
      query.mode,
    ],
    query,
  );
  const people=rows.map(publicPerson);
  const {adminDriverPresence}=await import("../location/admin.service.js");
  const presence=await adminDriverPresence(people.filter(p=>p.driver).map(p=>p.id));
  return adminPage(people.map(p=>({...p,driver:p.driver ? {...p.driver,...presence.get(p.id),...(p.driver.activeTripId ? {availability:"busy",presenceReason:"Assigned to an active trip"}:{} )}:null})),query,"users.created_at",paging);
}
export async function getAdminPerson(id: string, actorId: string) {
  const { rows } = await db.query<PersonRow>(
    `SELECT ${personProjection} FROM users u LEFT JOIN driver_profiles d ON d.user_id=u.id WHERE u.id=$1`,
    [id],
  );
  if (!rows[0]) throw new ApiError(404, "user_not_found");
  const { _cursor, ...person } = publicPerson(rows[0]);
  const {adminDriverPresence}=await import("../location/admin.service.js");
  const presence=person.driver ? (await adminDriverPresence([id])).get(id):undefined;
  const accounts = (
    await db.query(
      `SELECT id,kind,balance_kobo::text AS "balanceKobo",is_frozen AS frozen FROM ledger_accounts WHERE owner_user_id=$1 ORDER BY kind,id`,
      [id],
    )
  ).rows;
  await recordAdminRead(actorId, "person_context_read", "user", id);
  return {
    ...person,
    driver:person.driver ? {...person.driver,...presence,...(person.driver.activeTripId ? {availability:"busy",presenceReason:"Assigned to an active trip"}:{} )}:null,
    accounts,
    asOf: new Date().toISOString(),
    allowedActions: [],
  };
}

export async function updateAdminPerson(
  actorId: string,
  id: string,
  input: Record<string, unknown>,
) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new ApiError(400, "invalid_person_update");
  const audit = auditInput(input.reason, input.requestKey);
  if (
    Object.keys(input).some(
      (key) =>
        !["name", "active", "expectedVersion", "reason", "requestKey"].includes(
          key,
        ),
    ) ||
    typeof input.name !== "string" ||
    input.name.trim().length < 2 ||
    input.name.trim().length > 100 ||
    /[\u0000-\u001f]/.test(input.name) ||
    typeof input.active !== "boolean" ||
    typeof input.expectedVersion !== "string"
  )
    throw new ApiError(400, "invalid_person_update");
  const name = input.name.trim();
  const result=await inTransaction(async (client) => {
    const operation = await replayAdminOperation(
      client,
      actorId,
      "person_update",
      audit.requestKey,
      {
        id,
        name,
        active: input.active,
        expectedVersion: input.expectedVersion,
        reason: audit.reason,
      },
      ["super_admin"],
    );
    const before = (
      await client.query<{
        name: string;
        active: boolean;
        role: string;
        version: string;
      }>(
        "SELECT full_name AS name,is_active AS active,role,updated_at::text AS version FROM users WHERE id=$1 FOR UPDATE",
        [id],
      )
    ).rows[0];
    if (!before) throw new ApiError(404, "user_not_found");
    if (operation.previous)
      return { id, ...before, auditId: operation.previous.id };
    if (["admin", "super_admin"].includes(before.role))
      throw new ApiError(403, "staff_accounts_require_access_management");
    if (before.version !== input.expectedVersion)
      throw new ApiError(409, "person_changed");
    if(name!==before.name)await assertDriverMaterialEditable(id,client);
    if (
      !input.active &&
      (
        await client.query(
          `SELECT id FROM trips WHERE (rider_id=$1 OR driver_id=$1) AND status IN ('scheduled','searching','driver_assigned','driver_arrived','in_progress','returning') LIMIT 1`,
          [id],
        )
      ).rowCount
    )
      throw new ApiError(409, "account_has_active_trip");
    const after = (
      await client.query<{ name: string; active: boolean; version: string }>(
        "UPDATE users SET full_name=$2,is_active=$3,updated_at=now() WHERE id=$1 RETURNING full_name AS name,is_active AS active,updated_at::text AS version",
        [id, name, input.active],
      )
    ).rows[0];
    const saved = (
      await client.query<{ id: string }>(
        `INSERT INTO admin_audit_log(actor_id,action,request_key,reason,object_type,object_id,metadata) VALUES($1,'person_update',$2,$3,'user',$4,$5) RETURNING id::text`,
        [
          actorId,
          audit.requestKey,
          audit.reason,
          id,
          { operationHash: operation.hash, before, after },
        ],
      )
    ).rows[0];
    return { id, ...after, auditId: saved.id };
  });
  if(!input.active)disconnectAccountSockets(id);
  return result;
}

export async function getAdminHealth() {
  const { ensureRedis } = await import("../../shared/config/redis.js");
  const check = async (name: string, run: () => Promise<unknown>) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();
    try {
      await Promise.race([
        run(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error("timed_out")), 3000);
        }),
      ]);
      return {
        name,
        state: "reachable",
        latencyMs: Date.now() - started,
        observedAt: new Date().toISOString(),
      };
    } catch {
      return {
        name,
        state: "unavailable",
        latencyMs: null,
        observedAt: new Date().toISOString(),
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
  const checks = await Promise.all([
    check("PostgreSQL", () => db.query("SELECT 1")),
    check("Redis", async () => {
      const client = await ensureRedis();
      return client.ping();
    }),
  ]);
  const {getTripQueueHealth}=await import('../trips/tripQueue.js');
  const {getPaymentQueueHealth}=await import('../payments/paymentQueue.js');
  const queues = await Promise.all([getTripQueueHealth(),getPaymentQueueHealth()]);
  let provider: {name:string;state:string;latencyMs:null;observedAt:string|null;details:string} = {name:'Paystack',state:'unknown',latencyMs:null,observedAt:null,details:'No recent provider request observed'};
  try {
    const redis = await ensureRedis();
    const value = await redis.get('rakky:health:paystack');
    if(value) {const observation=JSON.parse(value) as {state:string;observedAt:string};provider={...provider,...observation,details:'Last actual provider request; observation retained for 24 hours'};}
  } catch { /* Redis dependency check reports the failure. */ }
  return {checks:[...checks,...queues[0],queues[1],provider],asOf:new Date().toISOString(),coverage:'Live dependency checks and worker heartbeats (90-second freshness). Queue counts include retained historical failures; successful/failed job observations expire after 24 hours. A heartbeat does not guarantee every job succeeded. Paystack reflects the last actual API request.'};
}

export async function getAdminTeam(query: AdminQuery) {
  if (query.service || query.mode)
    throw new ApiError(400, "unsupported_filter");
  const { rows, ...paging } = await readAdminRows<{
    id: string;
    _cursor: string;
    name: string;
    role: string;
    active: boolean;
    createdAt: Date;
  }>(
    {
      select: `SELECT id,full_name AS name,role,is_active AS active,created_at AS "createdAt",created_at::text AS _cursor FROM users WHERE role IN ('admin','super_admin') AND ($1::uuid IS NULL OR id=$1) AND ($2::text IS NULL OR role::text=$2) AND ($3::timestamptz IS NULL OR (created_at,id)<($3::timestamptz,$4::uuid))`,
      orderBy: `created_at DESC,id DESC`,
      limitParameter: 5,
    },
    [
      query.id,
      query.status,
      query.cursor?.at ?? null,
      query.cursor?.id ?? null,
      query.limit + 1,
    ],
    query,
  );
  return {
    ...adminPage(rows, query, "created_at", paging),
    readOnly: true,
    coverage:
      "Existing staff roles only. Provisioning, scope grants, and step-up policy require an owner decision.",
  };
}

export function getAdminEnvironment() {
  const paymentEnvironment = env.PAYSTACK_SECRET_KEY.startsWith("sk_live_")
    ? "live"
    : env.PAYSTACK_SECRET_KEY.startsWith("sk_test_")
      ? "test"
      : "unconfigured";
  return {
    nodeEnvironment: env.NODE_ENV,
    paymentEnvironment,
    basis:
      "Configured provider key mode; not a provider availability observation.",
  };
}

async function searchAdminPeople(
  input: import("../../shared/utils/adminSearch").SearchRead,
): Promise<import("../../shared/utils/adminSearch").StaffSearchHit[]> {
  const rows = await staffSearchRows<{
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    driver: boolean;
  }>(
    `SELECT u.id,u.full_name AS name,u.phone,u.email,(d.status IN ('pending','approved','rejected')) AS driver FROM users u LEFT JOIN driver_profiles d ON d.user_id=u.id WHERE (u.id::text=$1 OR lower(u.full_name) LIKE $2 ESCAPE '!' OR u.phone=$3 OR lower(u.email)=$1 OR lower(d.plate_number)=$1) AND ($4::uuid IS NULL OR u.id>$4) ORDER BY u.id LIMIT $5`,
    [
      input.query.toLowerCase(),
      input.prefix,
      input.query,
      input.after?.id ?? null,
      input.limit + 1,
    ],
  );
  return rows.map((row) => ({
    id: row.id,
    type: "person",
    title: row.name,
    subtitle: `${maskedPhone(row.phone)} · ${maskedEmail(row.email)}`,
    href: `/admin/${row.driver ? "drivers" : "riders"}/${row.id}`,
  }));
}
export async function searchStaffRecords(
  input: import("../../shared/utils/adminSearch").SearchRead,
  actorId: string,
  role: string,
) {
  if (!["admin", "super_admin"].includes(role))
    throw new ApiError(403, "insufficient_permissions");
  if (input.scope === "safety" && role !== "super_admin")
    throw new ApiError(403, "insufficient_permissions");
  const { ensureRedis } = await import("../../shared/config/redis.js");
  try {
    const redis = await ensureRedis();
    const [count, ttl] = (await redis.eval(
      `local count=redis.call('INCR',KEYS[1]); if count==1 then redis.call('EXPIRE',KEYS[1],60) end; return {count,redis.call('TTL',KEYS[1])}`,
      1,
      `rakky:admin-search:${actorId}`,
    )) as [number, number];
    if (count > 30)
      throw new ApiError(429, "staff_search_rate_limited", {
        retryAfterSeconds: Math.max(1, ttl),
      });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(503, "staff_search_unavailable");
  }
  const { searchAdminTrips } = await import("../trips/admin.service.js");
  const { searchAdminFinance } =
    await import("../payments/dashboard.service.js");
  const { searchAdminCare } = await import("../care/care.service.js");
  const { staffSearchPage } = await import("../../shared/utils/adminSearch.js");
  const include = (scope: string) =>
    input.scope === "all" || input.scope === scope;
  const queries = [];
  if (include("people"))
    queries.push(
      searchAdminPeople(input).then((rows) =>
        staffSearchPage("people", "People", rows, input),
      ),
    );
  if (include("trips"))
    queries.push(
      searchAdminTrips(input).then((rows) =>
        staffSearchPage("trips", "Trips", rows, input),
      ),
    );
  if (include("finance"))
    queries.push(
      searchAdminFinance(input).then((rows) =>
        staffSearchPage("finance", "Money records", rows, input),
      ),
    );
  if (include("support"))
    queries.push(
      searchAdminCare("support", input).then((rows) =>
        staffSearchPage("support", "Support cases", rows, input),
      ),
    );
  if (role === "super_admin" && include("safety"))
    queries.push(
      searchAdminCare("safety", input).then((rows) =>
        staffSearchPage("safety", "Safety incidents", rows, input),
      ),
    );
  const groups = await Promise.all(queries);
  // Query text, contact identifiers, and result names are never persisted in the audit.
  await recordAdminRead(
    actorId,
    "staff_record_search",
    groups.some((group) => group.scope === "safety")
      ? "safety"
      : "staff_search",
    null,
    { scope: input.scope },
  );
  return { groups, asOf: new Date().toISOString(), limitPerGroup: input.limit };
}
```

</details>

## src/modules/trips/admin.routes.ts

[Open source](../src/modules/trips/admin.routes.ts)

SHA-256: `b134f4daed869516dced5e7ffa67449116d0d66c8fa1aac83c4eb2f5a34e4ea8`

<details>
<summary>Full TypeScript implementation</summary>

```ts
import { exportAdminReports, reportRange } from "./admin.service";
import { Router } from "express";
import { requireAuth, requireStaffRole } from "../auth/auth.middleware";
import {
  adminReports,
  adminPricing,
  adminPricingUpdate,
  adminScheduleUpdate,
  adminRatings,
  adminOverview,
  adminTripDetail,
  adminTripPosition,
  adminTripList,
} from "./admin.controller";
export const tripAdminRouter = Router();
tripAdminRouter.use(requireAuth, requireStaffRole("admin", "super_admin"));
tripAdminRouter.use((_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
tripAdminRouter.get("/overview", adminOverview);
tripAdminRouter.get("/trips", adminTripList);
tripAdminRouter.get("/trips/:id", adminTripDetail);
tripAdminRouter.post(
  "/trips/:id/schedule",
  requireStaffRole("super_admin"),
  adminScheduleUpdate,
);
tripAdminRouter.get("/trips/:id/location", adminTripPosition);

tripAdminRouter.get("/reports", adminReports);
tripAdminRouter.get("/pricing", adminPricing);
tripAdminRouter.patch(
  "/pricing/:vehicleType",
  requireStaffRole("super_admin"),
  adminPricingUpdate,
);
tripAdminRouter.get("/ratings", adminRatings);

tripAdminRouter.get("/reports/export", async (req, res, next) => {
  try {
    res
      .set({
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": "attachment; filename=rakky-report.csv",
      })
      .send(await exportAdminReports(req.userId!, reportRange(req.query)));
  } catch (error) {
    next(error);
  }
});
```

</details>

## src/modules/trips/admin.controller.ts

[Open source](../src/modules/trips/admin.controller.ts)

SHA-256: `30e9f48c287145f9858e360d4b84a5cb01bc8a90e4c20c9c965194276777d3ed`

<details>
<summary>Full TypeScript implementation</summary>

```ts
import type { Request, Response, NextFunction } from "express";
import { adminId, adminQuery } from "../../shared/utils/adminQuery";
import {
  adminTripStatuses,
  parseAdminTripQuery,
  getAdminOverview,
  getAdminTrip,
  getAdminTripPosition,
  listAdminTrips,
} from "./admin.service";
export async function adminTripList(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    res.json(await listAdminTrips(parseAdminTripQuery(req.query)));
  } catch (error) {
    next(error);
  }
}
export async function adminTripDetail(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    res.json(await getAdminTrip(adminId(req.params.id), req.userId!));
  } catch (error) {
    next(error);
  }
}
export async function adminOverview(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    if (
      Object.keys(req.query).some((k) => k !== "day") ||
      (req.query.day !== undefined && typeof req.query.day !== "string")
    )
      throw new (await import("../../shared/errors.js")).ApiError(
        400,
        "invalid_overview_filter",
      );
    res.json(
      await getAdminOverview(
        req.authUser!.role,
        req.query.day as string | undefined,
      ),
    );
  } catch (error) {
    next(error);
  }
}

export async function adminReports(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const { getAdminReports, reportRange } = await import("./admin.service.js");
    res.json(await getAdminReports(reportRange(req.query)));
  } catch (error) {
    next(error);
  }
}
export async function adminPricing(
  _req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const { getAdminPricing } = await import("./admin.service.js");
    res.json(await getAdminPricing());
  } catch (error) {
    next(error);
  }
}
export async function adminPricingUpdate(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const { updateAdminPricing } = await import("./admin.service.js");
    res.json(
      await updateAdminPricing(
        req.userId!,
        String(req.params.vehicleType),
        req.body,
      ),
    );
  } catch (error) {
    next(error);
  }
}
export async function adminScheduleUpdate(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const { updateAdminSchedule } = await import("./admin.service.js");
    res.json(
      await updateAdminSchedule(req.userId!, adminId(req.params.id), req.body),
    );
  } catch (error) {
    next(error);
  }
}
export async function adminRatings(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const { listAdminRatings } = await import("./admin.service.js");
    res.json(await listAdminRatings(adminQuery(req.query)));
  } catch (error) {
    next(error);
  }
}

export async function adminTripPosition(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    res.json(await getAdminTripPosition(adminId(req.params.id), req.userId!));
  } catch (error) {
    next(error);
  }
}
```

</details>

## src/modules/trips/admin.service.ts

[Open source](../src/modules/trips/admin.service.ts)

SHA-256: `bafc1af8d4fac2f9eeeeeeab7caa95029de6a96a46cdce82b00a0563a26c7b26`

<details>
<summary>Full TypeScript implementation</summary>

```ts
import { readAdminRows } from "../../shared/utils/adminPagination";
import { staffSearchRows } from "../../shared/utils/adminSearch";
import { adminDriverPosition } from "../location/admin.service";
import {
  auditInput,
  recordAdminRead,
  replayAdminOperation,
} from "../../shared/utils/adminAudit";
import { createHash } from "node:crypto";
import { db, inTransaction } from "../../shared/config/db";
import { ApiError } from "../../shared/errors";
import { transitionTrip } from "./tripStateMachine";
import type { TripRow } from "./trip.types";
import { releaseTripHold } from "../payments/tripPayments.service";
import { emitTripStatus } from "./tripSocket";
import { emitWalletUpdated } from "../../websocket/notifications";
import {
  adminPage,
  adminId,
  adminQuery,
  type AdminQuery,
} from "../../shared/utils/adminQuery";
export const adminTripStatuses = [
  "scheduled",
  "searching",
  "driver_assigned",
  "driver_arrived",
  "in_progress",
  "completed",
  "cancelled",
  "no_drivers_found",
  "returning",
  "returned",
] as const;
const tripProjection = `t.id,t.service_type AS service,t.status,t.pickup_address AS pickup,t.dropoff_address AS destination,
 t.rider_id AS "riderId",r.full_name AS "riderName",t.driver_id AS "driverId",d.full_name AS "driverName",
 t.requested_at AS "requestedAt",t.scheduled_at AS "scheduledAt",t.updated_at AS "updatedAt",t.updated_at::text AS version,
 t.payment_method AS "paymentMethod",t.payment_status AS "paymentStatus",t.fare_kobo::text AS "fareKobo",'NGN' AS currency,
 NULL AS "locationAt",'[]'::json AS timeline,'[]'::json AS "allowedActions",
 CASE WHEN t.service_type='courier' THEN json_build_object('recipientMasked','Contact restricted','weightKg',t.courier_details->'weightKg','failedAttempts',t.delivery_attempts,'resets',t.delivery_reset_count,'returnReason',t.delivery_issue_reason) ELSE NULL END AS courier`;
interface TripRead {
  id: string;
  _cursor: string;
  [key: string]: unknown;
}

export async function updateAdminSchedule(
  actorId: string,
  tripId: string,
  input: Record<string, unknown>,
) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new ApiError(400, "invalid_schedule_update");
  const audit = auditInput(input.reason, input.requestKey);
  if (
    Object.keys(input).some(
      (key) =>
        ![
          "action",
          "scheduledAt",
          "expectedVersion",
          "reason",
          "requestKey",
        ].includes(key),
    ) ||
    !["cancel", "reschedule"].includes(String(input.action)) ||
    typeof input.expectedVersion !== "string"
  )
    throw new ApiError(400, "invalid_schedule_update");
  let scheduledAt: Date | undefined;
  if (input.action === "reschedule") {
    if (
      typeof input.scheduledAt !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(
        input.scheduledAt,
      )
    )
      throw new ApiError(400, "invalid_scheduled_time");
    scheduledAt = new Date(input.scheduledAt);
    if (!Number.isFinite(scheduledAt.getTime()))
      throw new ApiError(400, "invalid_scheduled_time");
  } else if (input.scheduledAt !== undefined)
    throw new ApiError(400, "invalid_schedule_update");
  const result = await inTransaction(async (client) => {
    const operation = await replayAdminOperation(
      client,
      actorId,
      "schedule_update",
      audit.requestKey,
      { tripId, ...input, reason: audit.reason },
      ["super_admin"],
    );
    const rider = (
      await client.query<{ rider_id: string }>(
        "SELECT rider_id FROM trips WHERE id=$1",
        [tripId],
      )
    ).rows[0];
    if (!rider) throw new ApiError(404, "trip_not_found");
    await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
      rider.rider_id,
    ]);
    const before = (
      await client.query<TripRow & { version: string }>(
        "SELECT *,updated_at::text AS version FROM trips WHERE id=$1 FOR UPDATE",
        [tripId],
      )
    ).rows[0];
    if (operation.previous)
      return { trip: before, auditId: operation.previous.id };
    if (scheduledAt) {
      const delay = scheduledAt.getTime() - Date.now();
      if (delay < 30 * 60_000 || delay > 7 * 86400_000)
        throw new ApiError(400, "scheduled_time_out_of_range");
    }
    if (before.version !== input.expectedVersion)
      throw new ApiError(409, "trip_changed");
    if (before.status !== "scheduled" || before.service_type !== "ride")
      throw new ApiError(409, "schedule_already_dispatched");
    let after: TripRow;
    if (scheduledAt) {
      const overlapping = await client.query(
        `SELECT id FROM trips WHERE rider_id=$1 AND id<>$2 AND status='scheduled' AND scheduled_at<$3 AND scheduled_at+(estimated_duration_s*interval '1 second')+interval '30 minutes'>$4 LIMIT 1`,
        [
          before.rider_id,
          tripId,
          new Date(
            scheduledAt.getTime() +
              before.estimated_duration_s * 1000 +
              30 * 60_000,
          ),
          scheduledAt,
        ],
      );
      if (overlapping.rowCount)
        throw new ApiError(409, "scheduled_trip_overlaps_existing");
      after = (
        await client.query<TripRow>(
          "UPDATE trips SET scheduled_at=$2,updated_at=now() WHERE id=$1 RETURNING *",
          [tripId, scheduledAt],
        )
      ).rows[0];
    } else {
      after = await transitionTrip(client, {
        tripId,
        from: "scheduled",
        to: "cancelled",
        actorId,
        actorType: "system",
        fields: {
          cancelled_by: "system",
          cancel_reason: audit.reason.slice(0, 200),
          cancelled_at: new Date(),
        },
        metadata: { staffAction: true, reason: audit.reason },
      });
      await releaseTripHold(client, before);
      if (before.payment_status === "held") after.payment_status = "released";
    }
    const saved = (
      await client.query<{ id: string }>(
        `INSERT INTO admin_audit_log(actor_id,action,request_key,reason,object_type,object_id,metadata) VALUES($1,'schedule_update',$2,$3,'trip',$4,$5) RETURNING id::text`,
        [
          actorId,
          audit.requestKey,
          audit.reason,
          tripId,
          {
            operationHash: operation.hash,
            action: input.action,
            before: { status: before.status, scheduledAt: before.scheduled_at },
            after: { status: after.status, scheduledAt: after.scheduled_at },
          },
        ],
      )
    ).rows[0];
    return { trip: after, auditId: saved.id };
  });
  emitTripStatus(result.trip);
  if (result.trip.payment_status === "released")
    emitWalletUpdated(result.trip.rider_id);
  return {
    id: tripId,
    status: result.trip.status,
    scheduledAt: result.trip.scheduled_at,
    auditId: result.auditId,
  };
}
export interface TripAdminQuery extends AdminQuery {
  riderId: string | null;
  driverId: string | null;
  paymentMethod: string | null;
  paymentStatus: string | null;
  order: "asc" | "desc";
  dateBasis: string;
  from: string | null;
  to: string | null;
}
export function parseAdminTripQuery(
  input: Record<string, unknown>,
): TripAdminQuery {
  const base: Record<string, unknown> = {},
    extra = new Set([
      "riderId",
      "driverId",
      "paymentMethod",
      "paymentStatus",
      "order",
      "dateBasis",
      "from",
      "to",
    ]);
  for (const [key, value] of Object.entries(input))
    if (!extra.has(key)) base[key] = value;
  const q = adminQuery(base, adminTripStatuses, [
    "live",
    "scheduled",
    "scheduled_history",
    "courier_exceptions",
  ]);
  const option = (
    key: string,
    allowed: readonly string[],
    fallback: string | null = null,
  ) => {
    const value = input[key];
    if (value === undefined || value === "") return fallback;
    if (typeof value !== "string" || !allowed.includes(value))
      throw new ApiError(400, "invalid_trip_filter");
    return value;
  };
  const date = (key: string) => {
    const value = input[key];
    if (value === undefined || value === "") return null;
    if (
      typeof value !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T/.test(value) ||
      !Number.isFinite(Date.parse(value))
    )
      throw new ApiError(400, "invalid_trip_date");
    return new Date(value).toISOString();
  };
  const from = date("from"),
    to = date("to");
  if (from && to && Date.parse(to) <= Date.parse(from))
    throw new ApiError(400, "invalid_trip_date_range");
  return {
    ...q,
    order: option("order", ["asc", "desc"], q.mode === "scheduled" ? "asc" : "desc") as "asc" | "desc",
    riderId: input.riderId ? adminId(input.riderId) : null,
    driverId: input.driverId ? adminId(input.driverId) : null,
    paymentMethod: option("paymentMethod", ["cash", "wallet"]),
    paymentStatus: option("paymentStatus", [
      "unpaid",
      "held",
      "settled",
      "released",
    ]),
    dateBasis: option(
      "dateBasis",
      ["requested", "scheduled", "fulfilled"],
      "requested",
    )!,
    from,
    to,
  };
}
export async function listAdminTrips(query: TripAdminQuery) {
  const sortTime =
    query.mode === "scheduled" || query.mode === "scheduled_history"
      ? "COALESCE(t.scheduled_at,t.requested_at)"
      : "t.requested_at";
  const ascending = query.order === "asc";
  const { rows, ...paging } = await readAdminRows<TripRead>(
    {
      select: `SELECT ${tripProjection},${sortTime}::text AS _cursor FROM trips t JOIN users r ON r.id=t.rider_id LEFT JOIN users d ON d.id=t.driver_id
 WHERE ($1::text IS NULL OR t.status::text=$1) AND ($2::text IS NULL OR t.service_type=$2)
 AND ($3::text IS NULL OR ($3='scheduled' AND t.scheduled_at IS NOT NULL AND t.status NOT IN ('completed','returned','cancelled','no_drivers_found')) OR ($3='scheduled_history' AND t.scheduled_at IS NOT NULL) OR ($3='courier_exceptions' AND t.service_type='courier' AND (t.status='returning' OR (t.status='in_progress' AND (t.delivery_attempts>=5 OR t.delivery_reset_count>=2)))) OR ($3='live' AND t.status IN ('searching','driver_assigned','driver_arrived','in_progress','returning')))
 AND ($4::uuid IS NULL OR t.id=$4) AND ($5::timestamptz IS NULL OR (${sortTime},t.id)${ascending ? ">" : "<"}($5::timestamptz,$6::uuid))
 AND ($8::uuid IS NULL OR t.rider_id=$8) AND ($9::uuid IS NULL OR t.driver_id=$9)
 AND ($10::text IS NULL OR t.payment_method::text=$10) AND ($11::text IS NULL OR t.payment_status=$11)
 AND ($13::timestamptz IS NULL OR (CASE $12 WHEN 'scheduled' THEN t.scheduled_at WHEN 'fulfilled' THEN COALESCE(t.returned_at,t.completed_at) ELSE t.requested_at END)>=$13)
 AND ($14::timestamptz IS NULL OR (CASE $12 WHEN 'scheduled' THEN t.scheduled_at WHEN 'fulfilled' THEN COALESCE(t.returned_at,t.completed_at) ELSE t.requested_at END)<$14)`,
      orderBy: `${sortTime} ${ascending ? "ASC" : "DESC"},t.id ${ascending ? "ASC" : "DESC"}`,
      limitParameter: 7,
    },
    [
      query.status,
      query.service,
      query.mode,
      query.id,
      query.cursor?.at ?? null,
      query.cursor?.id ?? null,
      query.limit + 1,
      query.riderId,
      query.driverId,
      query.paymentMethod,
      query.paymentStatus,
      query.dateBasis,
      query.from,
      query.to,
    ],
    query,
  );
  return {
    ...adminPage(rows, query, "requested_at", paging),
    scope: {
      ...adminPage(rows, query, "requested_at", paging).scope,
      sortBasis: `${query.mode?.startsWith("scheduled") ? "scheduled_at" : "requested_at"} ${query.order}`,
      order: query.order,
      dateBasis: query.dateBasis,
      from: query.from,
      to: query.to,
      paymentMethod: query.paymentMethod,
      paymentStatus: query.paymentStatus,
      riderId: query.riderId,
      driverId: query.driverId,
    },
  };
}
export async function getAdminTrip(id: string, actorId: string) {
  const { rows } = await db.query<TripRead>(
    `SELECT ${tripProjection},t.pickup_lat AS "pickupLat",t.pickup_lng AS "pickupLng",t.dropoff_lat AS "dropoffLat",t.dropoff_lng AS "dropoffLng",t.commission_bps_snapshot AS "commissionBps",t.commission_kobo::text AS "commissionKobo",t.driver_earning_kobo::text AS "driverEarningKobo",t.hold_tx_id AS "holdTransactionId",t.settle_tx_id AS "settleTransactionId",t.estimated_distance_m AS "estimatedDistanceM",t.estimated_duration_s AS "estimatedDurationS",t.cancel_reason AS "cancelReason" FROM trips t JOIN users r ON r.id=t.rider_id LEFT JOIN users d ON d.id=t.driver_id WHERE t.id=$1`,
    [id],
  );
  if (!rows[0]) throw new ApiError(404, "trip_not_found");
  const history = await db.query(
    `SELECT to_status AS status,created_at AS at,actor_type AS actor,metadata->>'reason' AS reason FROM trip_status_history WHERE trip_id=$1 ORDER BY created_at,id`,
    [id],
  );
  const [offers, feedback, cases, refunds, samples, currentPosition] =
    await Promise.all([
      db.query(
        `SELECT o.id,o.status,u.full_name AS driver,o.sent_at AS "sentAt",o.responded_at AS "respondedAt",o.expires_at AS "expiresAt" FROM trip_offers o JOIN users u ON u.id=o.driver_id WHERE o.trip_id=$1 ORDER BY o.sent_at,o.id`,
        [id],
      ),
      db.query(
        `SELECT r.id,r.rating,r.comment,u.full_name AS rater,r.created_at AS "createdAt" FROM trip_ratings r JOIN users u ON u.id=r.rater_id WHERE r.trip_id=$1 ORDER BY r.created_at,r.id`,
        [id],
      ),
      db.query(
        `SELECT id,subject,status FROM support_cases WHERE trip_id=$1 ORDER BY created_at DESC LIMIT 50`,
        [id],
      ),
      db.query(
        `SELECT id,created_at AS "createdAt" FROM ledger_transactions WHERE type='refund' AND reference_type='trip' AND reference_id=$1 ORDER BY created_at,id`,
        [id],
      ),
      db.query<{
        latitude: number;
        longitude: number;
        at: Date;
        total: string;
      }>(
        `SELECT lat AS latitude,lng AS longitude,recorded_at AS at,COUNT(*) OVER()::text AS total FROM trip_locations WHERE trip_id=$1 ORDER BY recorded_at DESC,id DESC LIMIT 200`,
        [id],
      ),
      adminDriverPosition(
        typeof rows[0].driverId === "string" ? rows[0].driverId : null,
        [
          "driver_assigned",
          "driver_arrived",
          "in_progress",
          "returning",
        ].includes(String(rows[0].status)),
      ),
    ]);
  await recordAdminRead(actorId, "trip_context_read", "trip", id);
  return {
    ...rows[0],
    currentPosition,
    sampledPositions: {
      items: samples.rows.map(({ total, ...point }) => point).reverse(),
      total: Number(samples.rows[0]?.total ?? 0),
      limit: 200,
    },
    offers: offers.rows,
    feedback: feedback.rows,
    supportCases: cases.rows,
    refunds: refunds.rows,
    timeline: history.rows,
    asOf: new Date().toISOString(),
  };
}
export async function getAdminOverview(role = "admin", day?: string) {
  if (
    day &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(day) ||
      !Number.isFinite(Date.parse(`${day}T00:00:00+01:00`)) ||
      new Date(`${day}T00:00:00+01:00`).toLocaleDateString("en-CA", {
        timeZone: "Africa/Lagos",
      }) !== day)
  )
    throw new ApiError(400, "invalid_overview_day");
  const today =
    day ??
    new Date().toLocaleDateString("en-CA", {
      timeZone: "Africa/Lagos",
    });
  const from = new Date(`${today}T00:00:00+01:00`).toISOString();
  const to = new Date(new Date(from).getTime() + 86400000).toISOString();
  const { adminAvailableCount } = await import("../location/admin.service.js");
  const [counts, commission, available, attention, hourly] = await Promise.all([
    db.query<{ active: string; completed: string }>(
      `SELECT COUNT(*) FILTER (WHERE status IN ('searching','driver_assigned','driver_arrived','in_progress','returning'))::text AS active,COUNT(*) FILTER (WHERE service_type='ride' AND status='completed' AND completed_at >= $1 AND completed_at < $2)::text AS completed FROM trips`,
      [from, to],
    ),
    db.query<{ total: string }>(
      `SELECT COALESCE(SUM(CASE WHEN e.direction=a.normal_side THEN e.amount_kobo ELSE -e.amount_kobo END),0)::text AS total FROM ledger_entries e JOIN ledger_accounts a ON a.id=e.account_id WHERE a.code='revenue_commission' AND e.created_at >= $1 AND e.created_at < $2`,
      [from, to],
    ),
    adminAvailableCount(),
    db.query<{
      id: string;
      title: string;
      href: string;
      severity: string;
      observedAt: Date;
      detail: string;
    }>(
      `
      SELECT * FROM (
      SELECT id,'Courier return or locked handoff' AS title,'/admin/trips/'||id AS href,'warning' AS severity,updated_at AS "observedAt",status::text AS detail FROM trips WHERE service_type='courier' AND (status='returning' OR (status='in_progress' AND delivery_attempts>=5))
      UNION ALL SELECT id,'Overdue scheduled activation','/admin/trips/'||id,'warning',scheduled_at,'Scheduled booking past activation time' FROM trips WHERE status='scheduled' AND scheduled_at<now()
      UNION ALL SELECT id,'Payment mismatch','/admin/payments/'||id,'danger',updated_at,'Verified amount or currency mismatch' FROM payment_intents WHERE status='mismatch'
      UNION ALL SELECT id,'Unresolved withdrawal','/admin/withdrawals/'||id,'warning',requested_at,'Outcome requires reconciliation' FROM withdrawals WHERE (status='pending' AND requested_at<now()-interval '2 minutes') OR (status='processing' AND updated_at<now()-interval '15 minutes')
      UNION ALL SELECT user_id,'Pending driver application','/admin/applications/'||user_id,'neutral',COALESCE(submitted_at,created_at),'Awaiting review' FROM driver_profiles WHERE status='pending'
      UNION ALL SELECT id,'Safety incident','/admin/safety/'||id,'danger',created_at,'Restricted staff follow-up' FROM safety_incidents WHERE $1='super_admin' AND status IN ('open','acknowledged','responding')
      ) observed ORDER BY CASE severity WHEN 'danger' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,"observedAt",id LIMIT 10`,
      [role],
    ),
    db.query<{
      hour: string;
      rideCompleted: string;
      courierDelivered: string;
      courierReturned: string;
    }>(
      `SELECT to_char(h.hour AT TIME ZONE 'Africa/Lagos','HH24:MI') AS hour,COUNT(t.id) FILTER(WHERE service_type='ride')::text AS "rideCompleted",COUNT(t.id) FILTER(WHERE service_type='courier' AND status='completed')::text AS "courierDelivered",COUNT(t.id) FILTER(WHERE service_type='courier' AND status='returned')::text AS "courierReturned" FROM generate_series($1::timestamptz,$2::timestamptz-interval '1 hour',interval '1 hour') h(hour) LEFT JOIN trips t ON t.status IN ('completed','returned') AND (CASE WHEN t.status='returned' THEN t.returned_at ELSE t.completed_at END)>=h.hour AND (CASE WHEN t.status='returned' THEN t.returned_at ELSE t.completed_at END)<h.hour+interval '1 hour' GROUP BY h.hour ORDER BY h.hour`,
      [from, to],
    ),
  ]);
  return {
    hourly: hourly.rows,
    activeTrips: Number(counts.rows[0].active),
    availableDrivers: available,
    completedRides: Number(counts.rows[0].completed),
    commissionKobo: commission.rows[0].total,
    attention: attention.rows,
    attentionAvailable: true,
    asOf: new Date().toISOString(),
    scope: { dateBasis: "completed_at / ledger posting time", from, to },
    limitations: [
      "Driver counts are unavailable if Redis fails or the scan exceeds 1,000 approved drivers. Attention is derived, without read/unread state.",
    ],
  };
}

export function reportRange(input: Record<string, unknown>) {
  for (const key of Object.keys(input))
    if (!["from", "to", "service"].includes(key))
      throw new ApiError(400, "unsupported_filter");
  const today = new Date().toLocaleDateString("en-CA", {
      timeZone: "Africa/Lagos",
    }),
    defaultFrom = new Date(`${today}T00:00:00+01:00`);
  const from = input.from ?? defaultFrom.toISOString(),
    to = input.to ?? new Date(defaultFrom.getTime() + 86400000).toISOString(),
    service = input.service ?? null;
  if (
    typeof from !== "string" ||
    typeof to !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T/.test(from) ||
    !/^\d{4}-\d{2}-\d{2}T/.test(to) ||
    !Number.isFinite(Date.parse(from)) ||
    !Number.isFinite(Date.parse(to)) ||
    Date.parse(to) <= Date.parse(from) ||
    Date.parse(to) - Date.parse(from) > 90 * 86400000 ||
    (service !== null && service !== "ride" && service !== "courier")
  )
    throw new ApiError(400, "invalid_report_range");
  return {
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
    service: service as "ride" | "courier" | null,
  };
}
export async function getAdminReports(range: ReturnType<typeof reportRange>) {
  const { adminMoneyPeriod } = await import("../payments/dashboard.service.js");
  const [outcomes, value, money,operations,ratings,payments] = await Promise.all([
    db.query<{ service: string; status: string; count: string }>(
      `SELECT service_type AS service,status,COUNT(*)::text AS count FROM trips WHERE requested_at >= $1 AND requested_at < $2 AND ($3::text IS NULL OR service_type=$3) GROUP BY service_type,status ORDER BY service_type,status`,
      [range.from, range.to, range.service],
    ),
    db.query<{ settledValueKobo: string; delivered: string; returned: string }>(
      `SELECT COALESCE(SUM(fare_kobo),0)::text AS "settledValueKobo",COUNT(*) FILTER (WHERE service_type='courier' AND status='completed')::text AS delivered,COUNT(*) FILTER (WHERE service_type='courier' AND status='returned')::text AS returned FROM trips WHERE payment_status='settled' AND status IN ('completed','returned') AND (CASE WHEN status='returned' THEN returned_at ELSE completed_at END) >= $1 AND (CASE WHEN status='returned' THEN returned_at ELSE completed_at END)<$2 AND ($3::text IS NULL OR service_type=$3)`,
      [range.from, range.to, range.service],
    ),
    adminMoneyPeriod(range.from, range.to),
    db.query(`SELECT COUNT(*)::int AS requests,COUNT(*) FILTER(WHERE status='no_drivers_found')::int AS "noDriver",COUNT(*) FILTER(WHERE status='completed')::int AS completed,COUNT(*) FILTER(WHERE status='cancelled')::int AS cancelled,COUNT(*) FILTER(WHERE accepted_at IS NOT NULL)::int AS assigned,ROUND(AVG(EXTRACT(EPOCH FROM accepted_at-requested_at)) FILTER(WHERE accepted_at>=requested_at),1)::text AS "meanAssignmentSeconds",(SELECT COUNT(*)::int FROM trip_offers o JOIN trips t ON t.id=o.trip_id WHERE t.requested_at>=$1 AND t.requested_at<$2 AND ($3::text IS NULL OR t.service_type=$3)) AS offers FROM trips WHERE requested_at>=$1 AND requested_at<$2 AND ($3::text IS NULL OR service_type=$3)`,[range.from,range.to,range.service]),
    db.query(`SELECT COUNT(*)::int AS count,ROUND(AVG(r.rating),2)::text AS average,COUNT(*) FILTER(WHERE r.rating<=2)::int AS "lowRatings" FROM trip_ratings r JOIN trips t ON t.id=r.trip_id WHERE r.created_at>=$1 AND r.created_at<$2 AND ($3::text IS NULL OR t.service_type=$3)`,[range.from,range.to,range.service]),
    db.query(`SELECT status,COUNT(*)::int AS count FROM payment_intents WHERE created_at>=$1 AND created_at<$2 GROUP BY status ORDER BY status`,[range.from,range.to]),
  ]);
  return {
    operations:operations.rows[0],
    ratings:ratings.rows[0],
    paymentOutcomes:payments.rows,
    outcomes: outcomes.rows,
    settlement: value.rows[0],
    ledger: money,
    asOf: new Date().toISOString(),
    scope: {
      ...range,
      outcomesDateBasis: "requested_at",
      settlementDateBasis: "completed_at / returned_at",
      ledgerDateBasis: "ledger posting time",
      ledgerServiceScope:
        "All services; ledger account postings are not filtered by trip service.",
    },
    currency: "NGN",
  };
}
export async function getAdminPricing() {
  return {
    items: (
      await db.query<FareRecord>(
        "SELECT * FROM fare_config ORDER BY vehicle_type",
      )
    ).rows.map(presentFare),
    asOf: new Date().toISOString(),
  };
}

interface FareRecord {
  vehicle_type: string;
  base_fare_kobo: string;
  per_km_kobo: string;
  per_min_kobo: string;
  min_fare_kobo: string;
  commission_bps: number;
  is_active: boolean;
  updated_at: Date;
}
const fareVersion = (row: FareRecord) =>
  createHash("sha256").update(JSON.stringify(row)).digest("hex");
function presentFare(row: FareRecord) {
  return {
    vehicleType: row.vehicle_type,
    baseFareKobo: row.base_fare_kobo,
    perKmKobo: row.per_km_kobo,
    perMinuteKobo: row.per_min_kobo,
    minimumFareKobo: row.min_fare_kobo,
    commissionBps: row.commission_bps,
    active: row.is_active,
    updatedAt: row.updated_at,
    version: fareVersion(row),
  };
}
export async function updateAdminPricing(
  actorId: string,
  vehicleType: string,
  input: Record<string, unknown>,
) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new ApiError(400, "invalid_pricing_input");
  const audit = auditInput(input.reason, input.requestKey);
  const moneyFields = [
    "baseFareKobo",
    "perKmKobo",
    "perMinuteKobo",
    "minimumFareKobo",
  ] as const;
  const allowed = [
    ...moneyFields,
    "commissionBps",
    "active",
    "expectedVersion",
    "reason",
    "requestKey",
  ];
  if (
    !/^[a-z][a-z0-9_]{0,19}$/.test(vehicleType) ||
    Object.keys(input).some((key) => !allowed.includes(key))
  )
    throw new ApiError(400, "invalid_pricing_input");
  for (const field of moneyFields) {
    if (
      !Number.isSafeInteger(input[field]) ||
      Number(input[field]) < 0 ||
      Number(input[field]) > 1_000_000_000
    )
      throw new ApiError(400, "invalid_fare_amount");
  }
  if (
    !Number.isSafeInteger(input.commissionBps) ||
    Number(input.commissionBps) < 0 ||
    Number(input.commissionBps) > 10000 ||
    typeof input.active !== "boolean"
  )
    throw new ApiError(400, "invalid_pricing_input");
  if (
    typeof input.expectedVersion !== "string" ||
    !/^[a-f0-9]{64}$/.test(input.expectedVersion)
  )
    throw new ApiError(400, "expected_pricing_version_required");
  return inTransaction(async (client) => {
    const operation = await replayAdminOperation(
      client,
      actorId,
      "pricing_update",
      audit.requestKey,
      { vehicleType, ...input, reason: audit.reason },
      ["super_admin"],
    );
    const before = (
      await client.query<FareRecord>(
        "SELECT * FROM fare_config WHERE vehicle_type=$1 FOR UPDATE",
        [vehicleType],
      )
    ).rows[0];
    if (!before) throw new ApiError(404, "fare_config_not_found");
    if (operation.previous)
      return { ...presentFare(before), auditId: operation.previous.id };
    if (fareVersion(before) !== input.expectedVersion)
      throw new ApiError(409, "pricing_changed");
    const after = (
      await client.query<FareRecord>(
        `UPDATE fare_config SET base_fare_kobo=$2,per_km_kobo=$3,per_min_kobo=$4,min_fare_kobo=$5,commission_bps=$6,is_active=$7,updated_at=now() WHERE vehicle_type=$1 RETURNING *`,
        [
          vehicleType,
          ...moneyFields.map((field) => input[field]),
          input.commissionBps,
          input.active,
        ],
      )
    ).rows[0];
    const saved = (
      await client.query<{ id: string }>(
        `INSERT INTO admin_audit_log(actor_id,action,request_key,reason,object_type,metadata) VALUES($1,'pricing_update',$2,$3,'fare_config',$4) RETURNING id::text`,
        [
          actorId,
          audit.requestKey,
          audit.reason,
          { operationHash: operation.hash, vehicleType, before, after },
        ],
      )
    ).rows[0];
    return { ...presentFare(after), auditId: saved.id };
  });
}
export async function listAdminRatings(query: AdminQuery) {
  const { rows, ...paging } = await readAdminRows<{
    id: string;
    _cursor: string;
  }>(
    {
      select: `SELECT r.id,r.trip_id AS "tripId",t.service_type AS service,r.rating,r.comment,r.created_at AS "createdAt",r.created_at::text AS _cursor,u.full_name AS rater,v.full_name AS ratee FROM trip_ratings r JOIN trips t ON t.id=r.trip_id JOIN users u ON u.id=r.rater_id JOIN users v ON v.id=r.ratee_id WHERE ($1::text IS NULL OR t.service_type=$1) AND ($2::uuid IS NULL OR r.id=$2) AND ($3::timestamptz IS NULL OR (r.created_at,r.id)<($3::timestamptz,$4::uuid))`,
      orderBy: `r.created_at DESC,r.id DESC`,
      limitParameter: 5,
    },
    [
      query.service,
      query.id,
      query.cursor?.at ?? null,
      query.cursor?.id ?? null,
      query.limit + 1,
    ],
    query,
  );
  return adminPage(rows, query, "rating.created_at", paging);
}

export async function exportAdminReports(
  actorId: string,
  range: ReturnType<typeof reportRange>,
) {
  const report = await getAdminReports(range);
  await db.query(
    "INSERT INTO admin_audit_log(actor_id,action,reason,object_type,metadata) VALUES($1,'report_export','Staff exported scoped aggregate report','report',$2)",
    [actorId, { scope: report.scope, asOf: report.asOf }],
  );
  const quote = (value: string) => '"' + value.replaceAll('"', '""') + '"';
  const rows = [
    [
      "metric",
      "service",
      "value",
      "unit",
      "date_basis",
      "from",
      "to",
      "observed_at",
    ],
    ...Object.entries(report.operations).map(([key,value])=>["operations_"+key,range.service??"all",value===null?"unknown":String(value),key==='meanAssignmentSeconds'?'seconds':'count','requested_at',range.from,range.to,report.asOf]),
    ...Object.entries(report.ratings).map(([key,value])=>["ratings_"+key,range.service??"all",value===null?"unknown":String(value),key==='average'?'stars':'count','rating created_at',range.from,range.to,report.asOf]),
    ...report.paymentOutcomes.map(r=>["payment_intent_"+r.status,'all',String(r.count),'count','intent created_at',range.from,range.to,report.asOf]),
    ...report.outcomes.map((r) => [
      "outcome_" + r.status,
      r.service,
      r.count,
      "count",
      "requested_at",
      range.from,
      range.to,
      report.asOf,
    ]),
    [
      "settled_trip_value",
      range.service ?? "all",
      report.settlement.settledValueKobo,
      "NGN kobo",
      "completed_at / returned_at",
      range.from,
      range.to,
      report.asOf,
    ],
    ...report.ledger.map((r) => [
      r.code,
      "all",
      r.amountKobo,
      "NGN kobo",
      "ledger posting time",
      range.from,
      range.to,
      report.asOf,
    ]),
  ];
  return (
    rows
      .map((r, index) =>
        [
          ...r,
          index === 0 ? "timezone" : "Africa/Lagos (WAT)",
          index === 0 ? "currency" : "NGN",
        ]
          .map(quote)
          .join(","),
      )
      .join("\r\n") + "\r\n"
  );
}

export async function getAdminTripPosition(id: string, actorId: string) {
  const { rows } = await db.query<{ driverId: string | null; status: string }>(
    `SELECT driver_id AS "driverId",status FROM trips WHERE id=$1`,
    [id],
  );
  if (!rows[0]) throw new ApiError(404, "trip_not_found");
  await recordAdminRead(actorId, "trip_location_read", "trip", id);
  return adminDriverPosition(
    rows[0].driverId,
    ["driver_assigned", "driver_arrived", "in_progress", "returning"].includes(
      rows[0].status,
    ),
  );
}

/** Bounded staff lookup; no delivery codes, contact data, or route coordinates are exposed. */
export async function searchAdminTrips(
  input: import("../../shared/utils/adminSearch").SearchRead,
): Promise<import("../../shared/utils/adminSearch").StaffSearchHit[]> {
  const rows = await staffSearchRows<{
    id: string;
    service: string;
    status: string;
    rider: string;
  }>(
    `SELECT t.id,t.service_type AS service,t.status,r.full_name AS rider FROM trips t JOIN users r ON r.id=t.rider_id LEFT JOIN users d ON d.id=t.driver_id WHERE (t.id::text=$1 OR lower(r.full_name) LIKE $2 ESCAPE '!' OR lower(d.full_name) LIKE $2 ESCAPE '!') AND ($3::uuid IS NULL OR t.id>$3) ORDER BY t.id LIMIT $4`,
    [
      input.query.toLowerCase(),
      input.prefix,
      input.after?.id ?? null,
      input.limit + 1,
    ],
  );
  return rows.map((row) => ({
    id: row.id,
    type: "trip",
    title: `${row.service === "courier" ? "Courier" : "Passenger"} trip`,
    subtitle: `${row.rider} · ${row.status}`,
    href: `/admin/trips/${row.id}`,
  }));
}
```

</details>

## src/modules/trips/fare.service.ts

[Open source](../src/modules/trips/fare.service.ts)

SHA-256: `32a47ad8dcce92c9ed92c60187c2595e390692fa92b567207d8b2f9979bac741`

<details>
<summary>Full TypeScript implementation</summary>

```ts
import type { PoolClient } from 'pg';
import { ApiError } from '../../shared/errors';
import type { FareConfigRow } from './trip.types';

export function calculateFare(config: FareConfigRow, distanceM: number, durationS: number): number {
  const raw = Number(config.base_fare_kobo)
    + Math.round((distanceM / 1000) * Number(config.per_km_kobo))
    + Math.round((durationS / 60) * Number(config.per_min_kobo));
  return Math.ceil(Math.max(Number(config.min_fare_kobo), raw) / 100) * 100;
}

export function splitFare(fareKobo: number, commissionBps: number) {
  const commissionKobo = Math.floor((fareKobo * commissionBps) / 10_000);
  return { commissionKobo, driverEarningKobo: fareKobo - commissionKobo };
}

export async function getFareConfig(client: PoolClient, vehicleType = 'economy', activeOnly = true): Promise<FareConfigRow> {
  const { rows } = await client.query<FareConfigRow>(
    'SELECT * FROM fare_config WHERE vehicle_type=$1 AND (NOT $2::boolean OR is_active=true)',
    [vehicleType, activeOnly],
  );
  if (!rows[0]) throw new ApiError(409, 'vehicle_type_unavailable');
  return rows[0];
}
```

</details>

## src/modules/trips/trips.service.ts

[Open source](../src/modules/trips/trips.service.ts)

SHA-256: `02335aa8ebe40513f52e450defde1c54596d7afc1b5367c78f329c28a971deae`

<details>
<summary>Full TypeScript implementation</summary>

```ts
import { db, inTransaction } from '../../shared/config/db';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env';
import { ensureRedis } from '../../shared/config/redis';
import { ApiError } from '../../shared/errors';
import { getRoute } from '../maps/maps.service';
import { acquireDriverTripLock, releaseDriverTripLock, releaseOfferLock } from '../matching/matching.service';
import { calculateFare, getFareConfig, splitFare } from './fare.service';
import { holdTripFare, releaseTripHold, settleTrip } from '../payments/tripPayments.service';
import { emitWalletUpdated } from '../../websocket/notifications';
import { transitionTrip } from './tripStateMachine';
import { emitOfferCancelled, emitTripStatus } from './tripSocket';
import type { CourierDetails, PaymentMethod, TripEstimate, TripPoint, TripQuote, TripRow, TripStatus } from './trip.types';

function parseCourierDetails(value: unknown): CourierDetails {
  const input = value as Partial<CourierDetails & { acceptedRestrictions: boolean }> | null;
  const description = String(input?.description ?? '').trim();
  const recipientName = String(input?.recipientName ?? '').trim();
  const recipientPhone = String(input?.recipientPhone ?? '').trim();
  const weightKg = Number(input?.weightKg);
  const pickupInstructions = String(input?.pickupInstructions ?? '').trim();
  const dropoffInstructions = String(input?.dropoffInstructions ?? '').trim();
  if (description.length < 3 || description.length > 160 || recipientName.length < 2 || recipientName.length > 80 ||
      !/^\+[1-9]\d{7,14}$/.test(recipientPhone) || !Number.isFinite(weightKg) || weightKg <= 0 || weightKg > 5 ||
      pickupInstructions.length > 200 || dropoffInstructions.length > 200 || input?.acceptedRestrictions !== true) {
    throw new ApiError(400, 'invalid_courier_details');
  }
  return { description, recipientName, recipientPhone, weightKg,
    pickupInstructions: pickupInstructions || null, dropoffInstructions: dropoffInstructions || null };
}

function deliveryCode(tripId: string, version: number): string {
  const digest = createHmac('sha256', env.JWT_ACCESS_SECRET).update(`courier-delivery:${tripId}:${version}`).digest();
  return String(digest.readUInt32BE(0) % 1_000_000).padStart(6, '0');
}

function parsePoint(value: unknown, name: string): TripPoint {
  const point = value as Partial<TripPoint> | null;
  const latitude = Number(point?.latitude), longitude = Number(point?.longitude);
  const address = String(point?.address ?? '').trim();
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180 || !address) throw new ApiError(400, `invalid_${name}`);
  return { latitude, longitude, address, ...(point?.placeId ? { placeId: String(point.placeId) } : {}) };
}

function parsePayment(value: unknown): PaymentMethod {
  if (value === 'cash' || value === 'wallet') return value;
  if (value === 'card') throw new ApiError(409, 'card_payment_not_available');
  throw new ApiError(400, 'invalid_payment_method');
}

function parseScheduledAt(value: unknown): Date | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) throw new ApiError(400, 'invalid_scheduled_time');
  const date = new Date(value);
  const delay = date.getTime() - Date.now();
  if (!Number.isFinite(delay) || delay < 30 * 60_000 || delay > 7 * 24 * 60 * 60_000) throw new ApiError(400, 'scheduled_time_out_of_range');
  return date;
}

export function presentTrip<T extends TripRow>(trip: T) {
  return { ...trip, fare_kobo: Number(trip.fare_kobo), commission_kobo: trip.commission_kobo === null ? null : Number(trip.commission_kobo), driver_earning_kobo: trip.driver_earning_kobo === null ? null : Number(trip.driver_earning_kobo) };
}

export async function estimateTrip(input: Record<string, unknown>): Promise<TripEstimate> {
  const pickup = parsePoint(input.pickup, 'pickup'), dropoff = parsePoint(input.dropoff, 'dropoff');
  if (pickup.latitude === dropoff.latitude && pickup.longitude === dropoff.longitude) throw new ApiError(400, 'pickup_matches_dropoff');
  const vehicleType = input.vehicleType === undefined || input.vehicleType === 'economy' ? 'economy' : String(input.vehicleType);
  const client = await db.connect();
  const config = await getFareConfig(client, vehicleType).finally(() => client.release());
  // A changed rate or disabled service cannot reuse a cached estimate from the previous configuration.
  const revision = [config.base_fare_kobo, config.per_km_kobo, config.per_min_kobo, config.min_fare_kobo, config.commission_bps].join(':');
  const cacheKey = `trip:estimate:${pickup.latitude.toFixed(5)},${pickup.longitude.toFixed(5)}:${dropoff.latitude.toFixed(5)},${dropoff.longitude.toFixed(5)}:${vehicleType}:${revision}`;
  const redis = await ensureRedis();
  const cached = await redis.get(cacheKey);
  if (cached) return JSON.parse(cached) as TripEstimate;
  const route = await getRoute(pickup, dropoff);
  {
    const distanceM = Math.max(1, Math.round(route.distanceKm * 1000)), durationS = Math.max(1, Math.round(route.durationMin * 60));
    const fareKobo = calculateFare(config, distanceM, durationS);
    const result = { vehicleType, distanceM, durationS, encodedPolyline: route.encodedPolyline, fareKobo, distanceKm: distanceM / 1000, durationMin: durationS / 60, estimatedFare: fareKobo / 100, currency: 'NGN' as const };
    await redis.set(cacheKey, JSON.stringify(result), 'EX', 60);
    return result;
  }
}

interface StoredQuote {
  riderId: string;
  pickup: TripPoint;
  dropoff: TripPoint;
  estimate: TripEstimate;
  expiresAt: number;
}

export async function quoteTrip(riderId: string, input: Record<string, unknown>): Promise<TripQuote> {
  const pickup = parsePoint(input.pickup, 'pickup');
  const dropoff = parsePoint(input.dropoff, 'dropoff');
  if (input.vehicleType !== undefined && input.vehicleType !== 'economy' && input.vehicleType !== 'courier') {
    throw new ApiError(400, 'invalid_vehicle_type');
  }
  const estimate = await estimateTrip({ ...input, pickup, dropoff });
  const quoteId = randomUUID();
  const expiresAt = Date.now() + env.TRIP_QUOTE_TTL_SECONDS * 1000;
  const quote: StoredQuote = { riderId, pickup, dropoff, estimate, expiresAt };
  const redis = await ensureRedis();
  await redis.set(`trip:quote:${quoteId}`, JSON.stringify(quote), 'EX', env.TRIP_QUOTE_TTL_SECONDS);
  return { ...estimate, quoteId, quoteExpiresAt: new Date(expiresAt).toISOString() };
}

async function getAcceptedQuote(riderId: string, quoteId: unknown, pickup: TripPoint, dropoff: TripPoint, vehicleType: string): Promise<StoredQuote> {
  if (typeof quoteId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(quoteId)) {
    throw new ApiError(409, 'trip_quote_required');
  }
  const redis = await ensureRedis();
  const value = await redis.get(`trip:quote:${quoteId}`);
  if (!value) throw new ApiError(409, 'trip_quote_expired');
  const quote = JSON.parse(value) as StoredQuote;
  if (quote.riderId !== riderId || quote.estimate.vehicleType !== vehicleType ||
      JSON.stringify(quote.pickup) !== JSON.stringify(pickup) || JSON.stringify(quote.dropoff) !== JSON.stringify(dropoff)) {
    throw new ApiError(409, 'trip_quote_mismatch');
  }
  if (quote.expiresAt <= Date.now()) throw new ApiError(409, 'trip_quote_expired');
  return quote;
}

export async function createTrip(riderId: string, input: Record<string, unknown>, idempotencyKey: string) {
  if (!idempotencyKey || idempotencyKey.length > 80) throw new ApiError(400, 'invalid_idempotency_key');
  const existing = (await db.query<TripRow>('SELECT * FROM trips WHERE rider_id=$1 AND idempotency_key=$2', [riderId, idempotencyKey])).rows[0];
  if (existing) return { trip: presentTrip(existing), created: false };
  const scheduledAt = parseScheduledAt(input.scheduledAt);
  const serviceType = input.serviceType === 'courier' ? 'courier' : input.serviceType === undefined || input.serviceType === 'ride' ? 'ride' : null;
  if (!serviceType || (serviceType === 'courier' && scheduledAt)) throw new ApiError(400, 'invalid_service_type');
  const courierDetails = serviceType === 'courier' ? parseCourierDetails(input.courierDetails) : null;
  if (!scheduledAt) {
    const active = (await db.query<TripRow>(`SELECT * FROM trips WHERE rider_id=$1 AND status IN ('searching','driver_assigned','driver_arrived','in_progress','returning')`,[riderId])).rows[0];
    if (active?.idempotency_key === idempotencyKey) return { trip: presentTrip(active), created: false };
    if (active) throw new ApiError(409, 'rider_has_active_trip', { tripId: active.id });
  }
  const pickup = parsePoint(input.pickup, 'pickup'), dropoff = parsePoint(input.dropoff, 'dropoff');
  const paymentMethod = parsePayment(input.paymentMethod);
  if (serviceType === 'courier' && paymentMethod !== 'wallet') throw new ApiError(400, 'courier_requires_wallet');
  const quote = await getAcceptedQuote(riderId, input.quoteId, pickup, dropoff, serviceType === 'courier' ? 'courier' : 'economy');
  const estimate = quote.estimate;
  try {
    const trip = await inTransaction(async (client) => {
      const rider = (await client.query<{is_active: boolean; active_role: string}>('SELECT is_active,active_role FROM users WHERE id=$1 FOR UPDATE', [riderId])).rows[0];
      if (!rider?.is_active) throw new ApiError(403, 'account_inactive');
      if (rider.active_role !== 'rider') throw new ApiError(409, 'switch_to_rider_mode');
      if (scheduledAt) {
        const overlapping = await client.query(
          `SELECT 1 FROM trips WHERE rider_id=$1 AND status='scheduled'
           AND scheduled_at<$2 AND scheduled_at+(estimated_duration_s*interval '1 second')+interval '30 minutes'>$3 LIMIT 1`,
          [riderId, new Date(scheduledAt.getTime() + Number(estimate.durationS) * 1000 + 30 * 60_000), scheduledAt],
        );
        if (overlapping.rowCount) throw new ApiError(409, 'scheduled_trip_overlaps_existing');
      }
      // Check again after any scheduling lock wait, before creating a trip or holding money.
      if (quote.expiresAt <= Date.now()) throw new ApiError(409, 'trip_quote_expired');
      const bookingConfig = await getFareConfig(client, serviceType === "courier" ? "courier" : "economy");
      const { rows } = await client.query<TripRow>(
        `INSERT INTO trips (rider_id,payment_method,pickup_lat,pickup_lng,pickup_address,pickup_place_id,dropoff_lat,dropoff_lng,dropoff_address,dropoff_place_id,estimated_distance_m,estimated_duration_s,route_polyline,fare_kobo,idempotency_key,status,scheduled_at,service_type,courier_details,vehicle_type,commission_bps_snapshot)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING *`,
        [riderId,paymentMethod,pickup.latitude,pickup.longitude,pickup.address,pickup.placeId??null,dropoff.latitude,dropoff.longitude,dropoff.address,dropoff.placeId??null,estimate.distanceM,estimate.durationS,estimate.encodedPolyline,estimate.fareKobo,idempotencyKey,scheduledAt?'scheduled':'searching',scheduledAt,serviceType,courierDetails ? JSON.stringify(courierDetails) : null,serviceType === 'courier' ? 'courier' : 'economy',bookingConfig.commission_bps],
      );
      await client.query(`INSERT INTO trip_status_history (trip_id,from_status,to_status,actor_id,actor_type) VALUES ($1,NULL,$2,$3,'rider')`, [rows[0].id, rows[0].status, riderId]);
      if (!scheduledAt) {
        await holdTripFare(client, rows[0]);
        if (paymentMethod === 'wallet') rows[0].payment_status = 'held';
      }
      return rows[0];
    });
    if (paymentMethod === 'wallet' && !scheduledAt) emitWalletUpdated(riderId);
    return { trip: presentTrip(trip), created: true };
  } catch (error) {
    const pgError = error as { code?: string; constraint?: string };
    if (pgError.code === '23505' && pgError.constraint === 'trips_rider_id_idempotency_key_key') {
      const trip = (await db.query<TripRow>('SELECT * FROM trips WHERE rider_id=$1 AND idempotency_key=$2', [riderId,idempotencyKey])).rows[0];
      if (trip) return { trip: presentTrip(trip), created: false };
    }
    if (pgError.code === '23505' && pgError.constraint === 'one_active_trip_per_rider') {
      const active = (await db.query<{id:string}>(`SELECT id FROM trips WHERE rider_id=$1 AND status IN ('searching','driver_assigned','driver_arrived','in_progress','returning')`,[riderId])).rows[0];
      throw new ApiError(409, 'rider_has_active_trip', { tripId: active?.id });
    }
    throw error;
  }
}

export async function listScheduledTrips(riderId: string) {
  const { rows } = await db.query<TripRow>(
    `SELECT * FROM trips WHERE rider_id=$1 AND scheduled_at IS NOT NULL
      AND (status='scheduled' OR (scheduled_at>now()-interval '24 hours' AND status<>'completed'))
      ORDER BY scheduled_at ASC LIMIT 50`, [riderId],
  );
  return rows.map(presentTrip);
}

export async function activateDueScheduledTrips(): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM trips WHERE status='scheduled' AND scheduled_at<=now()+interval '5 minutes' ORDER BY scheduled_at ASC LIMIT 50`,
  );
  const activated: string[] = [];
  for (const { id } of rows) {
    try {
      const trip = await inTransaction(async (client) => {
        const locked = (await client.query<TripRow>('SELECT * FROM trips WHERE id=$1 FOR UPDATE', [id])).rows[0];
        if (!locked || locked.status !== 'scheduled' || !locked.scheduled_at || locked.scheduled_at.getTime() > Date.now() + 5 * 60_000) return null;
        if (locked.scheduled_at.getTime() < Date.now() - 5 * 60_000) {
          return transitionTrip(client, { tripId: id, from: 'scheduled', to: 'cancelled', actorType: 'system',
            fields: { cancelled_by: 'system', cancel_reason: 'pickup_time_passed', cancelled_at: new Date() } });
        }
        const active = await client.query(`SELECT 1 FROM trips WHERE rider_id=$1 AND id<>$2 AND status IN ('searching','driver_assigned','driver_arrived','in_progress','returning') LIMIT 1`, [locked.rider_id, id]);
        if (active.rowCount) throw new ApiError(409, 'rider_has_active_trip');
        await holdTripFare(client, locked);
        return transitionTrip(client, { tripId: id, from: 'scheduled', to: 'searching', actorType: 'system', fields: { requested_at: new Date() } });
      });
      if (trip) {
        if (trip.status === 'searching') {
          activated.push(id);
          if (trip.payment_method === 'wallet') emitWalletUpdated(trip.rider_id);
        }
        emitTripStatus(trip);
      }
    } catch (error) {
      const pg = error as { code?: string; constraint?: string };
      const reason = error instanceof ApiError && error.code === 'insufficient_funds' ? 'wallet_balance_insufficient'
        : error instanceof ApiError && error.code === 'account_frozen' ? 'wallet_unavailable'
        : error instanceof ApiError && error.code === 'rider_has_active_trip' || pg.constraint === 'one_active_trip_per_rider' ? 'another_trip_active' : null;
      if (!reason) throw error;
      const cancelled = await inTransaction(async (client) => {
        const locked = (await client.query<TripRow>('SELECT * FROM trips WHERE id=$1 FOR UPDATE', [id])).rows[0];
        if (!locked || locked.status !== 'scheduled') return null;
        return transitionTrip(client, { tripId: id, from: 'scheduled', to: 'cancelled', actorType: 'system', fields: { cancelled_by: 'system', cancel_reason: reason, cancelled_at: new Date() } });
      });
      if (cancelled) emitTripStatus(cancelled);
    }
  }
  return activated;
}

export async function scheduledSearchesWithoutOffers(): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT t.id FROM trips t WHERE t.status='searching' AND t.scheduled_at IS NOT NULL
      AND t.scheduled_at+interval '5 minutes'>now()
      AND NOT EXISTS (SELECT 1 FROM trip_offers o WHERE o.trip_id=t.id AND o.status='sent')
      ORDER BY t.requested_at ASC LIMIT 50`,
  );
  return rows.map((row) => row.id);
}

export async function scheduledSearchExpiryDelay(tripId: string): Promise<number> {
  const trip = (await db.query<{ scheduled_at: Date | null }>('SELECT scheduled_at FROM trips WHERE id=$1', [tripId])).rows[0];
  if (!trip?.scheduled_at) return 0;
  return Math.max(0, trip.scheduled_at.getTime() + 5 * 60_000 - Date.now());
}

export async function overdueScheduledSearches(): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM trips WHERE status='searching' AND scheduled_at IS NOT NULL
      AND scheduled_at+interval '5 minutes'<=now() ORDER BY scheduled_at ASC LIMIT 50`,
  );
  return rows.map((row) => row.id);
}

const detailSelect = `SELECT t.*,du.full_name AS driver_name,du.avatar_url AS driver_avatar,du.rating_avg AS driver_rating,dp.vehicle_make,dp.vehicle_model,dp.vehicle_color,dp.plate_number,ru.full_name AS rider_name,ru.avatar_url AS rider_avatar,ru.rating_avg AS rider_rating FROM trips t JOIN users ru ON ru.id=t.rider_id LEFT JOIN users du ON du.id=t.driver_id LEFT JOIN driver_profiles dp ON dp.user_id=t.driver_id`;
interface TripDetailRow extends TripRow { driver_name:string|null;driver_avatar:string|null;driver_rating:string|null;vehicle_make:string|null;vehicle_model:string|null;vehicle_color:string|null;plate_number:string|null;rider_name:string;rider_avatar:string|null;rider_rating:string|null }

export async function getTripForParticipant(userId: string, tripId: string) {
  const trip=(await db.query<TripDetailRow>(`${detailSelect} WHERE t.id=$1 AND (t.rider_id=$2 OR t.driver_id=$2)`,[tripId,userId])).rows[0];
  if(!trip)throw new ApiError(404,'trip_not_found');return presentTrip(trip);
}

export async function getCourierDeliveryCode(riderId: string, tripId: string) {
  const trip = (await db.query<TripRow>('SELECT * FROM trips WHERE id=$1 AND rider_id=$2', [tripId, riderId])).rows[0];
  if (!trip || trip.service_type !== 'courier') throw new ApiError(404, 'courier_trip_not_found');
  if (['cancelled', 'no_drivers_found', 'completed'].includes(trip.status)) throw new ApiError(409, 'delivery_code_unavailable');
  return { code: deliveryCode(tripId, trip.delivery_code_version) };
}

export async function rotateCourierDeliveryCode(riderId:string,tripId:string){
  return inTransaction(async(client)=>{
    const trip=(await client.query<TripRow>('SELECT * FROM trips WHERE id=$1 AND rider_id=$2 FOR UPDATE',[tripId,riderId])).rows[0];
    if(!trip||trip.service_type!=='courier')throw new ApiError(404,'courier_trip_not_found');
    if(!['in_progress','returning'].includes(trip.status))throw new ApiError(409,'delivery_code_rotation_unavailable');
    if(trip.delivery_reset_count>=2)throw new ApiError(429,'delivery_code_reset_limit');
    const updated=(await client.query<TripRow>('UPDATE trips SET delivery_attempts=0,delivery_code_version=delivery_code_version+1,delivery_reset_count=delivery_reset_count+1 WHERE id=$1 RETURNING *',[tripId])).rows[0];
    return {code:deliveryCode(tripId,updated.delivery_code_version)};
  });
}

export async function getActiveTrip(userId:string,activeRole:'rider'|'driver'){
  const owner=activeRole==='driver'?'t.driver_id':'t.rider_id';
  const trip=(await db.query<TripDetailRow>(`${detailSelect} WHERE ${owner}=$1 AND t.status IN ('searching','driver_assigned','driver_arrived','in_progress','returning') ORDER BY t.created_at DESC LIMIT 1`,[userId])).rows[0];
  if(!trip)return null;const redis=await ensureRedis();const latest=await redis.get(`trip:${trip.id}:loc`);return{...presentTrip(trip),latestDriverLocation:latest?JSON.parse(latest):null};
}

export async function getCurrentOffer(driverId: string) {
  const { rows } = await db.query<{
    trip_id: string; service_type: string; courier_details: CourierDetails | null;
    pickup_lat: number; pickup_lng: number; pickup_address: string;
    dropoff_lat: number; dropoff_lng: number; dropoff_address: string;
    fare_kobo: string; distance_to_pickup_m: number; expires_at: Date;
  }>(
    `SELECT o.trip_id,o.distance_to_pickup_m,o.expires_at,t.service_type,t.courier_details,
      t.pickup_lat,t.pickup_lng,t.pickup_address,t.dropoff_lat,t.dropoff_lng,t.dropoff_address,t.fare_kobo
     FROM trip_offers o JOIN trips t ON t.id=o.trip_id JOIN users u ON u.id=o.driver_id
     JOIN driver_profiles dp ON dp.user_id=u.id
     WHERE o.driver_id=$1 AND o.status='sent' AND o.expires_at>now() AND t.status='searching'
       AND u.is_active=true AND u.active_role='driver' AND dp.status='approved'
     ORDER BY o.sent_at DESC LIMIT 1`, [driverId],
  );
  const offer = rows[0];
  return offer ? {
    tripId: offer.trip_id, serviceType: offer.service_type, packageDescription: offer.courier_details?.description,
    pickup: { latitude: offer.pickup_lat, longitude: offer.pickup_lng, address: offer.pickup_address },
    dropoff: { latitude: offer.dropoff_lat, longitude: offer.dropoff_lng, address: offer.dropoff_address },
    fareKobo: Number(offer.fare_kobo), distanceToPickupM: offer.distance_to_pickup_m,
    expiresAt: offer.expires_at, serverNow: new Date().toISOString(),
  } : null;
}

export async function acceptTrip(driverId:string,tripId:string){
  if(!await acquireDriverTripLock(driverId,tripId))throw new ApiError(409,'driver_has_active_trip');
  try{const trip=await inTransaction(async(client)=>{const driver=(await client.query<{is_active:boolean;active_role:string}>('SELECT is_active,active_role FROM users WHERE id=$1 FOR UPDATE',[driverId])).rows[0];if(!driver?.is_active)throw new ApiError(403,'account_inactive');if(driver.active_role!=='driver')throw new ApiError(409,'switch_to_driver_mode');const locked=(await client.query<TripRow>('SELECT * FROM trips WHERE id=$1 FOR UPDATE',[tripId])).rows[0];if(!locked)throw new ApiError(404,'trip_not_found');if(locked.status!=='searching')throw new ApiError(409,'trip_no_longer_available');const accepted=await client.query(`UPDATE trip_offers SET status='accepted',responded_at=now() WHERE trip_id=$1 AND driver_id=$2 AND status='sent' AND expires_at>now()`,[tripId,driverId]);if(!accepted.rowCount)throw new ApiError(409,'offer_expired_or_invalid');return transitionTrip(client,{tripId,from:'searching',to:'driver_assigned',actorId:driverId,actorType:'driver',fields:{driver_id:driverId,accepted_at:new Date()}});});await releaseOfferLock(driverId,tripId);const detail=await getTripForParticipant(driverId,tripId);emitTripStatus(trip,{name:detail.driver_name,photo:detail.driver_avatar,rating:detail.driver_rating,vehicle:[detail.vehicle_color,detail.vehicle_make,detail.vehicle_model].filter(Boolean).join(' '),plate:detail.plate_number});return detail;}catch(error){await releaseDriverTripLock(driverId,tripId);const pgError=error as{code?:string;constraint?:string};if(pgError.code==='23505'&&pgError.constraint==='one_active_trip_per_driver')throw new ApiError(409,'driver_has_active_trip');throw error;}
}

export async function declineTrip(driverId:string,tripId:string){const result=await db.query(`UPDATE trip_offers SET status='declined',responded_at=now() WHERE trip_id=$1 AND driver_id=$2 AND status='sent' RETURNING id`,[tripId,driverId]);if(!result.rowCount)throw new ApiError(409,'offer_expired_or_invalid');await releaseOfferLock(driverId,tripId);emitOfferCancelled(driverId,tripId);return{success:true};}

async function driverTransition(driverId:string,tripId:string,from:TripStatus,to:TripStatus,field:'arrived_at'|'started_at'){
  const trip=await inTransaction(async(client)=>{const locked=(await client.query<TripRow>('SELECT * FROM trips WHERE id=$1 AND driver_id=$2 FOR UPDATE',[tripId,driverId])).rows[0];if(!locked)throw new ApiError(404,'trip_not_found');if(locked.status!==from)throw new ApiError(409,'invalid_trip_state',{expected:from,actual:locked.status});return transitionTrip(client,{tripId,from,to,actorId:driverId,actorType:'driver',fields:{[field]:new Date()}});});emitTripStatus(trip);return presentTrip(trip);
}
export const markDriverArrived=(driverId:string,tripId:string)=>driverTransition(driverId,tripId,'driver_assigned','driver_arrived','arrived_at');
export const startTrip=(driverId:string,tripId:string)=>driverTransition(driverId,tripId,'driver_arrived','in_progress','started_at');

export async function returnCourierDelivery(driverId:string,tripId:string,reasonValue:unknown){
  const reason=String(reasonValue??'').trim().slice(0,200);
  if(reason.length<3)throw new ApiError(400,'delivery_issue_reason_required');
  const trip=await inTransaction(async(client)=>{
    const locked=(await client.query<TripRow>('SELECT * FROM trips WHERE id=$1 AND driver_id=$2 FOR UPDATE',[tripId,driverId])).rows[0];
    if(!locked)throw new ApiError(404,'trip_not_found');
    if(locked.service_type!=='courier'||locked.status!=='in_progress')throw new ApiError(409,'return_not_available');
    return transitionTrip(client,{tripId,from:'in_progress',to:'returning',actorId:driverId,actorType:'driver',fields:{delivery_issue_reason:reason}});
  });
  emitTripStatus(trip);
  return presentTrip(trip);
}

export async function completeTrip(driverId:string,tripId:string,codeValue?:unknown){const trip=await inTransaction(async(client)=>{const locked=(await client.query<TripRow>('SELECT * FROM trips WHERE id=$1 AND driver_id=$2 FOR UPDATE',[tripId,driverId])).rows[0];if(!locked)throw new ApiError(404,'trip_not_found');if(locked.status!=='in_progress'&&!(locked.service_type==='courier'&&locked.status==='returning'))throw new ApiError(409,'trip_not_in_progress');if(locked.service_type==='courier'){
    if(locked.delivery_attempts>=5)throw new ApiError(409,'delivery_code_locked');
    const code=typeof codeValue==='string'?codeValue:'';
    const correct=deliveryCode(tripId,locked.delivery_code_version);
    if(!/^\d{6}$/.test(code)||!timingSafeEqual(Buffer.from(code),Buffer.from(correct))){
      await client.query('UPDATE trips SET delivery_attempts=delivery_attempts+1 WHERE id=$1',[tripId]);
      return null;
    }
  }
  const commissionBps = locked.commission_bps_snapshot ?? (await getFareConfig(client,locked.vehicle_type,false)).commission_bps;const split=splitFare(Number(locked.fare_kobo),commissionBps);const returning=locked.status==='returning';const updated=await transitionTrip(client,{tripId,from:locked.status,to:returning?'returned':'completed',actorId:driverId,actorType:'driver',fields:{...(returning?{returned_at:new Date()}:{completed_at:new Date()}),commission_kobo:String(split.commissionKobo),driver_earning_kobo:String(split.driverEarningKobo),...(locked.service_type==='courier'?{delivery_verified_at:new Date()}:{})}});await settleTrip(client,locked,split.commissionKobo,split.driverEarningKobo);updated.payment_status='settled';return updated;});if(!trip)throw new ApiError(400,'invalid_delivery_code');await releaseDriverTripLock(driverId,tripId);emitWalletUpdated(driverId);emitTripStatus(trip);return presentTrip(trip);}

export async function cancelTrip(userId:string,tripId:string,reasonValue:unknown){const reason=String(reasonValue??'').trim().slice(0,200);if(reason.length<3)throw new ApiError(400,'cancel_reason_required');let rescindedDriverId:string|null=null;const trip=await inTransaction(async(client)=>{const locked=(await client.query<TripRow>('SELECT * FROM trips WHERE id=$1 FOR UPDATE',[tripId])).rows[0];if(!locked||(locked.rider_id!==userId&&locked.driver_id!==userId))throw new ApiError(404,'trip_not_found');const actorType=locked.rider_id===userId?'rider':'driver';if(locked.status==='in_progress'||!['scheduled','searching','driver_assigned','driver_arrived'].includes(locked.status))throw new ApiError(409,'trip_cannot_be_cancelled');if(actorType==='driver'&&['scheduled','searching'].includes(locked.status))throw new ApiError(403,'not_trip_participant');if(locked.status==='searching'){const offer=(await client.query<{driver_id:string}>(`UPDATE trip_offers SET status='rescinded',responded_at=now() WHERE trip_id=$1 AND status='sent' RETURNING driver_id`,[tripId])).rows[0];rescindedDriverId=offer?.driver_id??null;}const updated=await transitionTrip(client,{tripId,from:locked.status,to:'cancelled',actorId:userId,actorType,fields:{cancelled_by:actorType,cancel_reason:reason,cancelled_at:new Date()}});await releaseTripHold(client,locked);updated.payment_status=locked.payment_status==='held'?'released':locked.payment_status;return updated;});if(rescindedDriverId){await releaseOfferLock(rescindedDriverId,tripId);emitOfferCancelled(rescindedDriverId,tripId);}if(trip.driver_id)await releaseDriverTripLock(trip.driver_id,tripId);if(trip.payment_status==='released')emitWalletUpdated(trip.rider_id);emitTripStatus(trip);return presentTrip(trip);}

export async function rateTrip(userId:string,tripId:string,ratingValue:unknown,commentValue:unknown){const rating=Number(ratingValue),comment=String(commentValue??'').trim().slice(0,300)||null;if(!Number.isInteger(rating)||rating<1||rating>5)throw new ApiError(400,'invalid_rating');return inTransaction(async(client)=>{const trip=(await client.query<TripRow>('SELECT * FROM trips WHERE id=$1 FOR UPDATE',[tripId])).rows[0];if(!trip||(trip.rider_id!==userId&&trip.driver_id!==userId))throw new ApiError(404,'trip_not_found');if(trip.status!=='completed'||!trip.driver_id)throw new ApiError(409,'trip_not_completed');const rateeId=trip.rider_id===userId?trip.driver_id:trip.rider_id;try{await client.query('INSERT INTO trip_ratings (trip_id,rater_id,ratee_id,rating,comment) VALUES ($1,$2,$3,$4,$5)',[tripId,userId,rateeId,rating,comment]);}catch(error){if((error as{code?:string}).code==='23505')throw new ApiError(409,'trip_already_rated');throw error;}await client.query(`UPDATE users SET rating_avg=((rating_avg*rating_count)+$1)/(rating_count+1),rating_count=rating_count+1,updated_at=now() WHERE id=$2`,[rating,rateeId]);return{success:true};});}

export async function tripHistory(userId:string,activeRole:'rider'|'driver',cursorValue:unknown,limitValue:unknown,statusValue?:unknown,serviceTypeValue?:unknown){
  const limit=Math.min(Math.max(Number(limitValue)||20,1),50);
  const cursor=typeof cursorValue==='string'&&cursorValue?new Date(cursorValue):null;
  if(cursor&&Number.isNaN(cursor.getTime()))throw new ApiError(400,'invalid_cursor');
  const statuses=['completed','returned','cancelled','no_drivers_found'];
  if(statusValue!==undefined&&(typeof statusValue!=='string'||!statuses.includes(statusValue)))throw new ApiError(400,'invalid_status');
  if(serviceTypeValue!==undefined&&serviceTypeValue!=='ride'&&serviceTypeValue!=='courier')throw new ApiError(400,'invalid_service_type');
  const owner=activeRole==='driver'?'driver_id':'rider_id';
  const values:unknown[]=[userId];
  const conditions=[`${owner}=$1`,`status IN ('completed','returned','cancelled','no_drivers_found')`];
  if(statusValue){values.push(statusValue);conditions.push(`status=$${values.length}`);}
  if(serviceTypeValue){values.push(serviceTypeValue);conditions.push(`service_type=$${values.length}`);}
  if(cursor){values.push(cursor);conditions.push(`created_at<$${values.length}`);}
  values.push(limit+1);
  const{rows}=await db.query<TripRow>(`SELECT * FROM trips WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC LIMIT $${values.length}`,values);
  const hasMore=rows.length>limit,items=rows.slice(0,limit).map(presentTrip);
  return{trips:items,nextCursor:hasMore?rows[limit-1]?.created_at.toISOString():null};
}
```

</details>

## src/modules/trips/tripStateMachine.ts

[Open source](../src/modules/trips/tripStateMachine.ts)

SHA-256: `3c0af39ee84b8b77cf99b61b2eec702fb16892206a0f15d341aa64888c2f28ca`

<details>
<summary>Full TypeScript implementation</summary>

```ts
import type { PoolClient } from 'pg';
import { ApiError } from '../../shared/errors';
import type { TripActor, TripRow, TripStatus } from './trip.types';

export const ALLOWED_TRANSITIONS: Readonly<Record<TripStatus, readonly TripStatus[]>> = {
  scheduled: ['searching', 'cancelled'],
  searching: ['driver_assigned', 'no_drivers_found', 'cancelled'],
  driver_assigned: ['driver_arrived', 'cancelled'],
  driver_arrived: ['in_progress', 'cancelled'],
  in_progress: ['completed', 'returning'],
  returning: ['returned'],
  returned: [],
  completed: [],
  cancelled: [],
  no_drivers_found: [],
};

type TransitionFields = Partial<Pick<TripRow,
  'driver_id' | 'accepted_at' | 'arrived_at' | 'started_at' | 'completed_at' |
  'cancelled_at' | 'cancelled_by' | 'cancel_reason' | 'commission_kobo' | 'driver_earning_kobo' | 'requested_at' | 'delivery_verified_at' | 'delivery_issue_reason' | 'returned_at'
>>;

const COLUMN_BY_FIELD: Record<keyof TransitionFields, string> = {
  driver_id: 'driver_id',
  accepted_at: 'accepted_at',
  arrived_at: 'arrived_at',
  started_at: 'started_at',
  completed_at: 'completed_at',
  cancelled_at: 'cancelled_at',
  cancelled_by: 'cancelled_by',
  cancel_reason: 'cancel_reason',
  commission_kobo: 'commission_kobo',
  driver_earning_kobo: 'driver_earning_kobo',
  requested_at: 'requested_at',
  delivery_verified_at: 'delivery_verified_at',
  delivery_issue_reason: 'delivery_issue_reason',
  returned_at: 'returned_at',
};

export function canTransition(from: TripStatus, to: TripStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export async function transitionTrip(client: PoolClient, input: {
  tripId: string;
  from: TripStatus;
  to: TripStatus;
  actorId?: string | null;
  actorType: TripActor;
  fields?: TransitionFields;
  metadata?: Record<string, unknown>;
}): Promise<TripRow> {
  if (!canTransition(input.from, input.to)) {
    throw new ApiError(409, 'invalid_transition', { from: input.from, to: input.to });
  }

  const values: unknown[] = [input.tripId, input.from, input.to];
  const sets = ['status=$3', 'updated_at=now()'];
  for (const [field, value] of Object.entries(input.fields ?? {}) as Array<[keyof TransitionFields, unknown]>) {
    values.push(value);
    sets.push(`${COLUMN_BY_FIELD[field]}=$${values.length}`);
  }
  const { rows } = await client.query<TripRow>(
    `UPDATE trips SET ${sets.join(', ')} WHERE id=$1 AND status=$2 RETURNING *`,
    values,
  );
  const trip = rows[0];
  if (!trip) throw new ApiError(409, 'trip_state_changed');

  await client.query(
    `INSERT INTO trip_status_history (trip_id,from_status,to_status,actor_id,actor_type,metadata)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [input.tripId, input.from, input.to, input.actorId ?? null, input.actorType, input.metadata ?? {}],
  );
  return trip;
}
```

</details>

## src/modules/driver/admin.routes.ts

[Open source](../src/modules/driver/admin.routes.ts)

SHA-256: `279c6d33447a824f2d58b6a754a1c15e76e5de878891c9b594a4d5ac5089adc8`

<details>
<summary>Full TypeScript implementation</summary>

```ts
import { Router } from "express";
import { requireAuth, requireStaffRole } from "../auth/auth.middleware";
import {
  adminApplicationDetail,
  adminApplicationDocument,
  adminApplicationReview,
} from "./admin.controller";
export const driverAdminRouter = Router();
driverAdminRouter.use(requireAuth, requireStaffRole("admin", "super_admin"));
driverAdminRouter.use((_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
driverAdminRouter.get("/driver-applications/:id", adminApplicationDetail);
driverAdminRouter.get(
  "/driver-applications/:id/documents/:kind",
  adminApplicationDocument,
);
driverAdminRouter.post(
  "/driver-applications/:id/review",
  adminApplicationReview,
);
```

</details>

## src/modules/driver/admin.controller.ts

[Open source](../src/modules/driver/admin.controller.ts)

SHA-256: `dab6f835c8c17cbc84829ec48c1d3aae1a02c21ff3eccc21eae85864b4bcdee5`

<details>
<summary>Full TypeScript implementation</summary>

```ts
import type { Request, Response, NextFunction } from "express";
import { ApiError } from "../../shared/errors";
import { adminId } from "../../shared/utils/adminQuery";
import {
  documentKinds,
  getAdminApplication,
  readAdminDocument,
  reviewAdminApplication,
  type DocumentKind,
} from "./admin.service";
export async function adminApplicationDetail(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    res.json(await getAdminApplication(adminId(req.params.id), req.userId!));
  } catch (error) {
    next(error);
  }
}
export async function adminApplicationReview(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    res.json(
      await reviewAdminApplication(
        req.userId!,
        adminId(req.params.id),
        req.body,
      ),
    );
  } catch (error) {
    next(error);
  }
}
export async function adminApplicationDocument(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const kind = req.params.kind;
    if (
      typeof kind !== "string" ||
      !documentKinds.includes(kind as DocumentKind)
    )
      throw new ApiError(400, "invalid_document_kind");
    const document = await readAdminDocument(
      req.userId!,
      adminId(req.params.id),
      kind as DocumentKind,
    );
    res
      .set({
        "Content-Type": document.contentType,
        "Content-Disposition": "inline",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      })
      .send(document.bytes);
  } catch (error) {
    next(error);
  }
}
```

</details>

## src/modules/driver/admin.service.ts

[Open source](../src/modules/driver/admin.service.ts)

SHA-256: `21d87184fcdf3ef71e77a684d1f16cb84240169a5580a354b0f35ce5ddf37eb8`

<details>
<summary>Full TypeScript implementation</summary>

```ts
import { open, realpath } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { db, inTransaction } from "../../shared/config/db";
import { ApiError } from "../../shared/errors";
import { adminId } from "../../shared/utils/adminQuery";
import { documentContentType } from "./driver.service";
import {
  auditInput,
  replayAdminOperation,
} from "../../shared/utils/adminAudit";

export const documentKinds = ["license", "registration", "insurance"] as const;
export type DocumentKind = (typeof documentKinds)[number];
interface ApplicationRow {
  userId: string;
  name: string;
  status: string;
  version: string;
  submittedAt: Date | null;
  reviewedAt: Date | null;
  address: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  plate: string | null;
  license: string | null;
  registration: string | null;
  insurance: string | null;
  rejectionReason: string | null;
}
const projection = `d.user_id AS "userId",u.full_name AS name,d.status,d.updated_at::text AS version,d.submitted_at AS "submittedAt",d.reviewed_at AS "reviewedAt",d.residential_address AS address,d.vehicle_make AS make,d.vehicle_model AS model,d.vehicle_year AS year,d.plate_number AS plate,d.license_doc_url AS license,d.vehicle_reg_doc_url AS registration,d.insurance_doc_url AS insurance,d.rejection_reason AS "rejectionReason"`;
export async function getAdminApplication(userId: string, actorId: string) {
  const { rows } = await db.query<ApplicationRow>(
    `SELECT ${projection} FROM driver_profiles d JOIN users u ON u.id=d.user_id WHERE d.user_id=$1`,
    [userId],
  );
  if (!rows[0]) throw new ApiError(404, "application_not_found");
  await db.query(
    "INSERT INTO admin_audit_log(actor_id,action,target_user_id,reason,metadata) VALUES($1,'driver_application_read',$2,'Staff opened private application details',$3)",
    [actorId, userId, { applicationVersion: rows[0].version }],
  );
  const { license, registration, insurance, ...row } = rows[0];
  return {
    ...row,
    documents: documentKinds.map((kind) => ({
      kind,
      available: Boolean({ license, registration, insurance }[kind]),
    })),
    allowedActions: row.status === "pending" ? ["approve", "reject"] : [],
    asOf: new Date().toISOString(),
  };
}
export async function reviewAdminApplication(
  actorId: string,
  userId: string,
  input: Record<string, unknown>,
) {
  const audit = auditInput(input.reason, input.requestKey);
  if (
    (input.decision !== "approved" && input.decision !== "rejected") ||
    typeof input.expectedVersion !== "string"
  )
    throw new ApiError(400, "invalid_application_decision");
  const decision = input.decision,
    expectedVersion = input.expectedVersion;
  return inTransaction(async (client) => {
    const replay = await replayAdminOperation(
      client,
      actorId,
      "driver_application_review",
      audit.requestKey,
      { userId, decision, expectedVersion, reason: audit.reason },
    );
    if (replay.previous)
      return { status: decision, auditId: replay.previous.id, replayed: true };
    await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [userId]);
    const { rows } = await client.query<ApplicationRow>(
      `SELECT ${projection} FROM driver_profiles d JOIN users u ON u.id=d.user_id WHERE d.user_id=$1 FOR UPDATE OF d,u`,
      [userId],
    );
    const application = rows[0];
    if (!application) throw new ApiError(404, "application_not_found");
    if (
      application.version !== expectedVersion ||
      application.status !== "pending"
    )
      throw new ApiError(409, "application_changed");
    if (decision === "approved" && (
      !application.address ||
      !application.make ||
      !application.model ||
      !application.year ||
      !application.plate ||
      !application.license ||
      !application.registration ||
      !application.insurance
    ))
      throw new ApiError(409, "driver_application_incomplete");
    if (decision === "approved") await Promise.all([application.license,application.registration,application.insurance].map(reference=>readPrivateDocument(userId,reference)));
    await client.query(
      "UPDATE driver_profiles SET status=$2,rejection_reason=$3,reviewed_at=now(),updated_at=now() WHERE user_id=$1",
      [userId, decision, decision === "rejected" ? audit.reason : null],
    );
    const record = await client.query<{ id: string }>(
      `INSERT INTO admin_audit_log(actor_id,action,target_user_id,request_key,reason,metadata) VALUES($1,'driver_application_review',$2,$3,$4,$5) RETURNING id::text`,
      [
        actorId,
        userId,
        audit.requestKey,
        audit.reason,
        {
          operationHash: replay.hash,
          before: "pending",
          after: decision,
          applicationVersion: expectedVersion,
        },
      ],
    );
    return { status: decision, auditId: record.rows[0].id, replayed: false };
  });
}
export async function readAdminDocument(
  actorId: string,
  userId: string,
  kind: DocumentKind,
) {
  const application = await db.query<{
    license: string | null;
    registration: string | null;
    insurance: string | null;
  }>(
    "SELECT license_doc_url AS license,vehicle_reg_doc_url AS registration,insurance_doc_url AS insurance FROM driver_profiles WHERE user_id=$1",
    [userId],
  );
  const {bytes,contentType}=await readPrivateDocument(userId,application.rows[0]?.[kind]);
  await inTransaction(async (client) => {
    await client.query(
      `INSERT INTO admin_audit_log(actor_id,action,target_user_id,request_key,reason,metadata) VALUES($1,'driver_document_view',$2,$3,'Staff application document inspection',$4)`,
      [actorId, userId, randomUUID(), { documentKind: kind }],
    );
  });
  return { bytes, contentType };
}

export async function readPrivateDocument(userId:string,reference:string|null|undefined) {
  if (!reference) throw new ApiError(404, "document_not_found");
  const match =
    /^private:\/\/driver-documents\/([0-9a-f-]{36})\/([0-9a-f-]{36}\.[a-z0-9]+)$/i.exec(
      reference,
    );
  if (!match || adminId(match[1]) !== userId)
    throw new ApiError(404, "document_not_found");
  const directory = resolve(
    process.cwd(),
    ".private-uploads",
    "driver-documents",
    userId,
  );
  let bytes: Buffer;
  try {
    const base = await realpath(
      resolve(process.cwd(), ".private-uploads", "driver-documents"),
    );
    const root = await realpath(directory),
      path = await realpath(resolve(directory, match[2]));
    if (!root.startsWith(base + sep) || !path.startsWith(root + sep))
      throw new Error("path_outside_document_directory");
    const file = await open(path, "r");
    try {
      const info = await file.stat();
      if (!info.isFile() || info.size > 8 * 1024 * 1024)
        throw new ApiError(413, "document_too_large");
      bytes = await file.readFile();
    } finally {
      await file.close();
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(404, "document_unavailable");
  }
  if (bytes.length > 8 * 1024 * 1024)
    throw new ApiError(413, "document_too_large");
  const contentType = documentContentType(bytes);
  if (!contentType) throw new ApiError(415, "unsupported_document_content");
  return {bytes,contentType};
}
```

</details>

## src/modules/driver/driver.service.ts

[Open source](../src/modules/driver/driver.service.ts)

SHA-256: `f4935cef3da9f7958b3cbe267220f82b2bb65c6b751fd12c34ff123cfbcb330b`

<details>
<summary>Full TypeScript implementation</summary>

```ts
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { PoolClient } from 'pg';
import { ApiError } from '../../shared/errors';

/** All material write paths share the same user -> profile locking order. */
export async function assertDriverMaterialEditable(userId:string,client:PoolClient) {
  const user=(await client.query<{role:string}>('SELECT role FROM users WHERE id=$1 AND is_active=true FOR UPDATE',[userId])).rows[0];
  if(!user)throw new ApiError(401,'account_inactive');
  const profile=(await client.query<{status:string}>('SELECT status FROM driver_profiles WHERE user_id=$1 FOR UPDATE',[userId])).rows[0];
  if((await client.query("SELECT 1 FROM trips WHERE (driver_id=$1 OR rider_id=$1) AND status IN ('driver_assigned','driver_arrived','in_progress','returning') LIMIT 1",[userId])).rowCount)throw new ApiError(409,'active_trip_prevents_material_changes');
  if(profile?.status==='approved')throw new ApiError(409,'approved_driver_material_requires_review');
  return {...user,profileStatus:profile?.status??null};
}

export function documentContentType(bytes:Buffer) {
  if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';
  if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';
  if(bytes.subarray(0,5).toString()==='%PDF-')return 'application/pdf';
  if(bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP')return 'image/webp';
  return null;
}

export async function savePersonalInfo(userId: string, input: Record<string, unknown>, client: PoolClient) {
  if(!input||typeof input!=='object'||Array.isArray(input))throw new ApiError(400,'invalid_personal_info');
  const fullName = String(input.fullName ?? '').trim(); const email = String(input.email ?? '').trim().toLowerCase(); const address = String(input.address ?? '').trim();
  if (fullName.length < 2 || fullName.length>120 || email.length>160 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || address.length < 5 || address.length>1000) throw new ApiError(400, 'invalid_personal_info');
  const user=await assertDriverMaterialEditable(userId,client);
  if(user.role!=='user')throw new ApiError(403,'staff_profile_requires_admin');
  await client.query('UPDATE users SET full_name=$1,email=$2,updated_at=now() WHERE id=$3', [fullName, email, userId]);
  const { rows } = await client.query(`INSERT INTO driver_profiles (user_id,status,residential_address) VALUES ($1,'none',$2) ON CONFLICT (user_id) DO UPDATE SET residential_address=$2,updated_at=now() RETURNING *`, [userId, address]);
  return rows[0];
}

export async function saveVehicleInfo(userId: string, input: Record<string, unknown>, client: PoolClient) {
  if(!input||typeof input!=='object'||Array.isArray(input))throw new ApiError(400,'invalid_vehicle_info');
  const make=String(input.make??'').trim(), model=String(input.model??'').trim(), color=String(input.color??'').trim(), plate=String(input.registrationNumber??'').trim().toUpperCase(), year=Number(input.year);
  if (!make || make.length>60 || !model || model.length>60 || !color || color.length>30 || !plate || plate.length>20 || !Number.isInteger(year) || year < 1990 || year > new Date().getFullYear()+1) throw new ApiError(400, 'invalid_vehicle_info');
  await assertDriverMaterialEditable(userId,client);
  const { rows } = await client.query(`UPDATE driver_profiles SET vehicle_make=$1,vehicle_model=$2,vehicle_year=$3,vehicle_color=$4,plate_number=$5,updated_at=now() WHERE user_id=$6 RETURNING *`, [make,model,year,color,plate,userId]);
  if (!rows[0]) throw new ApiError(409, 'personal_info_required'); return rows[0];
}

async function storePrivateDocument(userId: string, file: Express.Multer.File) {
  if (!['application/pdf','image/jpeg','image/png','image/webp'].includes(file.mimetype)) throw new ApiError(400, 'invalid_document_type');
  if (file.size > 8 * 1024 * 1024 || file.buffer.length>8*1024*1024) throw new ApiError(413, 'document_too_large');
  const contentType=documentContentType(file.buffer);
  if(!contentType||contentType!==file.mimetype)throw new ApiError(415,'document_content_type_mismatch');
  const directory = resolve(process.cwd(), '.private-uploads', 'driver-documents', userId); await mkdir(directory, { recursive: true });
  const extension=contentType==='image/png'?'.png':contentType==='image/jpeg'?'.jpg':contentType==='image/webp'?'.webp':'.pdf';
  const name = `${randomUUID()}${extension}`; await writeFile(resolve(directory, name), file.buffer, { mode: 0o600,flag:'wx' });
  return `private://driver-documents/${userId}/${name}`;
}

export async function saveDocuments(userId: string, files: Record<string, Express.Multer.File[]>, client: PoolClient) {
  const license=files?.license?.[0], registration=files?.vehicleRegistration?.[0], insurance=files?.insurance?.[0];
  if (!license || !registration || !insurance) throw new ApiError(400, 'all_documents_required');
  const editable=await assertDriverMaterialEditable(userId,client);
  if(editable.profileStatus===null)throw new ApiError(409,'personal_info_required');
  // Validate all three before writing any of them.
  for(const file of [license,registration,insurance]){
    if(file.buffer.length>8*1024*1024)throw new ApiError(413,'document_too_large');
    if(!documentContentType(file.buffer)||documentContentType(file.buffer)!==file.mimetype)throw new ApiError(415,'document_content_type_mismatch');
  }
  const urls = await Promise.all([storePrivateDocument(userId,license),storePrivateDocument(userId,registration),storePrivateDocument(userId,insurance)]);
  const { rows } = await client.query(`UPDATE driver_profiles SET license_doc_url=$1,vehicle_reg_doc_url=$2,insurance_doc_url=$3,updated_at=now() WHERE user_id=$4 RETURNING *`, [...urls,userId]);
  if (!rows[0]) throw new ApiError(409, 'personal_info_required'); return { documentsUploaded: true };
}

export async function submitApplication(userId: string, client: PoolClient) {
  await assertDriverMaterialEditable(userId,client);
  const { rows } = await client.query(`UPDATE driver_profiles SET status='pending',submitted_at=now(),rejection_reason=NULL,updated_at=now() WHERE user_id=$1 AND residential_address IS NOT NULL AND vehicle_make IS NOT NULL AND license_doc_url IS NOT NULL RETURNING *`, [userId]);
  if (!rows[0]) throw new ApiError(409, 'driver_application_incomplete'); return { status: 'pending', submittedAt: rows[0].submitted_at };
}

export async function applicationStatus(userId: string, client: PoolClient) {
  const { rows } = await client.query('SELECT status,rejection_reason,submitted_at,reviewed_at FROM driver_profiles WHERE user_id=$1', [userId]);
  return rows[0] ?? { status: 'none', rejection_reason: null, submitted_at: null, reviewed_at: null };
}

export async function courierPreference(userId: string, client: PoolClient) {
  const { rows } = await client.query<{ accepts_courier: boolean }>("SELECT accepts_courier FROM driver_profiles WHERE user_id=$1 AND status='approved'", [userId]);
  if (!rows[0]) throw new ApiError(403, 'approved_driver_required');
  return { acceptsCourier: rows[0].accepts_courier };
}

export async function setCourierPreference(userId: string, value: unknown, client: PoolClient) {
  if (typeof value !== 'boolean') throw new ApiError(400, 'invalid_courier_preference');
  const { rows } = await client.query<{ accepts_courier: boolean }>(
    "UPDATE driver_profiles SET accepts_courier=$1,updated_at=now() WHERE user_id=$2 AND status='approved' RETURNING accepts_courier",
    [value, userId],
  );
  if (!rows[0]) throw new ApiError(403, 'approved_driver_required');
  return { acceptsCourier: rows[0].accepts_courier };
}
```

</details>

## src/modules/location/admin.routes.ts

[Open source](../src/modules/location/admin.routes.ts)

SHA-256: `074d2fcc3bee6cf0c1571210ec8d74889f96aced7b539d4f5257708217f8c23b`

<details>
<summary>Full TypeScript implementation</summary>

```ts
import { Router } from "express";
import { requireAuth, requireStaffRole } from "../auth/auth.middleware";
import { adminLive } from "./admin.controller";
export const locationAdminRouter = Router();
locationAdminRouter.use(requireAuth, requireStaffRole("admin", "super_admin"));
locationAdminRouter.get(
  "/live",
  (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  },
  adminLive,
);
```

</details>

## src/modules/location/admin.controller.ts

[Open source](../src/modules/location/admin.controller.ts)

SHA-256: `c44c908fbfdd702bdc3e27aa8e210afcb6d1c243de3e83f17ae88340df8800cb`

<details>
<summary>Full TypeScript implementation</summary>

```ts
import type { Request, Response, NextFunction } from "express";
import { adminLiveSnapshot, parseViewport } from "./admin.service";
export async function adminLive(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    res.json(await adminLiveSnapshot(parseViewport(req.query), req.userId!));
  } catch (error) {
    next(error);
  }
}
```

</details>

## src/modules/location/admin.service.ts

[Open source](../src/modules/location/admin.service.ts)

SHA-256: `802dc82bf688e052d2a324bbed374ac0f9f9e4d363e64076f9e2ebbf6aaddd1a`

<details>
<summary>Full TypeScript implementation</summary>

```ts
import { recordAdminRead } from "../../shared/utils/adminAudit";
import { db } from "../../shared/config/db";
import { ensureRedis } from "../../shared/config/redis";
import { ApiError } from "../../shared/errors";
import { staffSupplyEligibility } from "../matching/matching.service";
import type { DriverCoordinate } from "./location.service";
export interface Viewport {
  south: number;
  north: number;
  west: number;
  east: number;
  service: "ride" | "courier";
  limit: number;
}
export function parseViewport(input: Record<string, unknown>): Viewport {
  for (const key of Object.keys(input))
    if (!["south", "north", "west", "east", "service", "limit"].includes(key))
      throw new ApiError(400, "unsupported_filter");
  const number = (name: string, fallback: number) => {
    const value = input[name];
    if (value === undefined) return fallback;
    if (typeof value !== "string" || !/^[-]?\d+(\.\d+)?$/.test(value))
      throw new ApiError(400, "invalid_viewport");
    return Number(value);
  };
  const viewport = {
    south: number("south", 6.2),
    north: number("north", 6.8),
    west: number("west", 3.1),
    east: number("east", 3.8),
    service: (input.service ?? "ride") as "ride" | "courier",
    limit: number("limit", 100),
  };
  if (
    viewport.south < -90 ||
    viewport.north > 90 ||
    viewport.west < -180 ||
    viewport.east > 180 ||
    viewport.south >= viewport.north ||
    viewport.west >= viewport.east ||
    !Number.isInteger(viewport.limit) ||
    viewport.limit < 1 ||
    viewport.limit > 100 ||
    !["ride", "courier"].includes(viewport.service)
  )
    throw new ApiError(400, "invalid_viewport");
  return viewport;
}
function coordinate(value: unknown, driverId: string): DriverCoordinate | null {
  if (typeof value !== "string") return null;
  try {
    const data: unknown = JSON.parse(value);
    if (
      !data ||
      typeof data !== "object" ||
      !("driverId" in data) ||
      data.driverId !== driverId ||
      !("latitude" in data) ||
      typeof data.latitude !== "number" ||
      !Number.isFinite(data.latitude) ||
      Math.abs(data.latitude) > 90 ||
      !("longitude" in data) ||
      typeof data.longitude !== "number" ||
      !Number.isFinite(data.longitude) ||
      Math.abs(data.longitude) > 180 ||
      !("timestamp" in data) ||
      typeof data.timestamp !== "number" ||
      !Number.isFinite(data.timestamp)
    )
      return null;
    return {
      driverId,
      latitude: data.latitude,
      longitude: data.longitude,
      timestamp: data.timestamp,
    };
  } catch {
    return null;
  }
}
export async function adminLiveSnapshot(viewport: Viewport, actorId: string) {
  await recordAdminRead(actorId, "live_supply_read", "driver_location", null, {
    service: viewport.service,
    limit: viewport.limit,
  });
  const { rows } = await db.query<{
    id: string;
    name: string;
    approval: string;
    vehicle: string;
    plate: string;
    courierOptIn: boolean;
    activeTripId: string | null;
  }>(
    `SELECT d.user_id AS id,u.full_name AS name,d.status AS approval,concat_ws(' ',d.vehicle_make,d.vehicle_model) AS vehicle,d.plate_number AS plate,d.accepts_courier AS "courierOptIn",t.id AS "activeTripId" FROM driver_profiles d JOIN users u ON u.id=d.user_id LEFT JOIN trips t ON t.driver_id=d.user_id AND t.status IN ('driver_assigned','driver_arrived','in_progress','returning') WHERE (d.status='approved' AND u.is_active=true) OR t.id IS NOT NULL ORDER BY (t.id IS NOT NULL) DESC,d.user_id LIMIT $1`,
    [viewport.limit + 1],
  );
  const capped = rows.length > viewport.limit,
    candidates = rows.slice(0, viewport.limit),
    asOf = new Date().toISOString();
  const eligible = await staffSupplyEligibility(
    candidates.map((row) => row.id),
    viewport.service,
  );
  try {
    const redis = await ensureRedis(),
      pipeline = redis.pipeline();
    for (const driver of candidates) {
      pipeline.get(`driver:${driver.id}:location`);
      pipeline.get(`driver:${driver.id}:status`);
      pipeline.exists(`driver:${driver.id}:onTrip`);
    }
    const state = await pipeline.exec();
    if (!state || state.some((cell) => cell[0]))
      throw new Error("redis_snapshot_failed");
    const drivers = candidates.flatMap((driver, index) => {
      const location = coordinate(state[index * 3]?.[1], driver.id),
        age = location ? Date.parse(asOf) - location.timestamp : null;
      const fresh = age !== null && age >= 0 && age < 30000;
      if (
        location &&
        fresh &&
        (location.latitude < viewport.south ||
          location.latitude > viewport.north ||
          location.longitude < viewport.west ||
          location.longitude > viewport.east)
      )
        return [];
      const online = state[index * 3 + 1]?.[1] === "online",
        locked = Number(state[index * 3 + 2]?.[1]) > 0;
      return [
        {
          ...driver,
          availability: driver.activeTripId
            ? "busy"
            : fresh && online && !locked && eligible.has(driver.id)
              ? "available"
              : !fresh
                ? "location_unavailable"
                : locked
                  ? "busy"
                  : "ineligible",
          location: fresh
            ? {
                latitude: location!.latitude,
                longitude: location!.longitude,
                at: new Date(location!.timestamp).toISOString(),
              }
            : null,
        },
      ];
    });
    return {
      drivers,
      asOf,
      scope: viewport,
      capped,
      locationState: "ready",
      transport: "Authorized REST snapshot",
      availableDriversInSnapshot: drivers.filter(
        (driver) => driver.availability === "available",
      ).length,
    };
  } catch {
    return {
      drivers: candidates.map((driver) => ({
        ...driver,
        availability: driver.activeTripId ? "busy" : "unknown",
        location: null,
      })),
      asOf,
      scope: viewport,
      capped,
      locationState: "unavailable",
      transport: "Authorized REST snapshot",
      availableDriversInSnapshot: null,
    };
  }
}

/** Exact current eligibility count within a bounded scan; null if scan cannot be complete. */
export async function adminAvailableCount() {
  const candidates = (
    await db.query<{ id: string }>(
      "SELECT d.user_id AS id FROM driver_profiles d JOIN users u ON u.id=d.user_id WHERE d.status='approved' AND u.is_active=true ORDER BY d.user_id LIMIT 1001",
    )
  ).rows;
  if (candidates.length > 1000) return null;
  const eligible = await staffSupplyEligibility(
    candidates.map((d) => d.id),
    "ride",
  );
  try {
    const redis = await ensureRedis(),
      pipe = redis.pipeline();
    for (const d of candidates) {
      pipe.get(`driver:${d.id}:location`);
      pipe.get(`driver:${d.id}:status`);
      pipe.exists(`driver:${d.id}:onTrip`);
    }
    const values = await pipe.exec();
    if (!values || values.some((v) => v[0])) return null;
    const now = Date.now();
    return candidates.filter((d, i) => {
      const pos = coordinate(values[i * 3]?.[1], d.id);
      return (
        eligible.has(d.id) &&
        pos &&
        now - pos.timestamp >= 0 &&
        now - pos.timestamp < 30000 &&
        values[i * 3 + 1]?.[1] === "online" &&
        Number(values[i * 3 + 2]?.[1]) === 0
      );
    }).length;
  } catch {
    return null;
  }
}

/** Current position only; permanent trip samples are never a live-location fallback. */
export async function adminDriverPosition(
  driverId: string | null,
  activeTrip: boolean,
) {
  const asOf = new Date().toISOString();
  if (!driverId || !activeTrip)
    return { location: null, state: "not_applicable" as const, asOf };
  try {
    const redis = await ensureRedis();
    const point = coordinate(
      await redis.get(`driver:${driverId}:location`),
      driverId,
    );
    const age = point ? Date.parse(asOf) - point.timestamp : null;
    if (!point || age === null || age < 0 || age >= 30000)
      return { location: null, state: "unavailable" as const, asOf };
    return {
      location: {
        latitude: point.latitude,
        longitude: point.longitude,
        at: new Date(point.timestamp).toISOString(),
      },
      state: "fresh" as const,
      asOf,
    };
  } catch {
    return { location: null, state: "unavailable" as const, asOf };
  }
}

/** Directory presence contains timestamps and reasons, never live coordinates or another location store. */
export async function adminDriverPresence(ids: string[]) {
  const result = new Map<string,{availability:string;locationAt:string|null;presenceReason:string}>();
  if(!ids.length) return result;
  const eligible=await staffSupplyEligibility(ids,'ride');
  try {
    const redis=await ensureRedis();const pipeline=redis.pipeline();
    for(const id of ids){pipeline.get(`driver:${id}:location`);pipeline.get(`driver:${id}:status`);pipeline.exists(`driver:${id}:onTrip`);}
    const values=await pipeline.exec();if(!values || values.some(v=>v[0])) throw new Error('presence_unavailable');
    ids.forEach((id,index)=>{
      const location=coordinate(values[index*3]?.[1],id);const age=location ? Date.now()-location.timestamp:null;
      const online=values[index*3+1]?.[1]==='online';const locked=Number(values[index*3+2]?.[1])>0;
      const fresh=age!==null && age>=0 && age<30000;
      const availability=locked?'busy':!online?'offline':!fresh?'stale':!eligible.has(id)?'ineligible':'available';
      result.set(id,{availability,locationAt:location?new Date(location.timestamp).toISOString():null,presenceReason:locked?'Driver trip lock is held':!online?'No current online status':!fresh?'No location update within 30 seconds':!eligible.has(id)?'Approval, account, driver mode, cash debt or active-trip eligibility check failed':'Eligible for passenger matching'});
    });
  } catch { for(const id of ids) result.set(id,{availability:'unknown',locationAt:null,presenceReason:'Redis presence could not be observed'}); }
  return result;
}
```

</details>

## src/modules/care/care.routes.ts

[Open source](../src/modules/care/care.routes.ts)

SHA-256: `a334ed1a982ca687c34057b40cfbe5f7c5423b2e8b06085f6ce63fc40260b986`

<details>
<summary>Full TypeScript implementation</summary>

```ts
import { Router } from "express";
import { requireAuth, requireStaffRole } from "../auth/auth.middleware";
import {
  careList,
  careDetail,
  careCreate,
  careChange,
  supportSettingsRead,
  supportSettingsUpdate,
} from "./care.controller";
export const careAdminRouter = Router();
export const careCustomerRouter = Router();
careCustomerRouter.use(requireAuth);
careCustomerRouter.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
careCustomerRouter.get('/settings', supportSettingsRead);
careAdminRouter.use(requireAuth);
careAdminRouter.use((_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
careAdminRouter.get('/support-settings', requireStaffRole('admin', 'super_admin'), supportSettingsRead);
careAdminRouter.patch('/support-settings', requireStaffRole('super_admin'), supportSettingsUpdate);
for (const kind of ["support", "safety"] as const) {
  const roles =
    kind === "safety"
      ? requireStaffRole("super_admin")
      : requireStaffRole("admin", "super_admin");
  careAdminRouter.get(`/${kind}`, roles, careList(kind));
  careAdminRouter.post(`/${kind}`, roles, careCreate(kind));
  careAdminRouter.get(`/${kind}/:id`, roles, careDetail(kind));
  careAdminRouter.post(`/${kind}/:id/activity`, roles, careChange(kind));
}
```

</details>

## src/modules/care/care.controller.ts

[Open source](../src/modules/care/care.controller.ts)

SHA-256: `778114129c2420fbdb26eb679563e4d05c7f71ee57afdf2e159a1625efc1a80d`

<details>
<summary>Full TypeScript implementation</summary>

```ts
import type { Request, Response, NextFunction } from "express";
import { ApiError } from "../../shared/errors";
import {
  adminId,
  adminQuery,
  entryPageQuery,
} from "../../shared/utils/adminQuery";
import {
  careStatuses,
  listCare,
  getCare,
  createCare,
  changeCare,
  type CareKind,
  getSupportSettings,
  updateSupportSettings,
} from "./care.service";
const body = (req: Request): Record<string, unknown> => {
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body))
    throw new ApiError(400, "invalid_body");
  return req.body;
};
export async function supportSettingsRead(_req: Request, res: Response, next: NextFunction) {
  try { res.json(await getSupportSettings()); } catch (error) { next(error); }
}
export async function supportSettingsUpdate(req: Request, res: Response, next: NextFunction) {
  try { res.json(await updateSupportSettings(req.userId!, body(req))); } catch (error) { next(error); }
}
export const careList =
  (kind: CareKind) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (req.query.service || req.query.mode)
        throw new ApiError(400, "unsupported_filter");
      res.json(await listCare(kind, adminQuery(req.query, careStatuses(kind))));
    } catch (error) {
      next(error);
    }
  };
export const careDetail =
  (kind: CareKind) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (req.query.page !== undefined)
        throw new ApiError(400, "unsupported_filter");
      res.json(
        await getCare(
          req.userId!,
          kind,
          adminId(req.params.id),
          entryPageQuery(req.query).before,
        ),
      );
    } catch (error) {
      next(error);
    }
  };
export const careCreate =
  (kind: CareKind) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await createCare(req.userId!, kind, body(req)));
    } catch (error) {
      next(error);
    }
  };
export const careChange =
  (kind: CareKind) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(
        await changeCare(req.userId!, kind, adminId(req.params.id), body(req)),
      );
    } catch (error) {
      next(error);
    }
  };
```

</details>

## src/modules/care/care.service.ts

[Open source](../src/modules/care/care.service.ts)

SHA-256: `cec2b1fe39020282c98649cb68eb17fcfa5689502ce21d223330f3f417dbeb21`

<details>
<summary>Full TypeScript implementation</summary>

```ts
import { readAdminRows } from "../../shared/utils/adminPagination";
import { staffSearchRows } from "../../shared/utils/adminSearch";
import { db, inTransaction } from "../../shared/config/db";
import { ApiError } from "../../shared/errors";
import {
  adminId,
  adminPage,
  type AdminQuery,
} from "../../shared/utils/adminQuery";
import {
  auditInput,
  replayAdminOperation,
} from "../../shared/utils/adminAudit";
import type { PoolClient } from "pg";
export type CareKind = "support" | "safety";

export interface SupportSettings {
  phone: string | null;
  email: string | null;
  staffedHours: string;
  availabilityMessage: string;
  version: number;
  updatedAt: Date;
}

const supportSettingsSelect = `SELECT phone,email,staffed_hours AS "staffedHours",
  availability_message AS "availabilityMessage",version,updated_at AS "updatedAt" FROM support_settings WHERE id=true`;

export async function getSupportSettings(): Promise<SupportSettings> {
  const { rows } = await db.query<SupportSettings>(supportSettingsSelect);
  if (!rows[0]) throw new ApiError(503, 'support_settings_unavailable');
  return rows[0];
}

export async function updateSupportSettings(actorId: string, input: Record<string, unknown>) {
  const allowed = ['phone', 'email', 'staffedHours', 'availabilityMessage', 'expectedVersion', 'reason', 'requestKey'];
  if (Object.keys(input).some((key) => !allowed.includes(key))) throw new ApiError(400, 'unsupported_setting');
  const { reason, requestKey } = auditInput(input.reason, input.requestKey);
  const expectedVersion = input.expectedVersion;
  if (!Number.isSafeInteger(expectedVersion) || Number(expectedVersion) < 1) throw new ApiError(400, 'invalid_version');
  const has = (key: string) => Object.prototype.hasOwnProperty.call(input, key);
  const phone = input.phone === null ? null : typeof input.phone === 'string' ? input.phone.trim() : null;
  const email = input.email === null ? null : typeof input.email === 'string' ? input.email.trim().toLowerCase() : null;
  if (has('phone') && input.phone !== null && (!phone || !/^\+[1-9]\d{7,14}$/.test(phone))) throw new ApiError(400, 'invalid_support_phone');
  if (has('email') && input.email !== null && (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new ApiError(400, 'invalid_support_email');
  const staffedHours = has('staffedHours') ? text(input.staffedHours, 1, 160) : null;
  const availabilityMessage = has('availabilityMessage') ? text(input.availabilityMessage, 1, 300) : null;
  if (!['phone', 'email', 'staffedHours', 'availabilityMessage'].some(has)) throw new ApiError(400, 'missing_settings_changes');
  return inTransaction(async (client) => {
    const op = await replayAdminOperation(client, actorId, 'support_settings_updated', requestKey,
      { phone, email, staffedHours, availabilityMessage, fields: allowed.filter(has), expectedVersion, reason }, ['super_admin']);
    if (op.previous) {
      const previous = await client.query<{ settings: SupportSettings }>("SELECT metadata->'after' AS settings FROM admin_audit_log WHERE id=$1", [op.previous.id]);
      return { settings: previous.rows[0].settings, auditId: op.previous.id, replayed: true };
    }
    const before = (await client.query<SupportSettings>(`${supportSettingsSelect} FOR UPDATE`)).rows[0];
    if (!before) throw new ApiError(503, 'support_settings_unavailable');
    if (before.version !== expectedVersion) throw new ApiError(409, 'settings_version_conflict', { currentVersion: before.version });
    await client.query(`UPDATE support_settings SET phone=CASE WHEN $1 THEN $2 ELSE phone END,
      email=CASE WHEN $3 THEN $4 ELSE email END,staffed_hours=CASE WHEN $5 THEN $6 ELSE staffed_hours END,
      availability_message=CASE WHEN $7 THEN $8 ELSE availability_message END,version=version+1,updated_by=$9,updated_at=now() WHERE id=true`,
      [has('phone'), phone, has('email'), email, has('staffedHours'), staffedHours, has('availabilityMessage'), availabilityMessage, actorId]);
    const after = (await client.query<SupportSettings>(supportSettingsSelect)).rows[0];
    const audit = await client.query<{ id: string }>(`INSERT INTO admin_audit_log(actor_id,action,reason,request_key,object_type,before_version,after_version,metadata)
      VALUES($1,'support_settings_updated',$2,$3,'support_settings',$4,$5,$6) RETURNING id::text`,
      [actorId, reason, requestKey, JSON.stringify(before), JSON.stringify(after), JSON.stringify({ operationHash: op.hash, after })]);
    return { settings: after, auditId: audit.rows[0].id, replayed: false };
  });
}
// Identifiers come exclusively from this fixed server registry, never request input.
const registry = {
  support: {
    table: "support_cases",
    link: "case_id",
    roles: ["admin", "super_admin"],
    initial: "new",
    states: {
      new: ["assigned", "waiting_internal", "resolved"],
      assigned: ["waiting_customer", "waiting_internal", "resolved"],
      waiting_customer: ["assigned", "waiting_internal", "resolved"],
      waiting_internal: ["assigned", "waiting_customer", "resolved"],
      resolved: ["reopened"],
      reopened: ["assigned", "waiting_internal", "resolved"],
    },
  },
  safety: {
    table: "safety_incidents",
    link: "incident_id",
    roles: ["super_admin"],
    initial: "open",
    states: {
      open: ["acknowledged"],
      acknowledged: ["responding", "resolved"],
      responding: ["resolved"],
      resolved: ["reviewed"],
      reviewed: [],
    },
  },
} as const;
interface CareRow {
  id: string;
  status: string;
  severity: string;
  assigned_staff_id: string | null;
  version: number;
  next_action?: string;
}
function text(value: unknown, min: number, max: number) {
  if (
    typeof value !== "string" ||
    value.trim().length < min ||
    value.trim().length > max
  )
    throw new ApiError(400, "invalid_care_text");
  return value.trim();
}
function severity(value: unknown) {
  if (
    typeof value !== "string" ||
    !["low", "medium", "high", "critical"].includes(value)
  )
    throw new ApiError(400, "invalid_severity");
  return value;
}
const optionalId = (value: unknown) =>
  value == null || value === "" ? null : adminId(value);
function snapshot(row: CareRow) {
  return {
    status: row.status,
    severity: row.severity,
    assignedStaffId: row.assigned_staff_id,
    version: row.version,
  };
}
async function links(
  client: PoolClient,
  customerId: string | null,
  tripId: string | null,
  paymentId: string | null,
) {
  if (
    customerId &&
    !(await client.query("SELECT id FROM users WHERE id=$1", [customerId]))
      .rows[0]
  )
    throw new ApiError(404, "customer_not_found");
  if (tripId) {
    const trip = (
      await client.query("SELECT rider_id,driver_id FROM trips WHERE id=$1", [
        tripId,
      ])
    ).rows[0];
    if (!trip) throw new ApiError(404, "trip_not_found");
    if (customerId && ![trip.rider_id, trip.driver_id].includes(customerId))
      throw new ApiError(409, "customer_trip_mismatch");
  }
  if (paymentId) {
    const payment = (
      await client.query("SELECT user_id FROM payment_intents WHERE id=$1", [
        paymentId,
      ])
    ).rows[0];
    if (!payment) throw new ApiError(404, "payment_not_found");
    if (!customerId || payment.user_id !== customerId)
      throw new ApiError(409, "customer_payment_mismatch");
  }
}
async function audit(
  client: PoolClient,
  actor: string,
  kind: CareKind,
  id: string,
  action: string,
  reason: string,
  key: string,
  hash: string,
  before: object | null,
  after: object,
) {
  const { rows } = await client.query(
    `INSERT INTO admin_audit_log(actor_id,action,reason,request_key,object_type,object_id,before_version,after_version,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id::text`,
    [
      actor,
      action,
      reason,
      key,
      kind,
      id,
      before,
      after,
      { operationHash: hash },
    ],
  );
  return rows[0].id as string;
}
export async function listCare(kind: CareKind, q: AdminQuery) {
  const table = registry[kind].table;
  const { rows, ...paging } = await readAdminRows<{
    id: string;
    _cursor: string;
    [key: string]: unknown;
  }>(
    {
      select: `SELECT c.id,c.subject,c.status,c.severity,c.version,c.customer_id AS "customerId",c.trip_id AS "tripId",c.assigned_staff_id AS "assignedStaffId",u.full_name AS "assignedStaff",c.created_at AS "createdAt",c.updated_at AS "updatedAt",c.created_at::text AS _cursor ${kind === "support" ? ',c.response_due_at AS "responseDueAt"' : ""} FROM ${table} c LEFT JOIN users u ON u.id=c.assigned_staff_id WHERE ($1::text IS NULL OR c.status=$1) AND ($2::uuid IS NULL OR c.id=$2) AND ($3::timestamptz IS NULL OR (c.created_at,c.id)<($3::timestamptz,$4::uuid))`,
      orderBy: `c.created_at DESC,c.id DESC`,
      limitParameter: 5,
    },
    [q.status, q.id, q.cursor?.at ?? null, q.cursor?.id ?? null, q.limit + 1],
    q,
  );
  return adminPage(rows, q, "created_at", paging);
}
export async function getCare(
  actor: string,
  kind: CareKind,
  id: string,
  before: string | null = null,
) {
  return inTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT c.*,u.full_name AS assigned_staff FROM ${registry[kind].table} c LEFT JOIN users u ON u.id=c.assigned_staff_id WHERE c.id=$1`,
      [id],
    );
    if (!rows[0]) throw new ApiError(404, "care_record_not_found");
    await client.query(
      "INSERT INTO admin_audit_log(actor_id,action,reason,object_type,object_id) VALUES($1,$2,$3,$4,$5)",
      [actor, `${kind}_sensitive_read`, "Staff opened care record", kind, id],
    );
    const activity = (
      await client.query(
        `SELECT a.id::text,a.kind,a.body,a.visibility,a.delivery_status AS "deliveryStatus",a.metadata,u.full_name AS actor,a.created_at AS "createdAt" FROM care_activity a JOIN users u ON u.id=a.actor_id WHERE a.${registry[kind].link}=$1 AND ($2::bigint IS NULL OR a.id<$2) ORDER BY a.id DESC LIMIT 51`,
        [id, before],
      )
    ).rows;
    return {
      record: rows[0],
      activity: activity.slice(0, 50),
      nextActivityId: activity.length > 50 ? activity[49].id : null,
      allowedStates:
        registry[kind].states[
          rows[0].status as keyof (typeof registry)[typeof kind]["states"]
        ] ?? [],
      asOf: new Date().toISOString(),
    };
  });
}
export async function createCare(
  actor: string,
  kind: CareKind,
  input: Record<string, unknown>,
) {
  const { reason, requestKey } = auditInput(input.reason, input.requestKey);
  const subject = text(input.subject, 5, 160),
    body = text(input.body, 5, 4000),
    level = severity(input.severity);
  const customerId = optionalId(input.customerId),
    tripId = optionalId(input.tripId),
    paymentId = kind === "support" ? optionalId(input.paymentId) : null;
  const nextAction = kind === "safety" ? text(input.nextAction, 5, 1000) : null;
  const category = kind === "support" ? text(input.category, 2, 40) : null;
  if (category && !["trip", "payment", "account", "other"].includes(category))
    throw new ApiError(400, "invalid_category");
  return inTransaction(async (client) => {
    const action = `${kind}_created`;
    const op = await replayAdminOperation(
      client,
      actor,
      action,
      requestKey,
      {
        kind,
        subject,
        body,
        level,
        customerId,
        tripId,
        paymentId,
        nextAction,
        category,
        reason,
      },
      registry[kind].roles,
    );
    if (op.previous) {
      const existing = (
        await client.query(
          "SELECT object_id AS id FROM admin_audit_log WHERE id=$1",
          [op.previous.id],
        )
      ).rows[0];
      return { id: existing.id, auditId: op.previous.id, replayed: true };
    }
    await links(client, customerId, tripId, paymentId);
    const { rows } =
      kind === "support"
        ? await client.query<CareRow>(
            "INSERT INTO support_cases(customer_id,trip_id,payment_id,category,severity,subject,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
            [customerId, tripId, paymentId, category, level, subject, actor],
          )
        : await client.query<CareRow>(
            "INSERT INTO safety_incidents(customer_id,trip_id,severity,subject,next_action,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
            [customerId, tripId, level, subject, nextAction, actor],
          );
    const row = rows[0];
    await client.query(
      `INSERT INTO care_activity(${registry[kind].link},actor_id,kind,body) VALUES($1,$2,'created',$3)`,
      [row.id, actor, body],
    );
    const auditId = await audit(
      client,
      actor,
      kind,
      row.id,
      action,
      reason,
      requestKey,
      op.hash,
      null,
      snapshot(row),
    );
    return { id: row.id, auditId, version: row.version };
  });
}
export async function changeCare(
  actor: string,
  kind: CareKind,
  id: string,
  input: Record<string, unknown>,
) {
  const { reason, requestKey } = auditInput(input.reason, input.requestKey);
  if (!Number.isSafeInteger(input.version) || Number(input.version) < 1)
    throw new ApiError(400, "expected_version_required");
  const verb = input.action;
  if (!["note", "transition", "assign"].includes(String(verb)))
    throw new ApiError(400, "invalid_care_action");
  const body = verb === "note" ? text(input.body, 5, 4000) : reason;
  const state = verb === "transition" ? text(input.status, 2, 24) : null;
  const assignee = verb === "assign" ? optionalId(input.assignedStaffId) : null;
  const nextAction =
    kind === "safety" && input.nextAction !== undefined
      ? text(input.nextAction, 5, 1000)
      : null;
  return inTransaction(async (client) => {
    const action = `${kind}_${verb}`;
    const op = await replayAdminOperation(
      client,
      actor,
      action,
      requestKey,
      {
        id,
        version: input.version,
        verb,
        body,
        state,
        assignee,
        nextAction,
        reason,
      },
      registry[kind].roles,
    );
    if (op.previous) return { auditId: op.previous.id, replayed: true };
    const current = (
      await client.query<CareRow>(
        `SELECT * FROM ${registry[kind].table} WHERE id=$1 FOR UPDATE`,
        [id],
      )
    ).rows[0];
    if (!current) throw new ApiError(404, "care_record_not_found");
    if (current.version !== input.version)
      throw new ApiError(409, "care_version_conflict");
    if (verb === "transition") {
      const allowed = registry[kind].states[
        current.status as keyof (typeof registry)[typeof kind]["states"]
      ] as readonly string[] | undefined;
      if (!state || !allowed?.includes(state))
        throw new ApiError(409, "invalid_care_transition");
    }
    if (verb === "assign" && assignee) {
      const user = (
        await client.query<{ role: string }>(
          "SELECT role FROM users WHERE id=$1 AND is_active=true",
          [assignee],
        )
      ).rows[0];
      if (
        !user ||
        !(registry[kind].roles as readonly string[]).includes(user.role)
      )
        throw new ApiError(400, "invalid_staff_assignee");
    }
    const changed = (
      await client.query<CareRow>(
        `UPDATE ${registry[kind].table} SET status=COALESCE($2,status),assigned_staff_id=CASE WHEN $3 THEN $4::uuid ELSE assigned_staff_id END,version=version+1,updated_at=now() ${kind === "safety" ? ",next_action=COALESCE($5,next_action)" : ""} WHERE id=$1 RETURNING *`,
        kind === "safety"
          ? [id, state, verb === "assign", assignee, nextAction]
          : [id, state, verb === "assign", assignee],
      )
    ).rows[0];
    await client.query(
      `INSERT INTO care_activity(${registry[kind].link},actor_id,kind,body,metadata) VALUES($1,$2,$3,$4,$5)`,
      [
        id,
        actor,
        verb === "transition"
          ? "state_change"
          : verb === "assign"
            ? "assignment"
            : "note",
        body,
        {
          before: snapshot(current),
          after: snapshot(changed),
          ...(nextAction ? { nextAction } : {}),
        },
      ],
    );
    const auditId = await audit(
      client,
      actor,
      kind,
      id,
      action,
      reason,
      requestKey,
      op.hash,
      snapshot(current),
      snapshot(changed),
    );
    return { id, auditId, version: changed.version };
  });
}
export const careStatuses = (kind: CareKind) =>
  Object.keys(registry[kind].states);

export async function searchAdminCare(
  kind: CareKind,
  input: import("../../shared/utils/adminSearch").SearchRead,
): Promise<import("../../shared/utils/adminSearch").StaffSearchHit[]> {
  const rows = await staffSearchRows<{
    id: string;
    subject: string;
    status: string;
  }>(
    `SELECT id,subject,status FROM ${registry[kind].table} WHERE (id::text=$1 OR lower(subject) LIKE $2 ESCAPE '!') AND ($3::uuid IS NULL OR id>$3) ORDER BY id LIMIT $4`,
    [
      input.query.toLowerCase(),
      input.prefix,
      input.after?.id ?? null,
      input.limit + 1,
    ],
  );
  return rows.map((row) => ({
    id: row.id,
    type: kind,
    title: row.subject,
    subtitle: row.status,
    href: `/admin/${kind}/${row.id}`,
  }));
}
```

</details>

## src/modules/payments/dashboard.routes.ts

[Open source](../src/modules/payments/dashboard.routes.ts)

SHA-256: `ca94a8a39e0cedc553d2d34a9f92af54a0939c9ec596a8c56d4c99e89839fa94`

<details>
<summary>Full TypeScript implementation</summary>

```ts
import {
  getAdminIntent,
  getAdminWithdrawal,
  reconciliationExceptions,
  listAdminWebhookExceptions,
} from "./dashboard.service";
import { adminQuery } from "../../shared/utils/adminQuery";
import { adminId, entryPageQuery } from "../../shared/utils/adminQuery";
import { Router } from "express";
import { requireAuth, requireStaffRole } from "../auth/auth.middleware";
import { dashboardList, dashboardRead } from "./dashboard.controller";
import {
  getAdminAccount,
  getAdminTransaction,
  refundEligibility,
  adminOperationStatus,
  getAdminAudit,
  auditQuery,
  getAdminReconciliation,
  listAdminAccounts,
  listAdminIntents,
  listAdminWithdrawals,
} from "./dashboard.service";
export const financeDashboardRouter = Router();
financeDashboardRouter.use(
  requireAuth,
  requireStaffRole("admin", "super_admin"),
);
financeDashboardRouter.use((_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
financeDashboardRouter.get(
  "/payment-intents",
  dashboardList(
    listAdminIntents,
    ["pending", "succeeded", "failed", "abandoned", "mismatch"],
    "intents",
  ),
);
financeDashboardRouter.get(
  "/withdrawals",
  dashboardList(
    listAdminWithdrawals,
    ["pending", "processing", "success", "failed", "reversed"],
    "withdrawals",
  ),
);
financeDashboardRouter.get("/accounts", dashboardList(listAdminAccounts));
financeDashboardRouter.get(
  "/reconciliation",
  dashboardRead(getAdminReconciliation),
);
financeDashboardRouter.get("/audit", async (req, res, next) => {
  try {
    res.json(await getAdminAudit(auditQuery(req.query), req.authUser!.role));
  } catch (error) {
    next(error);
  }
});

financeDashboardRouter.get("/accounts/:id", async (req, res, next) => {
  try {
    res.json(
      await getAdminAccount(
        adminId(req.params.id),
        entryPageQuery(req.query),
        req.userId!,
      ),
    );
  } catch (error) {
    next(error);
  }
});
financeDashboardRouter.get("/transactions/:id", async (req, res, next) => {
  try {
    res.json(await getAdminTransaction(adminId(req.params.id), req.userId!));
  } catch (error) {
    next(error);
  }
});
financeDashboardRouter.get(
  "/refund-eligibility/:id",
  async (req, res, next) => {
    try {
      res.json(await refundEligibility(adminId(req.params.id)));
    } catch (error) {
      next(error);
    }
  },
);
financeDashboardRouter.get("/operations/:key", async (req, res, next) => {
  try {
    res.json(await adminOperationStatus(req.userId!, adminId(req.params.key)));
  } catch (error) {
    next(error);
  }
});

financeDashboardRouter.get("/payment-intents/:id", async (req, res, next) => {
  try {
    res.json(await getAdminIntent(adminId(req.params.id), req.userId!));
  } catch (error) {
    next(error);
  }
});
financeDashboardRouter.get("/withdrawals/:id", async (req, res, next) => {
  try {
    res.json(await getAdminWithdrawal(adminId(req.params.id), req.userId!));
  } catch (error) {
    next(error);
  }
});
financeDashboardRouter.get("/reconciliation/:kind", async (req, res, next) => {
  try {
    res.json(
      req.params.kind === "webhooks" ? await listAdminWebhookExceptions(entryPageQuery(req.query), req.userId!) : await reconciliationExceptions(
        String(req.params.kind),
        adminQuery(req.query),
        req.userId!,
      ),
    );
  } catch (error) {
    next(error);
  }
});
```

</details>

## src/modules/payments/dashboard.controller.ts

[Open source](../src/modules/payments/dashboard.controller.ts)

SHA-256: `69d3eb74cc5b9846bf61e4ef1cab5a7977390070f91e4c588fc95dcf27f7b003`

<details>
<summary>Full TypeScript implementation</summary>

```ts
import { parseFinanceQuery, type FinanceQuery } from "./dashboard.service";
import type { Request, Response, NextFunction } from "express";
import { adminQuery, type AdminQuery } from "../../shared/utils/adminQuery";
import { ApiError } from "../../shared/errors";
export const dashboardList =
  (
    service: (query: FinanceQuery, actorId: string) => Promise<unknown>,
    statuses: readonly string[] = [],
    kind: "intents" | "withdrawals" | "accounts" = "accounts",
  ) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const query = parseFinanceQuery(req.query, kind, statuses);
      if (query.service) throw new ApiError(400, "unsupported_filter");
      res.json(await service(query, req.userId!));
    } catch (error) {
      next(error);
    }
  };
export const dashboardRead =
  (service: () => Promise<unknown>) =>
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await service());
    } catch (error) {
      next(error);
    }
  };
```

</details>

## src/modules/payments/dashboard.service.ts

[Open source](../src/modules/payments/dashboard.service.ts)

SHA-256: `0016046f09492d64799c1376daf464823339c04b759f908a3aed0d4359b14a84`

<details>
<summary>Full TypeScript implementation</summary>

```ts
import { visibleAuditChanges } from "../../shared/utils/adminAudit";
import {
  readAdminRows,
  type AdminPagingResult,
} from "../../shared/utils/adminPagination";
import { staffSearchRows } from "../../shared/utils/adminSearch";
import { recordAdminRead } from "../../shared/utils/adminAudit";
import { ApiError } from "../../shared/errors";
import { db } from "../../shared/config/db";
import {
  adminPage,
  adminQuery,
  adminId,
  entryPageQuery,
  type AdminQuery,
} from "../../shared/utils/adminQuery";
interface Row {
  id: string;
  _cursor: string;
  [key: string]: unknown;
}
export interface FinanceQuery extends AdminQuery {
  target?: string | null;
  reference?: string | null;
  from?: string | null;
  to?: string | null;
  minKobo?: string | null;
  maxKobo?: string | null;
  userId?: string | null;
  kind?: string | null;
  ownerUserId?: string | null;
}
export function parseFinanceQuery(
  input: Record<string, unknown>,
  kind: "intents" | "withdrawals" | "accounts",
  statuses: readonly string[],
): FinanceQuery {
  const extras =
    kind === "accounts"
      ? ["kind", "ownerUserId"]
      : [
          "reference",
          "from",
          "to",
          "minKobo",
          "maxKobo",
          "userId",
          ...(kind === "intents" ? ["target"] : []),
        ];
  const base: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (extras.includes(key)) continue;
    if (!["page", "limit", "cursor", "id", "status"].includes(key))
      throw new ApiError(400, "unsupported_filter");
    base[key] = value;
  }
  const query: FinanceQuery = adminQuery(base, statuses);
  const text = (key: string, max = 200) => {
    const value = input[key];
    if (value === undefined || value === "") return null;
    if (typeof value !== "string" || value.length > max)
      throw new ApiError(400, "invalid_finance_filter");
    return value;
  };
  query.reference = text("reference", 80);
  query.target = text("target");
  query.kind = text("kind");
  if (
    (query.target && !["wallet", "earnings"].includes(query.target)) ||
    (query.kind && !["wallet", "earnings", "system"].includes(query.kind))
  )
    throw new ApiError(400, "invalid_finance_filter");
  query.userId = text("userId") ? adminId(input.userId) : null;
  query.ownerUserId = text("ownerUserId") ? adminId(input.ownerUserId) : null;
  for (const key of ["from", "to"] as const) {
    const value = text(key);
    if (
      value &&
      (!/^\d{4}-\d{2}-\d{2}T/.test(value) ||
        !Number.isFinite(Date.parse(value)))
    )
      throw new ApiError(400, "invalid_finance_date");
    query[key] = value ? new Date(value).toISOString() : null;
  }
  if (query.from && query.to && query.from >= query.to)
    throw new ApiError(400, "invalid_finance_date_range");
  for (const key of ["minKobo", "maxKobo"] as const) {
    const value = text(key, 20);
    if (value && (!/^\d+$/.test(value) || BigInt(value) > 9223372036854775807n))
      throw new ApiError(400, "invalid_finance_amount");
    query[key] = value;
  }
  if (
    query.minKobo &&
    query.maxKobo &&
    BigInt(query.minKobo) > BigInt(query.maxKobo)
  )
    throw new ApiError(400, "invalid_finance_amount_range");
  return query;
}
const financePage = (
  rows: Row[],
  q: FinanceQuery,
  basis: string,
  paging?: AdminPagingResult,
) => {
  const page = adminPage(rows, q, basis, paging);
  return {
    ...page,
    scope: {
      ...page.scope,
      ...Object.fromEntries(
        [
          "target",
          "reference",
          "from",
          "to",
          "minKobo",
          "maxKobo",
          "userId",
          "kind",
          "ownerUserId",
        ].map((k) => [k, q[k as keyof FinanceQuery] ?? null]),
      ),
    },
  };
};
export async function listAdminIntents(q: FinanceQuery, actorId: string) {
  const { rows, ...paging } = await readAdminRows<Row>(
    {
      select: `SELECT p.id,p.provider_reference AS reference,p.user_id AS "userId",u.full_name AS customer,p.target,p.amount_kobo::text AS "amountKobo",p.status,p.created_at AS "createdAt",p.paid_at AS "paidAt",p.created_at::text AS _cursor FROM payment_intents p JOIN users u ON u.id=p.user_id WHERE ($1::text IS NULL OR p.status::text=$1) AND ($2::uuid IS NULL OR p.id=$2) AND ($3::timestamptz IS NULL OR (p.created_at,p.id)<($3::timestamptz,$4::uuid)) AND ($6::text IS NULL OR p.target=$6) AND ($7::text IS NULL OR p.provider_reference=$7) AND ($8::uuid IS NULL OR p.user_id=$8) AND ($9::timestamptz IS NULL OR p.created_at>=$9) AND ($10::timestamptz IS NULL OR p.created_at<$10) AND ($11::bigint IS NULL OR p.amount_kobo>=$11) AND ($12::bigint IS NULL OR p.amount_kobo<=$12)`,
      orderBy: `p.created_at DESC,p.id DESC`,
      limitParameter: 5,
    },
    [
      q.status,
      q.id,
      q.cursor?.at ?? null,
      q.cursor?.id ?? null,
      q.limit + 1,
      q.target ?? null,
      q.reference ?? null,
      q.userId ?? null,
      q.from ?? null,
      q.to ?? null,
      q.minKobo ?? null,
      q.maxKobo ?? null,
    ],
    q,
  );
  await recordAdminRead(
    actorId,
    "finance_directory_read",
    "finance_directory",
    null,
    { scope: financePage(rows, q, "created_at", paging).scope },
  );
  return financePage(rows, q, "created_at", paging);
}
export async function listAdminWithdrawals(q: FinanceQuery, actorId: string) {
  const { rows, ...paging } = await readAdminRows<Row>(
    {
      select: `SELECT w.id,u.full_name AS driver,w.amount_kobo::text AS "amountKobo",w.fee_kobo::text AS "feeKobo",p.bank_name AS bank,p.account_last4 AS "accountLastFour",w.status,w.requested_at AS "createdAt",w.provider_reference AS reference,w.attempts,w.request_tx_id AS "requestTransactionId",w.final_tx_id AS "finalTransactionId",w.requested_at::text AS _cursor FROM withdrawals w JOIN users u ON u.id=w.user_id JOIN payout_accounts p ON p.id=w.payout_account_id WHERE ($1::text IS NULL OR w.status::text=$1) AND ($2::uuid IS NULL OR w.id=$2) AND ($3::timestamptz IS NULL OR (w.requested_at,w.id)<($3::timestamptz,$4::uuid)) AND ($6::text IS NULL OR w.provider_reference=$6) AND ($7::uuid IS NULL OR w.user_id=$7) AND ($8::timestamptz IS NULL OR w.requested_at>=$8) AND ($9::timestamptz IS NULL OR w.requested_at<$9) AND ($10::bigint IS NULL OR w.amount_kobo>=$10) AND ($11::bigint IS NULL OR w.amount_kobo<=$11)`,
      orderBy: `w.requested_at DESC,w.id DESC`,
      limitParameter: 5,
    },
    [
      q.status,
      q.id,
      q.cursor?.at ?? null,
      q.cursor?.id ?? null,
      q.limit + 1,
      q.reference ?? null,
      q.userId ?? null,
      q.from ?? null,
      q.to ?? null,
      q.minKobo ?? null,
      q.maxKobo ?? null,
    ],
    q,
  );
  await recordAdminRead(
    actorId,
    "withdrawal_directory_read",
    "withdrawal_directory",
    null,
    { scope: financePage(rows, q, "requested_at", paging).scope },
  );
  return financePage(rows, q, "requested_at", paging);
}
export async function listAdminAccounts(q: FinanceQuery, actorId: string) {
  const { rows, ...paging } = await readAdminRows<Row>(
    {
      select: `SELECT a.id,COALESCE(u.full_name,a.code) AS owner,CASE a.kind WHEN 'user_wallet' THEN 'wallet' WHEN 'driver_earnings' THEN 'earnings' ELSE 'system' END AS kind,a.type,a.normal_side AS "normalSide",a.currency,a.balance_kobo::text AS "balanceKobo",a.is_frozen AS frozen,a.updated_at AS "updatedAt",a.created_at::text AS _cursor FROM ledger_accounts a LEFT JOIN users u ON u.id=a.owner_user_id WHERE ($1::uuid IS NULL OR a.id=$1) AND ($2::timestamptz IS NULL OR (a.created_at,a.id)<($2::timestamptz,$3::uuid)) AND ($5::text IS NULL OR CASE a.kind WHEN 'user_wallet' THEN 'wallet' WHEN 'driver_earnings' THEN 'earnings' ELSE 'system' END=$5) AND ($6::uuid IS NULL OR a.owner_user_id=$6)`,
      orderBy: `a.created_at DESC,a.id DESC`,
      limitParameter: 4,
    },
    [
      q.id,
      q.cursor?.at ?? null,
      q.cursor?.id ?? null,
      q.limit + 1,
      q.kind ?? null,
      q.ownerUserId ?? null,
    ],
    q,
  );
  await recordAdminRead(
    actorId,
    "finance_directory_read",
    "finance_directory",
    null,
    { scope: financePage(rows, q, "created_at", paging).scope },
  );
  return financePage(rows, q, "created_at", paging);
}
export async function getAdminReconciliation() {
  const [accounts, exceptions] = await Promise.all([
    db.query(
      `SELECT code,balance_kobo::text AS "balanceKobo",updated_at AS "updatedAt" FROM ledger_accounts WHERE code IN ('gateway_balance','payout_in_transit','escrow_trips','suspense')`,
    ),
    db.query(
      `SELECT 'Top-up mismatches' AS kind,COUNT(*)::text AS count FROM payment_intents WHERE status='mismatch' UNION ALL SELECT 'Unresolved withdrawals',COUNT(*)::text FROM withdrawals WHERE status IN ('pending','processing') UNION ALL SELECT 'Terminal trips with held funds',COUNT(*)::text FROM trips WHERE payment_status='held' AND status IN ('completed','returned','cancelled','no_drivers_found') UNION ALL SELECT 'Unprocessed webhooks',COUNT(*)::text FROM payment_webhook_events WHERE status IN ('received','failed') UNION ALL SELECT 'Fulfilled trips without settlement evidence',COUNT(*)::text FROM trips t WHERE t.status IN ('completed','returned') AND (t.payment_status<>'settled' OR NOT EXISTS (SELECT 1 FROM ledger_transactions l WHERE l.id=t.settle_tx_id AND l.reference_type='trip' AND l.reference_id=t.id AND l.type=CASE WHEN t.payment_method='wallet' THEN 'trip_settlement_wallet'::ledger_tx_type ELSE 'trip_commission_cash'::ledger_tx_type END))`,
    ),
  ]);
  let observation:{balanceKobo:string;observedAt:string}|null=null;
  try {
    const {ensureRedis}=await import('../../shared/config/redis.js');
    const {env}=await import('../../config/env.js');
    const mode=env.PAYSTACK_SECRET_KEY.startsWith('sk_live_')?'live':'test';
    const value=await (await ensureRedis()).get(`rakky:finance:provider-balance:${mode}`);
    if(value){const parsed=JSON.parse(value) as {balanceKobo:string;observedAt:string};if(/^\d+$/.test(parsed.balanceKobo) && Number.isFinite(Date.parse(parsed.observedAt))) observation=parsed;}
  } catch { /* Missing observation stays explicit; ledger reads still work. */ }
  return {
    accounts: accounts.rows,
    exceptions: exceptions.rows,
    providerBalanceKobo: observation?.balanceKobo ?? null,
    providerObservedAt: observation?.observedAt ?? null,
    asOf: new Date().toISOString(),
    coverage:
      "Derived current queues. Provider balance reflects the last scheduled balance check, retained for 24 hours; no observation means unknown. Use internal care cases to record investigations.",
  };
}
export function auditQuery(input: Record<string, unknown>) {
  if (
    Object.keys(input).some(
      (key) =>
        !["page", "before", "limit", "action", "objectId", "actorId", "from", "to"].includes(
          key,
        ),
    )
  )
    throw new ApiError(400, "unsupported_filter");
  const action =
    input.action === undefined || input.action === "" ? null : input.action;
  if (
    action !== null &&
    (typeof action !== "string" || !/^[a-z][a-z0-9_]{2,79}$/.test(action))
  )
    throw new ApiError(400, "invalid_action_filter");
  const id = (name: string) =>
    input[name] === undefined || input[name] === ""
      ? null
      : adminId(input[name]).toLowerCase();
  const date=(key:string)=>{
    const value=input[key];if(value===undefined || value==="") return null;
    if(typeof value!=="string" || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) throw new ApiError(400,"invalid_audit_date");
    return new Date(value).toISOString();
  };
  const from=date("from"),to=date("to");
  if(from && to && Date.parse(to)<=Date.parse(from)) throw new ApiError(400,"invalid_audit_date_range");
  return {
    from,to,
    ...entryPageQuery({
      page: input.page,
      before: input.before,
      limit: input.limit,
    }),
    action: action as string | null,
    objectId: id("objectId"),
    actorId: id("actorId"),
  };
}
export async function getAdminAudit(
  query: ReturnType<typeof auditQuery>,
  role = "admin",
) {
  const { rows, ...paging } = await readAdminRows(
    {
      select: `SELECT a.id::text,a.action,a.actor_id AS "actorId",u.full_name AS actor,a.target_user_id AS "targetUserId",a.reason,a.ledger_transaction_id AS "transactionId",a.object_type AS "objectType",a.object_id AS "objectId",a.before_version AS "beforeVersion",a.after_version AS "afterVersion",a.request_key AS "requestKey",a.metadata,a.created_at AS "createdAt" FROM admin_audit_log a JOIN users u ON u.id=a.actor_id WHERE ($1::bigint IS NULL OR a.id<$1) AND ($3='super_admin' OR (COALESCE(a.object_type,'')<>'safety' AND a.action NOT LIKE 'safety_%')) AND ($4::text IS NULL OR a.action=$4) AND ($5::uuid IS NULL OR a.object_id=$5 OR a.target_user_id=$5) AND ($6::uuid IS NULL OR a.actor_id=$6) AND ($7::timestamptz IS NULL OR a.created_at>=$7) AND ($8::timestamptz IS NULL OR a.created_at<$8)`,
      orderBy: `a.id DESC`,
      limitParameter: 2,
    },
    [
      query.before,
      query.limit + 1,
      role,
      query.action,
      query.objectId,
      query.actorId,
      query.from,query.to,
    ],
    query,
  );
  return {
    items: rows.slice(0, query.limit).map(({metadata,...row}) => ({...row, changes: visibleAuditChanges(metadata)})),
    pagination: paging.pagination,
    count:
      paging.total === undefined
        ? undefined
        : { value: paging.total, exact: true },
    asOf: new Date().toISOString(),
    coverage:
      "Append-only staff reads/searches, exports, payment actions, driver reviews, configuration changes, and care activity. Other legacy system actions are not yet audited.",
    nextCursor: rows.length > query.limit ? rows[query.limit - 1].id : null,
    limited: false,
  };
}

export async function getAdminAccount(
  id: string,
  query: { page?: number | null; before: string | null; limit: number },
  actorId: string,
) {
  const account = (
    await db.query(
      `SELECT a.id,a.owner_user_id AS "ownerUserId",COALESCE(u.full_name,a.code) AS owner,a.kind,a.type,a.normal_side AS "normalSide",a.currency,a.balance_kobo::text AS "balanceKobo",a.is_frozen AS frozen,a.updated_at AS "updatedAt" FROM ledger_accounts a LEFT JOIN users u ON u.id=a.owner_user_id WHERE a.id=$1`,
      [id],
    )
  ).rows[0];
  if (!account) throw new ApiError(404, "account_not_found");
  const { rows: entries, ...paging } = await readAdminRows(
    {
      select: `SELECT e.id::text,e.transaction_id AS "transactionId",t.type,t.description,e.direction,e.amount_kobo::text AS "amountKobo",e.balance_after_kobo::text AS "balanceAfterKobo",e.created_at AS "createdAt" FROM ledger_entries e JOIN ledger_transactions t ON t.id=e.transaction_id WHERE e.account_id=$1 AND ($2::bigint IS NULL OR e.id<$2)`,
      orderBy: "e.id DESC",
      limitParameter: 3,
    },
    [id, query.before, query.limit + 1],
    query,
  );
  await recordAdminRead(actorId, "ledger_account_read", "ledger_account", id);
  return {
    ...account,
    entries: entries.slice(0, query.limit),
    pagination: paging.pagination,
    nextEntryId:
      entries.length > query.limit ? entries[query.limit - 1].id : null,
    historyLimited: false,
    asOf: new Date().toISOString(),
  };
}
export async function getAdminTransaction(id: string, actorId: string) {
  const transaction = (
    await db.query(
      `SELECT id,type,reference_type AS "referenceType",reference_id AS "referenceId",description,created_by AS "actorId",created_at AS "createdAt" FROM ledger_transactions WHERE id=$1`,
      [id],
    )
  ).rows[0];
  if (!transaction) throw new ApiError(404, "transaction_not_found");
  const entries = (
    await db.query(
      `SELECT e.id::text,a.code,a.type,a.normal_side AS "normalSide",e.direction,e.amount_kobo::text AS "amountKobo",e.balance_after_kobo::text AS "balanceAfterKobo" FROM ledger_entries e JOIN ledger_accounts a ON a.id=e.account_id WHERE e.transaction_id=$1 ORDER BY e.id`,
      [id],
    )
  ).rows;
  await recordAdminRead(
    actorId,
    "ledger_transaction_read",
    "ledger_transaction",
    id,
  );
  return { ...transaction, entries, asOf: new Date().toISOString() };
}
export async function refundEligibility(tripId: string) {
  const trip = (
    await db.query<{
      id: string;
      riderId: string;
      riderName: string;
      status: string;
      fareKobo: string;
      paymentStatus: string;
      settlementEvidence: boolean;
    }>(
      `SELECT t.id,t.rider_id AS "riderId",u.full_name AS "riderName",t.status,t.fare_kobo::text AS "fareKobo",t.payment_status AS "paymentStatus",EXISTS(SELECT 1 FROM ledger_transactions l WHERE l.id=t.settle_tx_id AND l.reference_type='trip' AND l.reference_id=t.id AND l.type=CASE WHEN t.payment_method='wallet' THEN 'trip_settlement_wallet'::ledger_tx_type ELSE 'trip_commission_cash'::ledger_tx_type END) AS "settlementEvidence" FROM trips t JOIN users u ON u.id=t.rider_id WHERE t.id=$1`,
      [tripId],
    )
  ).rows[0];
  if (!trip) throw new ApiError(404, "trip_not_found");
  const prior = (
    await db.query<{ amount: string }>(
      `SELECT COALESCE(SUM(e.amount_kobo),0)::text AS amount FROM ledger_transactions t JOIN ledger_entries e ON e.transaction_id=t.id WHERE t.type='refund' AND t.reference_type='trip' AND t.reference_id=$1 AND e.direction='credit'`,
      [tripId],
    )
  ).rows[0].amount;
  return {
    ...trip,
    refundedKobo: prior,
    remainingKobo: (BigInt(trip.fareKobo) - BigInt(prior)).toString(),
    eligible:
      trip.status === "completed" && trip.paymentStatus === "settled" && trip.settlementEvidence && BigInt(prior) < BigInt(trip.fareKobo),
    ineligibleReason: trip.status !== "completed" ? "trip_not_completed" : trip.paymentStatus !== "settled" || !trip.settlementEvidence ? "trip_settlement_evidence_required" : BigInt(prior) >= BigInt(trip.fareKobo) ? "fare_already_refunded" : null,
    destination: "Rider wallet",
    asOf: new Date().toISOString(),
  };
}
export async function adminOperationStatus(actorId: string, key: string) {
  const record = (
    await db.query(
      `SELECT id::text,action,object_id AS "objectId",ledger_transaction_id AS "transactionId",created_at AS "createdAt" FROM admin_audit_log WHERE actor_id=$1 AND request_key=$2 ORDER BY id LIMIT 1`,
      [actorId, key],
    )
  ).rows[0];
  return record
    ? { state: "confirmed", ...record }
    : {
        state: "unknown",
        message:
          "No completed audit record was found. An in-flight request may still complete; retry only the identical operation with its original key.",
      };
}

export async function adminMoneyPeriod(from: string, to: string) {
  const { rows } = await db.query<{ code: string; amountKobo: string }>(
    `SELECT a.code,COALESCE(SUM(CASE WHEN e.direction=a.normal_side THEN e.amount_kobo ELSE -e.amount_kobo END),0)::text AS "amountKobo" FROM ledger_accounts a LEFT JOIN ledger_entries e ON e.account_id=a.id AND e.created_at >= $1 AND e.created_at < $2 WHERE a.code IN ('revenue_commission','revenue_fees','expense_gateway_fees','expense_refunds','expense_adjustments') GROUP BY a.code ORDER BY a.code`,
    [from, to],
  );
  return rows;
}

export async function getAdminIntent(id: string, actorId: string) {
  const row = (
    await db.query(
      `SELECT p.id,p.user_id AS "userId",u.full_name AS customer,p.target,p.amount_kobo::text AS "amountKobo",p.status,p.provider,p.provider_reference AS reference,p.channel,p.fee_kobo::text AS "feeKobo",p.failure_reason AS "failureReason",p.created_at AS "createdAt",p.paid_at AS "paidAt",p.updated_at AS "updatedAt",p.ledger_transaction_id AS "transactionId" FROM payment_intents p JOIN users u ON u.id=p.user_id WHERE p.id=$1`,
      [id],
    )
  ).rows[0];
  if (!row) throw new ApiError(404, "payment_intent_not_found");
  const events = (
    await db.query(
      `SELECT id::text,event_type AS type,status,received_at AS "receivedAt",processed_at AS "processedAt" FROM payment_webhook_events WHERE payload->'data'->>'reference'=$1 ORDER BY id DESC LIMIT 50`,
      [row.reference],
    )
  ).rows;
  await recordAdminRead(actorId, "payment_intent_read", "payment_intent", id);
  return {
    ...row,
    webhooks: events,
    webhookHistoryLimited: events.length === 50,
    providerObservation: null,
    providerObservedAt: null,
    asOf: new Date().toISOString(),
  };
}
export async function getAdminWithdrawal(id: string, actorId: string) {
  const row = (
    await db.query(
      `SELECT w.id,w.user_id AS "userId",u.full_name AS driver,w.amount_kobo::text AS "amountKobo",w.fee_kobo::text AS "feeKobo",p.bank_name AS bank,p.account_last4 AS "accountLastFour",w.status,w.requested_at AS "createdAt",w.updated_at AS "updatedAt",w.completed_at AS "completedAt",w.provider_reference AS reference,w.attempts,w.failure_reason AS "failureReason",w.request_tx_id AS "requestTransactionId",w.final_tx_id AS "finalTransactionId" FROM withdrawals w JOIN users u ON u.id=w.user_id JOIN payout_accounts p ON p.id=w.payout_account_id WHERE w.id=$1`,
      [id],
    )
  ).rows[0];
  if (!row) throw new ApiError(404, "withdrawal_not_found");
  await recordAdminRead(actorId, "withdrawal_read", "withdrawal", id);
  return {
    ...row,
    providerObservation: null,
    providerObservedAt: null,
    asOf: new Date().toISOString(),
  };
}
export async function reconciliationExceptions(
  kind: string,
  q: AdminQuery,
  actorId: string,
) {
  if (q.service || q.mode || q.status)
    throw new ApiError(400, "unsupported_filter");
  if (kind === "topups")
    return listAdminIntents({ ...q, status: "mismatch" }, actorId);
  if (kind === "withdrawals") {
    await recordAdminRead(
      actorId,
      "reconciliation_queue_read",
      "reconciliation_queue",
      null,
      { kind },
    );
    const { rows, ...paging } = await readAdminRows<Row>(
      {
        select: `SELECT id,status,provider_reference AS reference,amount_kobo::text AS "amountKobo",requested_at AS "createdAt",requested_at::text AS _cursor FROM withdrawals WHERE status IN ('pending','processing') AND ($1::timestamptz IS NULL OR (requested_at,id)<($1::timestamptz,$2::uuid)) AND ($3::uuid IS NULL OR id=$3)`,
        orderBy: `requested_at DESC,id DESC`,
        limitParameter: 4,
      },
      [q.cursor?.at ?? null, q.cursor?.id ?? null, q.id, q.limit + 1],
      q,
    );
    return adminPage(rows, q, "requested_at", paging);
  }
  if (kind === "escrow" || kind === "unsettled") {
    await recordAdminRead(
      actorId,
      "reconciliation_queue_read",
      "reconciliation_queue",
      null,
      { kind },
    );
    const { rows, ...paging } = await readAdminRows<Row>(
      {
        select: `SELECT id,status,service_type AS service,fare_kobo::text AS "amountKobo",payment_method AS "paymentMethod",payment_status AS "paymentStatus",commission_kobo::text AS "commissionKobo",CASE
          WHEN payment_method='cash' AND commission_kobo=0 AND payment_status='settled' THEN 'zero_commission_cash_no_posting'
          WHEN payment_method='cash' AND commission_kobo>0 AND EXISTS(SELECT 1 FROM wallet_transactions w WHERE w.trip_id=trips.id AND w.user_id=trips.driver_id AND w.entry_type='driver_cash_commission_debit' AND w.amount_kobo=-trips.commission_kobo) AND EXISTS(SELECT 1 FROM wallet_transactions w WHERE w.trip_id=trips.id AND w.entry_type='platform_commission_credit' AND w.amount_kobo=trips.commission_kobo) THEN 'legacy_cash_commission_entries'
          ELSE 'settlement_evidence_missing' END AS "evidenceClass",requested_at AS "createdAt",requested_at::text AS _cursor FROM trips WHERE ${kind === 'escrow' ? "status IN ('completed','returned','cancelled','no_drivers_found') AND payment_status='held'" : "status IN ('completed','returned') AND (payment_status<>'settled' OR NOT EXISTS (SELECT 1 FROM ledger_transactions l WHERE l.id=trips.settle_tx_id AND l.reference_type='trip' AND l.reference_id=trips.id AND l.type=CASE WHEN trips.payment_method='wallet' THEN 'trip_settlement_wallet'::ledger_tx_type ELSE 'trip_commission_cash'::ledger_tx_type END))"} AND ($1::timestamptz IS NULL OR (requested_at,id)<($1::timestamptz,$2::uuid)) AND ($3::uuid IS NULL OR id=$3)`,
        orderBy: `requested_at DESC,id DESC`,
        limitParameter: 4,
      },
      [q.cursor?.at ?? null, q.cursor?.id ?? null, q.id, q.limit + 1],
      q,
    );
    return adminPage(rows, q, "requested_at", paging);
  }
  throw new ApiError(400, "unsupported_exception_queue");
}

export async function searchAdminFinance(
  input: import("../../shared/utils/adminSearch").SearchRead,
): Promise<import("../../shared/utils/adminSearch").StaffSearchHit[]> {
  const rows = await staffSearchRows<{
    id: string;
    type: "payment" | "withdrawal" | "account";
    title: string;
    status: string;
  }>(
    `SELECT * FROM (
    SELECT id,'payment'::text AS type,provider_reference AS title,status::text AS status FROM payment_intents WHERE id::text=$1 OR lower(provider_reference) LIKE $2 ESCAPE '!'
    UNION ALL SELECT id,'withdrawal',provider_reference,status::text FROM withdrawals WHERE id::text=$1 OR lower(provider_reference) LIKE $2 ESCAPE '!'
    UNION ALL SELECT a.id,'account',COALESCE(u.full_name,a.code),a.kind::text FROM ledger_accounts a LEFT JOIN users u ON u.id=a.owner_user_id WHERE a.id::text=$1
    ) result WHERE ($3::text IS NULL OR (result.type,result.id)>($3::text,$4::uuid)) ORDER BY result.type,result.id LIMIT $5`,
    [
      input.query.toLowerCase(),
      input.prefix,
      input.after?.type ?? null,
      input.after?.id ?? null,
      input.limit + 1,
    ],
  );
  const paths = {
    payment: "payments",
    withdrawal: "withdrawals",
    account: "ledger",
  };
  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    title: row.title ?? row.id,
    subtitle: row.status,
    href: `/admin/${paths[row.type]}/${row.id}`,
  }));
}

/** Safe webhook envelope only: payloads, contact details and raw provider errors are excluded. */
export async function listAdminWebhookExceptions(q: ReturnType<typeof entryPageQuery>, actorId: string) {
  await recordAdminRead(actorId, "reconciliation_queue_read", "reconciliation_queue", null, {kind: "webhooks"});
  const {rows, ...paging} = await readAdminRows<{id: string}>(
    { select: `SELECT id::text,provider,event_type AS "eventType",status,received_at AS "createdAt",processed_at AS "processedAt",(error IS NOT NULL) AS "hasError" FROM payment_webhook_events WHERE status IN ('received','failed') AND ($1::bigint IS NULL OR id<$1)`, orderBy: 'id DESC', limitParameter: 2 },
    [q.before, q.limit + 1], q);
  return {items: rows.slice(0,q.limit), pagination: paging.pagination, nextCursor: rows.length>q.limit ? rows[q.limit-1].id : null, asOf: new Date().toISOString()};
}
```

</details>

## src/modules/payments/admin.routes.ts

[Open source](../src/modules/payments/admin.routes.ts)

SHA-256: `d82939e4e145c88b760585a86651624b51be0b32833cb50279e65fe844f24734`

<details>
<summary>Full TypeScript implementation</summary>

```ts
import { env } from '../../config/env';
import { ApiError } from '../../shared/errors';
import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireAuth, requireStaffRole } from '../auth/auth.middleware';
import { adjustBalance, freezeAccount, getPaymentSettings, inspectUser, refundTrip, sweepGateway, updatePaymentSettings } from './admin.service';

const run=(fn:(req:Request)=>Promise<unknown>)=>(req:Request,res:Response,next:NextFunction)=>{void fn(req).then((value)=>res.json(value)).catch(next);};
export const paymentAdminRouter=Router();
paymentAdminRouter.use(requireAuth,requireStaffRole('admin','super_admin'));
paymentAdminRouter.use((_req,res,next)=>{res.set('Cache-Control','no-store');next();});
const moneyEnabled=(_req:Request,_res:Response,next:NextFunction)=>env.ENABLE_ADMIN_MONEY_ACTIONS ? next() : next(new ApiError(403,'admin_money_actions_disabled'));
paymentAdminRouter.post('/refunds',moneyEnabled,run((req)=>refundTrip(req.userId!,req.body)));
paymentAdminRouter.post('/adjustments',moneyEnabled,run((req)=>adjustBalance(req.userId!,req.authUser!.role,req.body)));
paymentAdminRouter.post('/accounts/:userId/freeze',moneyEnabled,run((req)=>freezeAccount(req.userId!,String(req.params.userId),req.body.account,req.body.frozen,req.body.reason,req.body.requestKey)));
paymentAdminRouter.get('/users/:userId',run((req)=>inspectUser(req.userId!,String(req.params.userId))));
paymentAdminRouter.post('/sweeps',moneyEnabled,requireStaffRole('super_admin'),run((req)=>sweepGateway(req.userId!,Number(req.body.amountKobo),req.body.reason,req.body.requestKey)));
paymentAdminRouter.get('/settings',run(()=>getPaymentSettings()));
paymentAdminRouter.patch('/settings',requireStaffRole('super_admin'),run((req)=>updatePaymentSettings(req.userId!,req.body)));
```

</details>

## src/modules/payments/admin.service.ts

[Open source](../src/modules/payments/admin.service.ts)

SHA-256: `ea067740ab176fbdbe7b574dd8c9e1a05e29b23c817e8064719c1b60f553804f`

<details>
<summary>Full TypeScript implementation</summary>

```ts
import { createHash } from 'node:crypto';
import { db, inTransaction } from '../../shared/config/db';
import { ApiError } from '../../shared/errors';
import { getOrCreateEarningsAccount, getOrCreateWalletAccount, getSystemAccountId, postTransaction } from './ledger.service';
import { replayAdminOperation, recordAdminRead } from '../../shared/utils/adminAudit';
import { adminId } from '../../shared/utils/adminQuery';
import { emitWalletUpdated } from '../../websocket/notifications';

const uuid=(value:unknown)=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
function checkAudit(reason:unknown,requestKey:unknown,amountKobo?:number) {
  if (typeof reason!=='string'||reason.trim().length<5||!uuid(requestKey)) throw new ApiError(400,'reason_and_request_key_required');
  if (amountKobo!==undefined&&(!Number.isSafeInteger(amountKobo)||amountKobo<=0)) throw new ApiError(400,'invalid_amount');
}
export async function refundTrip(actorId:string,input:{tripId:string;amountKobo:number;reason:string;requestKey:string}) {
  checkAudit(input.reason,input.requestKey,input.amountKobo);
  const result=await inTransaction(async(client)=>{
    adminId(input.tripId);
    const operation=await replayAdminOperation(client,actorId,'refund',input.requestKey,{tripId:input.tripId,amountKobo:input.amountKobo,reason:input.reason});
    if(operation.previous)return {transactionId:operation.previous.transactionId};
    const trip=(await client.query<{id:string;rider_id:string;fare_kobo:string;status:string;payment_status:string;settle_tx_id:string|null;payment_method:string}>('SELECT id,rider_id,fare_kobo,status,payment_status,settle_tx_id,payment_method FROM trips WHERE id=$1 FOR UPDATE',[input.tripId])).rows[0];
    if (!trip||trip.status!=='completed') throw new ApiError(409,'trip_not_completed');
    const evidence = await client.query(`SELECT id FROM ledger_transactions WHERE id=$1 AND reference_type='trip' AND reference_id=$2 AND type=$3`,[trip.settle_tx_id,trip.id,trip.payment_method==='wallet'?'trip_settlement_wallet':'trip_commission_cash']);
    if (trip.payment_status!=='settled' || !evidence.rowCount) throw new ApiError(409,'trip_settlement_evidence_required');
    if (input.amountKobo>Number(trip.fare_kobo)) throw new ApiError(400,'refund_exceeds_fare');
    const idempotencyKey = `refund:${trip.id}:${actorId}:${input.requestKey}`;
    const previous = await client.query('SELECT id FROM ledger_transactions WHERE idempotency_key=$1', [idempotencyKey]);
    // The trip lock serializes refunds. Exact retries still go through the ledger's
    // hash check, even when earlier refunds have exhausted the refundable amount.
    if (!previous.rowCount) {
      const refunded = (await client.query<{ total: string }>(
        `SELECT COALESCE(SUM(e.amount_kobo),0)::text AS total
         FROM ledger_transactions t JOIN ledger_entries e ON e.transaction_id=t.id
         WHERE t.type='refund' AND t.reference_type='trip' AND t.reference_id=$1 AND e.direction='credit'`,
        [trip.id],
      )).rows[0];
      if (BigInt(refunded.total) + BigInt(input.amountKobo) > BigInt(trip.fare_kobo)) {
        throw new ApiError(400, 'refund_exceeds_remaining_fare');
      }
    }
    const account=await getOrCreateWalletAccount(client,trip.rider_id);
    const expense=await getSystemAccountId(client,'expense_refunds');
    const {transactionId,replayed}=await postTransaction(client,{type:'refund',idempotencyKey,referenceType:'trip',referenceId:trip.id,createdBy:actorId,description:input.reason,
      entries:[{accountId:expense,direction:'debit',amountKobo:input.amountKobo},{accountId:account,direction:'credit',amountKobo:input.amountKobo}]});
    if (!replayed) await client.query('INSERT INTO admin_audit_log(actor_id,action,target_user_id,request_key,reason,ledger_transaction_id,metadata) VALUES($1,$2,$3,$4,$5,$6,$7)',[actorId,'refund',trip.rider_id,input.requestKey,input.reason,transactionId,{operationHash:operation.hash}]);
    return {transactionId};
  });
  const user=(await db.query<{rider_id:string}>('SELECT rider_id FROM trips WHERE id=$1',[input.tripId])).rows[0];
  if (user) emitWalletUpdated(user.rider_id);
  return result;
}
export async function adjustBalance(actorId:string,actorRole:string,input:{userId:string;account:'wallet'|'earnings';direction:'credit'|'debit';amountKobo:number;reason:string;requestKey:string}) {
  checkAudit(input.reason,input.requestKey,input.amountKobo);
  if (!['wallet','earnings'].includes(input.account)||!['credit','debit'].includes(input.direction)) throw new ApiError(400,'invalid_adjustment');
  const result=await inTransaction(async(client)=>{
    adminId(input.userId);
    const operation=await replayAdminOperation(client,actorId,'adjustment',input.requestKey,{userId:input.userId,account:input.account,direction:input.direction,amountKobo:input.amountKobo,reason:input.reason});
    if(operation.previous)return {transactionId:operation.previous.transactionId};
    const threshold=Number((await client.query<{admin_adjustment_approval_kobo:string}>('SELECT admin_adjustment_approval_kobo FROM payment_settings WHERE id=true')).rows[0]?.admin_adjustment_approval_kobo??0);
    if (input.amountKobo>threshold&&operation.role!=='super_admin') throw new ApiError(403,'super_admin_required');
    const account=input.account==='wallet'?await getOrCreateWalletAccount(client,input.userId):await getOrCreateEarningsAccount(client,input.userId);
    const expense=await getSystemAccountId(client,'expense_adjustments');
    const {transactionId}=await postTransaction(client,{type:'adjustment',idempotencyKey:`adjustment:${actorId}:${input.requestKey}`,referenceType:'admin',referenceId:input.userId,createdBy:actorId,description:input.reason,
      entries:input.direction==='credit'?[{accountId:expense,direction:'debit',amountKobo:input.amountKobo},{accountId:account,direction:'credit',amountKobo:input.amountKobo}]
        :[{accountId:account,direction:'debit',amountKobo:input.amountKobo},{accountId:expense,direction:'credit',amountKobo:input.amountKobo}]});
    await client.query('INSERT INTO admin_audit_log(actor_id,action,target_user_id,request_key,reason,ledger_transaction_id,metadata) VALUES($1,$2,$3,$4,$5,$6,$7)',[actorId,'adjustment',input.userId,input.requestKey,input.reason,transactionId,{operationHash:operation.hash}]);
    return {transactionId};
  });
  emitWalletUpdated(input.userId);
  return result;
}
export async function freezeAccount(actorId:string,userId:string,kind:'wallet'|'earnings',frozen:boolean,reason:string,requestKey:string) {
  checkAudit(reason,requestKey);
  if (kind!=='wallet'&&kind!=='earnings'||typeof frozen!=='boolean') throw new ApiError(400,'invalid_freeze_request');
  return inTransaction(async(client)=>{
    adminId(userId);
    const action=frozen?'freeze':'unfreeze';
    const operation=await replayAdminOperation(client,actorId,action,requestKey,{userId,kind,frozen,reason});
    if(operation.previous)return {success:true,auditId:operation.previous.id,replayed:true};
    const account=kind==='wallet'?await getOrCreateWalletAccount(client,userId):await getOrCreateEarningsAccount(client,userId);
    await client.query('UPDATE ledger_accounts SET is_frozen=$2,updated_at=now() WHERE id=$1',[account,frozen]);
    const audit=(await client.query<{id:string}>('INSERT INTO admin_audit_log(actor_id,action,target_user_id,request_key,reason,metadata) VALUES($1,$2,$3,$4,$5,$6) RETURNING id::text',[actorId,frozen?'freeze':'unfreeze',userId,requestKey,reason,{account:kind,operationHash:operation.hash}])).rows[0];
    return {success:true,auditId:audit.id};
  });
}
export async function sweepGateway(actorId:string,amountKobo:number,reason:string,requestKey:string) {
  checkAudit(reason,requestKey,amountKobo);
  return inTransaction(async(client)=>{
    const operation=await replayAdminOperation(client,actorId,'gateway_sweep',requestKey,{amountKobo,reason},['super_admin']);
    if(operation.previous)return {transactionId:operation.previous.transactionId};
    const gateway=await getSystemAccountId(client,'gateway_balance');
    const bank=await getSystemAccountId(client,'bank_account');
    const {transactionId}=await postTransaction(client,{type:'gateway_sweep',idempotencyKey:`sweep:${actorId}:${requestKey}`,referenceType:'admin',createdBy:actorId,description:reason,
      entries:[{accountId:bank,direction:'debit',amountKobo},{accountId:gateway,direction:'credit',amountKobo}]});
    await client.query('INSERT INTO admin_audit_log(actor_id,action,request_key,reason,ledger_transaction_id,metadata) VALUES($1,$2,$3,$4,$5,$6)',[actorId,'gateway_sweep',requestKey,reason,transactionId,{operationHash:operation.hash}]);
    return {transactionId};
  });
}
export async function inspectUser(actorId:string,userId:string) {
  adminId(userId);
  const {getBalances}=await import('./ledger.service.js');
  const [balances,entries,intents,withdrawals]=await Promise.all([
    getBalances(userId),
    db.query('SELECT e.id,e.direction,e.amount_kobo,e.balance_after_kobo,t.type,t.created_at FROM ledger_entries e JOIN ledger_accounts a ON a.id=e.account_id JOIN ledger_transactions t ON t.id=e.transaction_id WHERE a.owner_user_id=$1 ORDER BY e.id DESC LIMIT 100',[userId]),
    db.query('SELECT id,target,amount_kobo,status,created_at FROM payment_intents WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50',[userId]),
    db.query('SELECT id,amount_kobo,status,requested_at FROM withdrawals WHERE user_id=$1 ORDER BY requested_at DESC LIMIT 50',[userId]),
  ]);
  await recordAdminRead(actorId, 'financial_user_inspection', 'user', userId);
  return {balances,entries:entries.rows,intents:intents.rows,withdrawals:withdrawals.rows};
}
const settingsVersion=(row:object)=>createHash('sha256').update(JSON.stringify(row)).digest('hex');
export async function getPaymentSettings() {
  const row=(await db.query('SELECT * FROM payment_settings WHERE id=true')).rows[0];
  return row?{...row,version:settingsVersion(row)}:null;
}
export async function updatePaymentSettings(actorId:string,input:Record<string,unknown>) {
  checkAudit(input.reason,input.requestKey);
  const fields=['minTopupKobo','maxTopupKobo','minWithdrawalKobo','maxDailyWithdrawalKobo','withdrawalFeeKobo','cashDebtLimitKobo','newPayoutAccountCooldownHours','paystackBalanceAlertKobo','adminAdjustmentApprovalKobo'] as const;
  for (const field of fields) if (input[field]!==undefined&&(!Number.isSafeInteger(input[field])||Number(input[field])<0)) throw new ApiError(400,'invalid_payment_setting');
  if (input.payoutNameMatch!==undefined&&!['strict','lenient','off'].includes(String(input.payoutNameMatch))) throw new ApiError(400,'invalid_payment_setting');
  for(const key of Object.keys(input))if(![...fields,'payoutNameMatch','transferFeeTiers','reason','requestKey','expectedVersion'].includes(key as typeof fields[number]))throw new ApiError(400,'unsupported_payment_setting');
  if(typeof input.expectedVersion!=='string'||!/^[0-9a-f]{64}$/.test(input.expectedVersion))throw new ApiError(400,'expected_settings_version_required');
  if(input.newPayoutAccountCooldownHours!==undefined&&Number(input.newPayoutAccountCooldownHours)>2147483647)throw new ApiError(400,'invalid_payment_setting');
  const tiers=input.transferFeeTiers;
  if(tiers!==undefined){
    if(!Array.isArray(tiers)||!tiers.length||tiers.length>50)throw new ApiError(400,'invalid_payment_setting');
    let previous=0;
    for(const [index,tier] of tiers.entries()){
      if(!tier||typeof tier!=='object'||Array.isArray(tier))throw new ApiError(400,'invalid_payment_setting');
      const item=tier as {maxKobo:unknown;feeKobo:unknown};
      if(!Number.isSafeInteger(item.feeKobo)||Number(item.feeKobo)<0||Object.keys(item).some(k=>!['maxKobo','feeKobo'].includes(k)))throw new ApiError(400,'invalid_payment_setting');
      if(index===tiers.length-1){if(item.maxKobo!==null)throw new ApiError(400,'unbounded_final_fee_tier_required');}
      else {if(!Number.isSafeInteger(item.maxKobo)||Number(item.maxKobo)<=previous)throw new ApiError(400,'fee_tiers_must_increase');previous=Number(item.maxKobo);}
    }
  }
  return inTransaction(async(client)=>{
    const supplied=Object.fromEntries([...fields,'payoutNameMatch','transferFeeTiers'].filter(field=>input[field]!==undefined).map(field=>[field,input[field]]));
    const operation=await replayAdminOperation(client,actorId,'settings_update',String(input.requestKey),{...supplied,reason:input.reason,expectedVersion:input.expectedVersion},['super_admin']);
    if(operation.previous){const row=(await client.query('SELECT * FROM payment_settings WHERE id=true')).rows[0];return {...row,version:settingsVersion(row),auditId:operation.previous.id};}
    await client.query('SELECT id FROM payment_settings WHERE id=true FOR UPDATE');
    const before=(await client.query('SELECT * FROM payment_settings WHERE id=true')).rows[0];
    if(settingsVersion(before)!==input.expectedVersion)throw new ApiError(409,'payment_settings_changed');
    const updated=(await client.query(`UPDATE payment_settings SET
      min_topup_kobo=COALESCE($1,min_topup_kobo),max_topup_kobo=COALESCE($2,max_topup_kobo),
      min_withdrawal_kobo=COALESCE($3,min_withdrawal_kobo),max_daily_withdrawal_kobo=COALESCE($4,max_daily_withdrawal_kobo),
      withdrawal_fee_kobo=COALESCE($5,withdrawal_fee_kobo),cash_debt_limit_kobo=COALESCE($6,cash_debt_limit_kobo),
      new_payout_account_cooldown_hours=COALESCE($7,new_payout_account_cooldown_hours),
      paystack_balance_alert_kobo=COALESCE($8,paystack_balance_alert_kobo),
      admin_adjustment_approval_kobo=COALESCE($9,admin_adjustment_approval_kobo),
      payout_name_match=COALESCE($10,payout_name_match),transfer_fee_tiers=COALESCE($11::jsonb,transfer_fee_tiers)
      WHERE id=true RETURNING *`,[...fields.map((field)=>input[field]??null),input.payoutNameMatch??null,tiers===undefined?null:JSON.stringify(tiers)])).rows[0];
    if (Number(updated.min_topup_kobo)>Number(updated.max_topup_kobo)||Number(updated.min_withdrawal_kobo)>Number(updated.max_daily_withdrawal_kobo)) throw new ApiError(400,'invalid_payment_limits');
    const audit=(await client.query<{id:string}>('INSERT INTO admin_audit_log(actor_id,action,request_key,reason,metadata) VALUES($1,$2,$3,$4,$5) RETURNING id::text',[actorId,'settings_update',input.requestKey,input.reason,{operationHash:operation.hash,before,after:updated}])).rows[0];
    return {...updated,version:settingsVersion(updated),auditId:audit.id};
  });
}
```

</details>

## src/shared/utils/queueHealth.ts

[Open source](../src/shared/utils/queueHealth.ts)

SHA-256: `c828d988f18002b928df0512500628e20774cdfd494e1ce8d884c1aea65f2a1f`

<details>
<summary>Full TypeScript implementation</summary>

```ts
import type Redis from 'ioredis';
import { ensureRedis } from '../config/redis';
import { randomUUID } from 'node:crypto';
import type { Queue, Worker } from 'bullmq';

/** Shared Redis/BullMQ observations. Job payloads and raw failure messages stay private. */
export async function queueHealth(name: string, queue: Queue | null, connection?: Redis) {
  const observedAt = new Date().toISOString();
  if (!queue) {
    return { name, state: 'unconfigured', observedAt, latencyMs: null, details: 'Redis queue is not configured' };
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const started = Date.now();
    const [workers, counts, completed, failed, observation, paused] = await Promise.race([
      Promise.all([
        queue.getWorkers(),
        queue.getJobCounts('waiting', 'active', 'delayed', 'failed'),
        queue.getJobs(['completed'], 0, 0, false),
        queue.getJobs(['failed'], 0, 0, false),
        (connection ? Promise.resolve(connection) : ensureRedis()).then(async client => {
          const ids = await client.zrangebyscore(queue.toKey('health:workers'), Date.now()-90000, '+inf', 'LIMIT', 0, 100);
          const [values,outcomes] = await Promise.all([ids.length ? client.mget(...ids.map(id=>queue.toKey(`health:worker:${id}`))) : Promise.resolve([]),client.hgetall(queue.toKey('health:outcomes'))]);
          const alive=values.filter(value=>{if(!value) return false;try {const beat=JSON.parse(value) as {running:boolean;paused:boolean};return beat.running && !beat.paused;} catch {return false;}}).length;
          return {alive,outcomes};
        }),
        queue.isPaused(),
      ]),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('queue_observation_timeout')), 3000);
      }),
    ]);
    return {
      name,
      state: observation.alive ? (counts.failed || paused ? 'degraded' : 'reachable') : 'unknown',
      observedAt,
      latencyMs: Date.now() - started,
      details: `${observation.alive} fresh running worker heartbeats · ${workers.length} connections${paused ? " · queue paused" : ""} · ${counts.waiting ?? 0} waiting · ${counts.active ?? 0} active · ${counts.delayed ?? 0} delayed · ${counts.failed ?? 0} retained failures`,
      lastSuccessAt: observation.outcomes.lastSuccessAt ?? (completed[0]?.finishedOn ? new Date(completed[0].finishedOn).toISOString() : null),
      lastFailureAt: observation.outcomes.lastFailureAt ?? (failed[0]?.finishedOn ? new Date(failed[0].finishedOn).toISOString() : null),
    };
  } catch {
    return { name, state: 'unknown', observedAt, latencyMs: null, details: 'Queue observation unavailable or timed out' };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Heartbeats survive cross-instance reads and expire when a process stops or loses Redis. */
export function observeWorker(queue: Queue, worker: Worker, connection: Redis) {
  const id = randomUUID();
  const key = queue.toKey(`health:worker:${id}`);
  let writing = false;
  const beat = async () => {
    if (writing) return;
    writing = true;
    try {
      const client = connection;
      const now = Date.now();
      await client.multi()
        .set(key, JSON.stringify({ running: worker.isRunning(), paused: worker.isPaused(), observedAt: new Date(now).toISOString() }), 'EX', 90)
        .zadd(queue.toKey('health:workers'), now, id)
        .zremrangebyscore(queue.toKey('health:workers'), '-inf', now - 90000)
        .expire(queue.toKey('health:workers'), 300).exec();
    } catch { /* Health reports stale or unknown after the heartbeat expires. */ }
    finally { writing = false; }
  };
  const outcome = (field: 'lastSuccessAt' | 'lastFailureAt') => {
    void Promise.resolve(connection).then(client => client.multi().hset(queue.toKey('health:outcomes'), field, new Date().toISOString()).expire(queue.toKey('health:outcomes'), 86400).exec()).catch(() => undefined);
  };
  const timer = setInterval(() => void beat(), 15000);
  timer.unref();
  worker.on('ready', () => void beat());
  worker.on('completed', () => outcome('lastSuccessAt'));
  worker.on('failed', () => outcome('lastFailureAt'));
  worker.once('closed', () => {
    clearInterval(timer);
    void Promise.resolve(connection).then(client => client.multi().del(key).zrem(queue.toKey('health:workers'), id).exec()).catch(() => undefined);
  });
  void beat();
}
```

</details>

## src/modules/trips/tripQueue.ts

[Open source](../src/modules/trips/tripQueue.ts)

SHA-256: `dfaa795a495e1dfdfabce886c2b95857988f9e0d3176094d2e8dd7d0e3a0d6cb`

<details>
<summary>Full TypeScript implementation</summary>

```ts
import { observeWorker } from '../../shared/utils/queueHealth';
import IORedis from 'ioredis';
import { Queue, Worker } from 'bullmq';
import { env } from '../../config/env';
import { dispatchNext, expireOffer, expireSearch, logStaleTrips, pendingOfferRecovery, pendingSearchRecovery } from './dispatch.service';
import { activateDueScheduledTrips, overdueScheduledSearches, scheduledSearchesWithoutOffers, scheduledSearchExpiryDelay } from './trips.service';

const connection = env.REDIS_URL ? new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null }) : null;
const options = connection ? { connection, prefix: env.TRIP_QUEUE_PREFIX } : null;
const dispatchQueue = options ? new Queue('trip-dispatch', options) : null;
const offerTimeoutQueue = options ? new Queue('trip-offer-timeout', options) : null;
const searchExpiryQueue = options ? new Queue('trip-search-expiry', options) : null;
const maintenanceQueue = options ? new Queue('trip-maintenance', options) : null;
let started = false;
let workers: Worker[] = [];

export async function enqueueDispatch(tripId: string, radiusIndex = 0, delay = 0) {
  if (!dispatchQueue) throw new Error('Redis is required for trip dispatch');
  await dispatchQueue.add('dispatch', { tripId, radiusIndex }, { delay, jobId: `dispatch-${tripId}-${Date.now()}-${radiusIndex}`, removeOnComplete: 100, removeOnFail: 100 });
}

async function enqueueScheduledInitialDispatch(tripId: string) {
  if (!dispatchQueue) throw new Error('Redis is required for trip dispatch');
  await dispatchQueue.add('dispatch', { tripId, radiusIndex: 0 }, {
    jobId: `scheduled-initial-${tripId}`,
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: { age: 600, count: 5000 },
    removeOnFail: 100,
  });
}

async function enqueueScheduledRetry(tripId: string) {
  if (!dispatchQueue) throw new Error('Redis is required for trip dispatch');
  const interval = Math.floor(Date.now() / 30_000);
  await dispatchQueue.add('dispatch', { tripId, radiusIndex: 0 }, {
    jobId: `scheduled-retry-${tripId}-${interval}`,
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: { age: 600, count: 5000 },
    removeOnFail: 100,
  });
}

export async function enqueueOfferTimeout(tripId: string, driverId: string, delay: number) {
  if (!offerTimeoutQueue) throw new Error('Redis is required for trip dispatch');
  await offerTimeoutQueue.add('offer-timeout', { tripId, driverId }, { delay, jobId: `offer-${tripId}-${driverId}`, removeOnComplete: true, removeOnFail: 100 });
}

export async function enqueueSearchExpiry(tripId: string, delay = env.SEARCH_TIMEOUT_SECONDS * 1000) {
  if (!searchExpiryQueue) throw new Error('Redis is required for trip dispatch');
  await searchExpiryQueue.add('search-expiry', { tripId }, { delay, jobId: `search-${tripId}`, removeOnComplete: true, removeOnFail: 100 });
}

export async function removeTripJobs(tripId: string, driverId?: string) {
  await Promise.all([
    searchExpiryQueue?.getJob(`search-${tripId}`).then((job) => job?.remove()),
    driverId ? offerTimeoutQueue?.getJob(`offer-${tripId}-${driverId}`).then((job) => job?.remove()) : undefined,
  ]);
}

export async function recoverPendingDispatch() {
  if (!dispatchQueue || !offerTimeoutQueue || !searchExpiryQueue) throw new Error('Redis is required for trip recovery');
  const offeredTrips = new Set<string>();
  for (const offer of await pendingOfferRecovery()) {
    const remaining = new Date(offer.expires_at).getTime() - Date.now();
    if (remaining <= 0) { await expireOffer(offer.trip_id, offer.driver_id); continue; }
    offeredTrips.add(offer.trip_id);
    const job = await offerTimeoutQueue.getJob(`offer-${offer.trip_id}-${offer.driver_id}`);
    const state = await job?.getState();
    if (state === 'failed' || state === 'completed') await job?.remove();
    if (!job || state === 'failed' || state === 'completed') await enqueueOfferTimeout(offer.trip_id, offer.driver_id, Math.max(100, remaining));
  }
  const interval = Math.floor(Date.now() / 30_000);
  for (const search of await pendingSearchRecovery()) {
    const remaining = search.deadline - Date.now();
    if (remaining <= 0) { await expireSearch(search.tripId); continue; }
    const expiry = await searchExpiryQueue.getJob(`search-${search.tripId}`);
    const state = await expiry?.getState();
    if (state === 'failed' || state === 'completed') await expiry?.remove();
    if (!expiry || state === 'failed' || state === 'completed') await enqueueSearchExpiry(search.tripId, remaining);
    if (!offeredTrips.has(search.tripId)) await dispatchQueue.add('dispatch', { tripId: search.tripId, radiusIndex: 0 }, {
      jobId: `recovery-${search.tripId}-${interval}`, attempts: 3,
      backoff: { type: 'exponential', delay: 1000 }, removeOnComplete: 100, removeOnFail: 100,
    });
  }
}

export async function startTripWorkers() {
  if (!connection) throw new Error('Redis is required for trip workers');
  if (started) return;
  started = true;
  const workerOptions = { connection, prefix: env.TRIP_QUEUE_PREFIX };
  const dispatchWorker = new Worker('trip-dispatch', async (job) => {
    const result = await dispatchNext(job.data.tripId as string, Number(job.data.radiusIndex) || 0);
    if (result.kind === 'expand') await enqueueDispatch(job.data.tripId as string, result.radiusIndex, 250);
    if (result.kind === 'offered') await enqueueOfferTimeout(job.data.tripId as string, result.driverId, env.OFFER_TIMEOUT_SECONDS * 1000);
  }, workerOptions);
  const offerWorker = new Worker('trip-offer-timeout', async (job) => {
    if (await expireOffer(job.data.tripId as string, job.data.driverId as string)) await enqueueDispatch(job.data.tripId as string);
  }, workerOptions);
  const searchWorker = new Worker('trip-search-expiry', (job) => expireSearch(job.data.tripId as string), workerOptions);
  const dispatchScheduled = async () => {
    const ids = await activateDueScheduledTrips();
    for (const id of ids) await Promise.all([enqueueScheduledInitialDispatch(id), enqueueSearchExpiry(id, await scheduledSearchExpiryDelay(id))]);
    for (const id of await overdueScheduledSearches()) await expireSearch(id);
    for (const id of await scheduledSearchesWithoutOffers()) {
      if (ids.includes(id)) continue;
      const initial = await dispatchQueue?.getJob(`scheduled-initial-${id}`);
      if (!initial) await enqueueScheduledInitialDispatch(id);
      else if (['completed', 'failed'].includes(await initial.getState())) await enqueueScheduledRetry(id);
      if (!await searchExpiryQueue?.getJob(`search-${id}`)) await enqueueSearchExpiry(id, await scheduledSearchExpiryDelay(id));
    }
  };
  const maintenanceWorker = new Worker('trip-maintenance', async (job) => {
    if (job.name === 'activate-scheduled') await dispatchScheduled();
    else if (job.name === 'recover-dispatch') await recoverPendingDispatch();
    else await logStaleTrips();
  }, workerOptions);
  workers = [dispatchWorker, offerWorker, searchWorker, maintenanceWorker];
  for (const [queue, worker] of [[dispatchQueue, dispatchWorker], [offerTimeoutQueue, offerWorker], [searchExpiryQueue, searchWorker], [maintenanceQueue, maintenanceWorker]] as const) if (queue) observeWorker(queue,worker,connection);
  for (const worker of [dispatchWorker, offerWorker, searchWorker, maintenanceWorker]) {
    worker.on('error', (error) => console.error('[trips] queue worker error', error.message));
  }
  await Promise.all(workers.map(worker => worker.waitUntilReady()));
  await maintenanceQueue?.upsertJobScheduler('stale-trip-reaper', { every: 5 * 60 * 1000 }, { name: 'stale-trip-reaper' });
  await maintenanceQueue?.upsertJobScheduler('activate-scheduled', { every: 30 * 1000 }, { name: 'activate-scheduled' });
  await maintenanceQueue?.upsertJobScheduler('recover-dispatch', { every: 30 * 1000 }, { name: 'recover-dispatch' });
  await dispatchScheduled();
  await recoverPendingDispatch();
}

export function tripWorkersReady() {
  return started && connection?.status === 'ready' && workers.length === 4
    && workers.every(worker => worker.isRunning() && !worker.isPaused());
}
export async function tripQueuesAccepting() {
  if(!tripWorkersReady())return false;
  return (await Promise.all([dispatchQueue,offerTimeoutQueue,searchExpiryQueue,maintenanceQueue].map(queue=>queue!.isPaused()))).every(paused=>!paused);
}

export async function stopTripWorkers() {
  await Promise.all(workers.map((worker) => worker.close()));
  workers = [];
  await Promise.all([dispatchQueue?.close(), offerTimeoutQueue?.close(), searchExpiryQueue?.close(), maintenanceQueue?.close()]);
  await connection?.quit();
  started = false;
}

export async function getTripQueueHealth() {
  const {queueHealth}=await import('../../shared/utils/queueHealth.js');
  return Promise.all([queueHealth('Trip dispatch worker',dispatchQueue),queueHealth('Trip offer timeout worker',offerTimeoutQueue),queueHealth('Trip search expiry worker',searchExpiryQueue),queueHealth('Trip maintenance worker',maintenanceQueue)]);
}
```

</details>

## src/modules/payments/paymentQueue.ts

[Open source](../src/modules/payments/paymentQueue.ts)

SHA-256: `b1946e534a95da46889e5f2f6cb4aa2cb422235bd022d1c84d47f4511efa05ac`

<details>
<summary>Full TypeScript implementation</summary>

```ts
import { createHash } from 'node:crypto';
import { observeWorker } from '../../shared/utils/queueHealth';
import IORedis from 'ioredis';
import { Queue, Worker } from 'bullmq';
import { env } from '../../config/env';

const connection=env.REDIS_URL?new IORedis(env.REDIS_URL,{maxRetriesPerRequest:null}):null;
const queue=connection?new Queue('payments',{connection}):null;
let started=false;
let paymentWorker:Worker|null=null;
export async function enqueueWebhook(key:string) {
  if (!queue) throw new Error('Redis is required for payment webhook processing');
  return queueWebhook(queue,key);
}
export async function queueWebhook(queue: Queue,key: string) {
  const legacyId=`webhook-${key}`.replace(/[^a-zA-Z0-9_-]/g,'-');
  const jobId=`webhook-${createHash('sha256').update(key).digest('hex')}`;
  const previous=await queue.getJob(jobId)??await queue.getJob(legacyId);
  // Reconciliation must recover exhausted jobs; adding the same retained ID is a no-op.
  if (previous && await previous.getState()==='failed') {
    try { await previous.retry('failed'); }
    catch (error) { if (await previous.getState()==='failed') throw error; }
    return;
  }
  await queue.add('webhook',{key},{jobId,attempts:5,backoff:{type:'exponential',delay:1000},removeOnComplete:1000});
}
export async function enqueuePayout(id:string) {
  if (!queue) throw new Error('Redis is required for payouts');
  await queue.add('payout',{id},{jobId:`payout-${id}-${Date.now()}`,attempts:5,backoff:{type:'exponential',delay:30000},removeOnComplete:1000});
}
export async function startPaymentWorkers() {
  if (!connection||!queue) throw new Error('Redis is required for payment workers');
  if (started) return;
  started=true;
  const worker=new Worker('payments',async(job)=>{
    if (job.name==='webhook') { const {processWebhook}=await import('./webhook.service.js');await processWebhook(String(job.data.key)); }
    else if (job.name==='payout') { const {initiatePayout}=await import('./withdrawals.service.js');await initiatePayout(String(job.data.id)); }
    else {
      const checks=await import('./reconciliation.service.js');
      if (job.name==='topup-reconciler') await checks.reconcileTopups();
      if (job.name==='withdrawal-reconciler') await checks.reconcileWithdrawals();
      if (job.name==='ledger-integrity') await checks.checkLedgerIntegrity();
      if (job.name==='gateway-balance-check') await checks.checkGatewayBalance();
      if (job.name==='stuck-escrow-check') await checks.checkStuckEscrow();
      if (job.name==='daily-finance-report') await checks.dailyFinanceReport();
    }
  },{connection});
  paymentWorker=worker;
  observeWorker(queue,worker,connection);
  worker.on('error',(error)=>console.error('[payments] worker error',error.message));
  await worker.waitUntilReady();
  for (const [name,every] of [['topup-reconciler',600000],['withdrawal-reconciler',300000],['gateway-balance-check',3600000],['stuck-escrow-check',900000]] as const)
    await queue.upsertJobScheduler(name,{every},{name});
  await queue.upsertJobScheduler('ledger-integrity',{pattern:'0 0 1 * * *',tz:'Africa/Lagos'},{name:'ledger-integrity'});
  await queue.upsertJobScheduler('daily-finance-report',{pattern:'0 30 0 * * *',tz:'Africa/Lagos'},{name:'daily-finance-report'});
}

export function paymentWorkersReady() {
  return started && connection?.status === 'ready' && paymentWorker !== null
    && paymentWorker.isRunning() && !paymentWorker.isPaused();
}
export async function paymentQueueAccepting() {return paymentWorkersReady() && !await queue!.isPaused();}

export async function stopPaymentWorkers() {
  await paymentWorker?.close();
  paymentWorker=null;
  await queue?.close();
  await connection?.quit();
  started=false;
}

export async function getPaymentQueueHealth() {
  const {queueHealth}=await import('../../shared/utils/queueHealth.js');
  return queueHealth('Payment and reconciliation worker',queue);
}
```

</details>

## src/modules/payments/reconciliation.service.ts

[Open source](../src/modules/payments/reconciliation.service.ts)

SHA-256: `9f187ad5acca474080301df5a6dea60bac9e9e085a4656b3a49dae22c1ce2fbc`

<details>
<summary>Full TypeScript implementation</summary>

```ts
import { ensureRedis } from '../../shared/config/redis';
import { db } from '../../shared/config/db';
import { env } from '../../config/env';
import { gateway, isTransferNotFound } from './gateway';
import { applySuccessfulTopup } from './topups.service';
import { applyWithdrawalOutcome } from './withdrawals.service';
import { enqueuePayout } from './paymentQueue';
import { enqueueWebhook } from './paymentQueue';

async function alertOps(kind:string,details:Record<string,unknown>) {
  console.error('[payments] alert',kind,details);
  if (!env.ALERT_WEBHOOK_URL) return;
  try { await fetch(env.ALERT_WEBHOOK_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:`Rakky Ride payment alert: ${kind}`,details}),signal:AbortSignal.timeout(5000)}); }
  catch(error) { console.error('[payments] alert delivery failed',error instanceof Error?error.message:'unknown'); }
}
export async function reconcileTopups() {
  const stuckEvents=await db.query<{dedupe_key:string}>("SELECT dedupe_key FROM payment_webhook_events WHERE status IN ('received','failed') AND received_at<now()-interval '2 minutes' ORDER BY received_at,id LIMIT 100");
  for (const event of stuckEvents.rows) await enqueueWebhook(event.dedupe_key);
  const rows=await db.query<{provider_reference:string;created_at:Date}>("SELECT provider_reference,created_at FROM payment_intents WHERE status IN ('pending','failed','abandoned') AND created_at<now()-interval '10 minutes' AND updated_at<now()-interval '10 minutes' ORDER BY updated_at,id LIMIT 100");
  for (const row of rows.rows) {
    try {
      await db.query("UPDATE payment_intents SET updated_at=now() WHERE provider_reference=$1 AND status IN ('pending','failed','abandoned')",[row.provider_reference]);
      const result=await applySuccessfulTopup(row.provider_reference);
      if (result.status==='mismatch') await alertOps('topup_mismatch',{reference:row.provider_reference});
      if (!result.applied && new Date(row.created_at).getTime()<Date.now()-86400000 && ['abandoned','failed'].includes(result.status))
        await db.query("UPDATE payment_intents SET status='abandoned',updated_at=now() WHERE provider_reference=$1 AND status='pending'",[row.provider_reference]);
    } catch(error) { console.error('[payments] top-up reconciliation failed',{reference:row.provider_reference,error:error instanceof Error?error.message:'unknown'}); }
  }
}
export async function reconcileWithdrawals() {
  const rows=await db.query<{id:string;provider_reference:string;status:string}>(`SELECT id,provider_reference,status FROM withdrawals
    WHERE status IN ('pending','processing') AND updated_at<now()-interval '2 minutes' ORDER BY updated_at,id LIMIT 100`);
  for(const row of rows.rows) {
    try {
      await db.query("UPDATE withdrawals SET updated_at=now() WHERE id=$1 AND status IN ('pending','processing')",[row.id]);
      await applyWithdrawalOutcome(row.provider_reference);
    } catch(error) {
      if(row.status==='pending'&&isTransferNotFound(error))await enqueuePayout(row.id);
      else {
        const category=error instanceof Error?error.message:'verification_unavailable';
        await alertOps('withdrawal_verification_exception',{withdrawalId:row.id,category});
      }
    }
  }
}
export async function checkLedgerIntegrity() {
  const problems=await db.query<{kind:string;id:string}>(`
    SELECT 'unbalanced' kind,t.id::text id FROM ledger_transactions t LEFT JOIN ledger_entries e ON e.transaction_id=t.id
      GROUP BY t.id HAVING COALESCE(SUM(e.amount_kobo) FILTER(WHERE e.direction='debit'),0)<>COALESCE(SUM(e.amount_kobo) FILTER(WHERE e.direction='credit'),0)
    UNION ALL
    SELECT 'cached_balance',a.id::text FROM ledger_accounts a LEFT JOIN ledger_entries e ON e.account_id=a.id
      GROUP BY a.id HAVING a.balance_kobo<>COALESCE(SUM(CASE WHEN e.direction=a.normal_side THEN e.amount_kobo ELSE -e.amount_kobo END),0)
    UNION ALL
    SELECT 'last_entry',a.id::text FROM ledger_accounts a JOIN LATERAL (SELECT balance_after_kobo FROM ledger_entries WHERE account_id=a.id ORDER BY id DESC LIMIT 1) e ON true
      WHERE a.balance_kobo<>e.balance_after_kobo LIMIT 100`);
  if (problems.rows.length) await alertOps('ledger_integrity_failed',{problems:problems.rows});
  return problems.rows;
}
export async function checkGatewayBalance() {
  if (!env.PAYSTACK_SECRET_KEY) return;
  const actual=await gateway.getBalance();
  if (!Number.isSafeInteger(actual) || actual<0) throw new Error('invalid_provider_balance');
  const mode=env.PAYSTACK_SECRET_KEY.startsWith('sk_live_')?'live':'test';
  await ensureRedis().then(r=>r.set(`rakky:finance:provider-balance:${mode}`,JSON.stringify({balanceKobo:String(actual),observedAt:new Date().toISOString()}),'EX',86400)).catch(()=>undefined);
  const expected=Number((await db.query<{balance_kobo:string}>("SELECT balance_kobo FROM ledger_accounts WHERE code='gateway_balance'")).rows[0]?.balance_kobo??0);
  const alertLevel=Number((await db.query<{paystack_balance_alert_kobo:string}>('SELECT paystack_balance_alert_kobo FROM payment_settings WHERE id=true')).rows[0]?.paystack_balance_alert_kobo??0);
  if (Math.abs(actual-expected)>10000) await alertOps('gateway_balance_drift',{actualKobo:actual,ledgerKobo:expected});
  if (actual<alertLevel) await alertOps('gateway_balance_low',{actualKobo:actual,thresholdKobo:alertLevel});
}
export async function checkStuckEscrow() {
  const rows=await db.query<{id:string}>("SELECT id FROM trips WHERE status IN ('completed','returned','cancelled','no_drivers_found') AND payment_status='held' LIMIT 50");
  const escrow=Number((await db.query<{balance_kobo:string}>("SELECT balance_kobo FROM ledger_accounts WHERE code='escrow_trips'")).rows[0]?.balance_kobo??0);
  const active=Number((await db.query<{total:string}>("SELECT COALESCE(SUM(fare_kobo),0)::text total FROM trips WHERE status IN ('searching','driver_assigned','driver_arrived','in_progress','returning') AND payment_status='held'")).rows[0]?.total??0);
  if (rows.rows.length||escrow!==active) await alertOps('stuck_escrow',{terminalTripIds:rows.rows.map((row)=>row.id),escrowKobo:escrow,activeFaresKobo:active});
}
export async function dailyFinanceReport() {
  const today=new Date().toLocaleDateString('en-CA',{timeZone:'Africa/Lagos'});
  const to=new Date(`${today}T00:00:00+01:00`).toISOString(),from=new Date(Date.parse(to)-86400000).toISOString();
  const totals=(await db.query<{topups:string;gmv:string;commission:string;withdrawals:string;failed_withdrawals:string;gateway_fees:string;cash_debt:string;suspense:string}>(`
    SELECT
      (SELECT COALESCE(SUM(amount_kobo),0)::text FROM payment_intents WHERE status='succeeded' AND paid_at >= $1 AND paid_at < $2) topups,
      (SELECT COALESCE(SUM(fare_kobo),0)::text FROM trips WHERE status IN ('completed','returned') AND payment_status='settled' AND (CASE WHEN status='returned' THEN returned_at ELSE completed_at END) >= $1 AND (CASE WHEN status='returned' THEN returned_at ELSE completed_at END) < $2) gmv,
      (SELECT COALESCE(SUM(commission_kobo),0)::text FROM trips WHERE status IN ('completed','returned') AND payment_status='settled' AND (CASE WHEN status='returned' THEN returned_at ELSE completed_at END) >= $1 AND (CASE WHEN status='returned' THEN returned_at ELSE completed_at END) < $2) commission,
      (SELECT COALESCE(SUM(amount_kobo),0)::text FROM withdrawals WHERE status='success' AND completed_at >= $1 AND completed_at < $2) withdrawals,
      (SELECT COUNT(*)::text FROM withdrawals WHERE status IN ('failed','reversed') AND completed_at >= $1 AND completed_at < $2) failed_withdrawals,
      (SELECT COALESCE(SUM(e.amount_kobo),0)::text FROM ledger_entries e JOIN ledger_accounts a ON a.id=e.account_id WHERE a.code='expense_gateway_fees' AND e.direction='debit' AND e.created_at >= $1 AND e.created_at < $2) gateway_fees,
      (SELECT COALESCE(SUM(-balance_kobo),0)::text FROM ledger_accounts WHERE kind='driver_earnings' AND balance_kobo<0) cash_debt,
      (SELECT balance_kobo::text FROM ledger_accounts WHERE code='suspense') suspense`,[from,to])).rows[0];
  console.info('[payments] daily finance report',totals);
  if (env.ALERT_WEBHOOK_URL) {
    try { await fetch(env.ALERT_WEBHOOK_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:'Rakky Ride daily finance report',totals}),signal:AbortSignal.timeout(5000)}); }
    catch(error) { console.error('[payments] daily report delivery failed',error instanceof Error?error.message:'unknown'); }
  }
  return totals;
}
```

</details>

## src/modules/payments/gateway.ts

[Open source](../src/modules/payments/gateway.ts)

SHA-256: `6f24e22a5e28a1bd2b1756c64f21620dbac61bc5c89d5b325b5c187a3bf86899`

<details>
<summary>Full TypeScript implementation</summary>

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';
import { ensureRedis } from '../../shared/config/redis';
import { env } from '../../config/env';
import { ApiError } from '../../shared/errors';

export interface PaymentGateway {
  initializeCharge(input:{email:string;amountKobo:number;reference:string;metadata:Record<string,unknown>;callbackUrl?:string}):Promise<{authorizationUrl:string;accessCode:string}>;
  verifyCharge(reference:string):Promise<{status:string;reference:string;domain:string;amountKobo:number;currency:string;feeKobo:number;channel:string|null;paidAt:string|null}>;
  listBanks():Promise<Array<{name:string;code:string}>>;
  resolveAccount(input:{accountNumber:string;bankCode:string}):Promise<{accountName:string}>;
  createRecipient(input:{name:string;accountNumber:string;bankCode:string}):Promise<{recipientCode:string}>;
  initiateTransfer(input:{amountKobo:number;recipientCode:string;reference:string;reason:string}):Promise<{status:string;transferCode:string|null}>;
  verifyTransfer(reference:string):Promise<VerifiedTransfer>;
  getBalance():Promise<number>;
  verifyWebhookSignature(rawBody:Buffer,signature:string|undefined):boolean;
}

export interface VerifiedTransfer {
  status:string; reference:string; domain:string; amountKobo:number; currency:string;
  recipientCode:string; transferCode:string|null; feeKobo:number|null;
}
export const paymentMode=()=>env.PAYSTACK_SECRET_KEY.startsWith('sk_live_')?'live':'test';

interface Envelope<T> {status:boolean;message:string;data:T;code?:string}
export class PaystackRequestError extends ApiError {
  constructor(readonly httpStatus:number,readonly category:'not_found'|'rejected'|'access_denied'|'unavailable'|'invalid_response') {
    super(category==='not_found'?404:category==='access_denied'?503:category==='rejected'?400:502,`paystack_${category}`);
  }
}
export const isTransferNotFound=(error:unknown)=>error instanceof PaystackRequestError && error.category==='not_found';
export function verifyPaystackSignature(rawBody:Buffer,signature:string|undefined,secret:string):boolean {
  if (!secret || !signature || !/^[0-9a-f]{128}$/i.test(signature)) return false;
  const expected=createHmac('sha512',secret).update(rawBody).digest();
  const supplied=Buffer.from(signature,'hex');
  return expected.length===supplied.length && timingSafeEqual(expected,supplied);
}
export class PaystackGateway implements PaymentGateway {
  private async request<T>(method:'GET'|'POST',path:string,body?:unknown,deadline=AbortSignal.timeout(12000)):Promise<T> {
    if (!env.PAYSTACK_SECRET_KEY) throw new ApiError(503,'paystack_not_configured');
    if(method==='POST' && paymentMode()==='live' && !env.ENABLE_LIVE_PAYMENTS) throw new ApiError(503,'live_payments_disabled');
    for (let attempt=0;attempt<(method==='GET'?3:1);attempt++) {
      try {
        const response=await fetch(`${env.PAYSTACK_BASE_URL}${path}`,{
          method,headers:{Authorization:`Bearer ${env.PAYSTACK_SECRET_KEY}`,'Content-Type':'application/json'},
          body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.any([deadline,AbortSignal.timeout(10000)]),
        });
        const envelope=await response.json().catch(()=>{throw new PaystackRequestError(response.status,'invalid_response');}) as Envelope<T>;
        if (!envelope || typeof envelope.status!=='boolean') throw new PaystackRequestError(response.status,'invalid_response');
        if (!response.ok || !envelope.status) {
          const transferMissing=path.startsWith('/transfer/verify/') && (response.status===404 || (response.status===400 && /^transfer not found\.?$/i.test(envelope.message??'')));
          throw new PaystackRequestError(response.status,transferMissing?'not_found':response.status===401||response.status===403||envelope.code==='transfer_unavailable'?'access_denied':response.status>=500||response.status===429?'unavailable':'rejected');
        }
        if(envelope.data===undefined || envelope.data===null)throw new PaystackRequestError(response.status,'invalid_response');
        void ensureRedis().then(r=>r.set('rakky:health:paystack',JSON.stringify({state:'reachable',observedAt:new Date().toISOString()}),'EX',86400)).catch(()=>undefined);
        return envelope.data;
      } catch(error) {
        if ((error instanceof PaystackRequestError&&error.category==='access_denied') || deadline.aborted || method==='POST' || attempt===2 || (error instanceof ApiError && error.status<500)) {
          void ensureRedis().then(r=>r.set('rakky:health:paystack',JSON.stringify({state:'degraded',observedAt:new Date().toISOString()}),'EX',86400)).catch(()=>undefined);
          throw error instanceof ApiError?error:new PaystackRequestError(0,'unavailable');
        }
        await new Promise((resolve)=>setTimeout(resolve,250*(attempt+1)));
      }
    }
    throw new ApiError(502,'paystack_unavailable');
  }
  async initializeCharge(input:{email:string;amountKobo:number;reference:string;metadata:Record<string,unknown>;callbackUrl?:string}) {
    const data=await this.request<{authorization_url:string;access_code:string}>('POST','/transaction/initialize',{
      email:input.email,amount:input.amountKobo,reference:input.reference,metadata:input.metadata,
      ...(input.callbackUrl?{callback_url:input.callbackUrl}:{}),
    });
    return {authorizationUrl:data.authorization_url,accessCode:data.access_code};
  }
  async verifyCharge(reference:string) {
    const data=await this.request<{status:string;reference:string;domain:string;amount:number;currency:string;fees:number;channel:string|null;paid_at:string|null}>('GET',`/transaction/verify/${encodeURIComponent(reference)}`);
    return {status:data.status,reference:data.reference,domain:data.domain,amountKobo:data.amount,currency:data.currency,feeKobo:data.fees,channel:data.channel,paidAt:data.paid_at};
  }
  async listBanks() {
    // Paystack currently returns the complete Nigerian bank list for this endpoint.
    // Paging it repeats the same banks and makes the picker thousands of rows long.
    const banks=await this.request<Array<{name:string;code:string}>>('GET','/bank?country=nigeria');
    return [...new Map(banks.map(({name,code})=>[code,{name,code}])).values()];
  }
  async resolveAccount(input:{accountNumber:string;bankCode:string}) {
    const data=await this.request<{account_name:string}>('GET',`/bank/resolve?account_number=${encodeURIComponent(input.accountNumber)}&bank_code=${encodeURIComponent(input.bankCode)}`);
    return {accountName:data.account_name};
  }
  async createRecipient(input:{name:string;accountNumber:string;bankCode:string}) {
    const data=await this.request<{recipient_code:string}>('POST','/transferrecipient',{type:'nuban',name:input.name,account_number:input.accountNumber,bank_code:input.bankCode,currency:'NGN'});
    return {recipientCode:data.recipient_code};
  }
  async initiateTransfer(input:{amountKobo:number;recipientCode:string;reference:string;reason:string}) {
    const data=await this.request<{status:string;transfer_code:string|null}>('POST','/transfer',{source:'balance',amount:input.amountKobo,recipient:input.recipientCode,reference:input.reference,reason:input.reason,currency:'NGN'});
    return {status:data.status,transferCode:data.transfer_code};
  }
  async verifyTransfer(reference:string) {
    interface TransferData {status:string;reference:string;domain:string;amount:number;currency:string;transfer_code:string|null;recipient:{recipient_code:string};fee_charged?:number}
    const deadline=AbortSignal.timeout(14000);
    let data=await this.request<TransferData>('GET',`/transfer/verify/${encodeURIComponent(reference)}`,undefined,deadline);
    // Verify responses may omit fees. Fetch the same transfer's documented fee;
    // never settle using a mutable commercial estimate or silently assume zero.
    if(data.status==='success' && data.fee_charged===undefined && typeof data.transfer_code==='string') {
      const details=await this.request<TransferData>('GET',`/transfer/${encodeURIComponent(data.transfer_code)}`,undefined,deadline);
      if(details.reference!==data.reference || details.transfer_code!==data.transfer_code)throw new PaystackRequestError(200,'invalid_response');
      data=details;
    }
    return {status:data.status,reference:data.reference,domain:data.domain,amountKobo:data.amount,currency:data.currency,recipientCode:data.recipient?.recipient_code,
      transferCode:data.transfer_code,feeKobo:data.fee_charged??null};
  }
  async getBalance() {
    const data=await this.request<Array<{currency:string;balance:number}>>('GET','/balance');
    const balance=Array.isArray(data)?data.find((item)=>item.currency==='NGN')?.balance:undefined;
    if(typeof balance!=='number'||!Number.isSafeInteger(balance)||balance<0)throw new PaystackRequestError(200,'invalid_response');
    return balance!;
  }
  verifyWebhookSignature(rawBody:Buffer,signature:string|undefined) {
    return verifyPaystackSignature(rawBody,signature,env.PAYSTACK_SECRET_KEY);
  }
}
export const gateway:PaymentGateway=new PaystackGateway();
```

</details>

## src/modules/payments/tripPayments.service.ts

[Open source](../src/modules/payments/tripPayments.service.ts)

SHA-256: `67d13c24718e2a8135cdbaed524542da1c1923bc97e5e6eecea4125883e3df8a`

<details>
<summary>Full TypeScript implementation</summary>

```ts
import type { PoolClient } from 'pg';
import { ApiError } from '../../shared/errors';
import type { TripRow } from '../trips/trip.types';
import { getOrCreateEarningsAccount, getOrCreateWalletAccount, getSystemAccountId, postTransaction } from './ledger.service';

export async function holdTripFare(client: PoolClient, trip: TripRow): Promise<void> {
  if (trip.payment_method !== 'wallet') return;
  const wallet = await getOrCreateWalletAccount(client, trip.rider_id);
  const escrow = await getSystemAccountId(client, 'escrow_trips');
  const { transactionId } = await postTransaction(client, { type: 'trip_hold', idempotencyKey: `trip:${trip.id}:hold`, referenceType: 'trip', referenceId: trip.id,
    entries: [{accountId:wallet,direction:'debit',amountKobo:Number(trip.fare_kobo)},{accountId:escrow,direction:'credit',amountKobo:Number(trip.fare_kobo)}] });
  await client.query("UPDATE trips SET payment_status='held',hold_tx_id=$2 WHERE id=$1",[trip.id,transactionId]);
}

export async function releaseTripHold(client: PoolClient, trip: TripRow): Promise<void> {
  if (trip.payment_status !== 'held') return;
  const wallet = await getOrCreateWalletAccount(client, trip.rider_id);
  const escrow = await getSystemAccountId(client, 'escrow_trips');
  await postTransaction(client, { type: 'trip_hold_release', idempotencyKey: `trip:${trip.id}:release`, referenceType: 'trip', referenceId: trip.id,
    entries: [{accountId:escrow,direction:'debit',amountKobo:Number(trip.fare_kobo)},{accountId:wallet,direction:'credit',amountKobo:Number(trip.fare_kobo)}] });
  await client.query("UPDATE trips SET payment_status='released' WHERE id=$1",[trip.id]);
}

export async function settleTrip(client: PoolClient, trip: TripRow, commissionKobo: number, driverEarningKobo: number): Promise<void> {
  if (!trip.driver_id) throw new ApiError(409,'trip_has_no_driver');
  const earnings = await getOrCreateEarningsAccount(client,trip.driver_id);
  const revenue = await getSystemAccountId(client,'revenue_commission');
  const fare = Number(trip.fare_kobo);
  if (trip.payment_method === 'wallet' && trip.payment_status !== 'held') throw new ApiError(409,'trip_fare_not_held');
  if (trip.payment_method !== 'wallet' && trip.payment_method !== 'cash') throw new ApiError(409,'card_payment_not_available');
  if (trip.payment_method === 'cash' && commissionKobo === 0) {
    await client.query("UPDATE trips SET payment_status='settled' WHERE id=$1",[trip.id]);
    return;
  }
  const entries = trip.payment_method === 'wallet'
    ? [{accountId:await getSystemAccountId(client,'escrow_trips'),direction:'debit' as const,amountKobo:fare},
       ...(driverEarningKobo>0?[{accountId:earnings,direction:'credit' as const,amountKobo:driverEarningKobo}]:[]),
       ...(commissionKobo>0?[{accountId:revenue,direction:'credit' as const,amountKobo:commissionKobo}]:[])]
    : [{accountId:earnings,direction:'debit' as const,amountKobo:commissionKobo},{accountId:revenue,direction:'credit' as const,amountKobo:commissionKobo}];
  const {transactionId}=await postTransaction(client,{type:trip.payment_method==='wallet'?'trip_settlement_wallet':'trip_commission_cash',
    idempotencyKey:`trip:${trip.id}:settle`,referenceType:'trip',referenceId:trip.id,entries});
  await client.query("UPDATE trips SET payment_status='settled',settle_tx_id=$2 WHERE id=$1",[trip.id,transactionId]);
}
```

</details>

## src/modules/payments/topups.service.ts

[Open source](../src/modules/payments/topups.service.ts)

SHA-256: `759d1de4ad16481554873770610167ade477d10e1edd7c7ec4f95d9d84169613`

<details>
<summary>Full TypeScript implementation</summary>

```ts
import { randomUUID } from 'node:crypto';
import { db, inTransaction } from '../../shared/config/db';
import { ApiError } from '../../shared/errors';
import { env } from '../../config/env';
import { gateway, paymentMode } from './gateway';
import { emitWalletUpdated } from '../../websocket/notifications';
import { getOrCreateEarningsAccount, getOrCreateWalletAccount, getSystemAccountId, postTransaction } from './ledger.service';
import { rateLimit } from './payoutAccounts.service';

interface IntentRow { id:string;user_id:string;target:'wallet'|'earnings';amount_kobo:string;status:string;provider_reference:string;authorization_url:string|null }
export async function createTopup(userId:string,amountKobo:number,target:'wallet'|'earnings') {
  if(paymentMode()==='live'&&!env.ENABLE_LIVE_PAYMENTS)throw new ApiError(503,'live_payments_disabled');
  if (!Number.isSafeInteger(amountKobo)) throw new ApiError(400,'invalid_amount');
  if (target!=='wallet'&&target!=='earnings') throw new ApiError(400,'invalid_target');
  const settings=(await db.query<{min_topup_kobo:string;max_topup_kobo:string}>('SELECT min_topup_kobo,max_topup_kobo FROM payment_settings WHERE id=true')).rows[0];
  if (!settings || amountKobo<Number(settings.min_topup_kobo)||amountKobo>Number(settings.max_topup_kobo)) throw new ApiError(400,'topup_amount_out_of_range');
  const user=(await db.query<{email:string|null}>('SELECT email FROM users WHERE id=$1 AND is_active=true',[userId])).rows[0];
  if (!user) throw new ApiError(401,'user_not_found');
  if (target==='earnings') {
    const approved=(await db.query("SELECT 1 FROM driver_profiles WHERE user_id=$1 AND status='approved'",[userId])).rowCount;
    if (!approved) throw new ApiError(403,'driver_not_approved');
  }
  if (!user.email && !env.PAYMENT_SYNTHETIC_EMAIL_DOMAIN) throw new ApiError(503,'payment_email_domain_not_configured');
  await rateLimit(`payments:topup:${userId}`,10,3600);
  const id=randomUUID(),reference=`tu_${id.replace(/-/g,'')}`;
  await db.query('INSERT INTO payment_intents(id,user_id,target,amount_kobo,provider_reference) VALUES($1,$2,$3,$4,$5)',[id,userId,target,amountKobo,reference]);
  try {
    const callback=env.PAYMENT_CALLBACK_URL?new URL(env.PAYMENT_CALLBACK_URL):null;
    callback?.searchParams.set('target',target);
    const checkout=await gateway.initializeCharge({email:user.email??`u_${userId.replace(/-/g,'')}@${env.PAYMENT_SYNTHETIC_EMAIL_DOMAIN}`,amountKobo,reference,metadata:{intentId:id,userId,target},callbackUrl:callback?.toString()});
    await db.query('UPDATE payment_intents SET authorization_url=$2,access_code=$3,updated_at=now() WHERE id=$1',[id,checkout.authorizationUrl,checkout.accessCode]);
    return {reference,authorizationUrl:checkout.authorizationUrl,accessCode:checkout.accessCode};
  } catch(error) {
    await db.query("UPDATE payment_intents SET status='failed',failure_reason='initialization_failed',updated_at=now() WHERE id=$1",[id]);
    throw error;
  }
}

export async function applySuccessfulTopup(reference:string) {
  const known=(await db.query<{status:string}>('SELECT status FROM payment_intents WHERE provider_reference=$1',[reference])).rows[0];
  if(!known)return {applied:false,status:'unknown_reference'};
  if(known.status==='succeeded')return {applied:false,status:'succeeded',replayed:true};
  const charge=await gateway.verifyCharge(reference);
  if (charge.status!=='success') return {applied:false,status:charge.status};
  const result=await inTransaction(async(client)=>{
    const intent=(await client.query<IntentRow>('SELECT * FROM payment_intents WHERE provider_reference=$1 FOR UPDATE',[reference])).rows[0];
    if (!intent) return {applied:false,status:'unknown_reference'};
    if (intent.status==='succeeded') return {applied:false,status:'succeeded',replayed:true};
    const gross=Number(intent.amount_kobo),fee=charge.feeKobo;
    if (charge.reference!==reference||charge.domain!==paymentMode()||charge.currency!=='NGN'||charge.amountKobo!==gross||!Number.isSafeInteger(gross)||!Number.isSafeInteger(fee)||fee<0||fee>=gross||!charge.paidAt||!Number.isFinite(Date.parse(charge.paidAt))) {
      await client.query("UPDATE payment_intents SET status='mismatch',updated_at=now() WHERE id=$1",[intent.id]);
      console.error('[payments] top-up verification mismatch', {reference,intentId:intent.id});
      return {applied:false,status:'mismatch'};
    }
    const existingEarnings=(await client.query<{id:string}>("SELECT id FROM ledger_accounts WHERE owner_user_id=$1 AND kind='driver_earnings'",[intent.user_id])).rows[0]?.id;
    const userAccount=intent.target==='wallet'?await getOrCreateWalletAccount(client,intent.user_id):existingEarnings??await getOrCreateEarningsAccount(client,intent.user_id);
    const gatewayAccount=await getSystemAccountId(client,'gateway_balance');
    const feeAccount=await getSystemAccountId(client,'expense_gateway_fees');
    const {transactionId}=await postTransaction(client,{type:'topup',idempotencyKey:`topup:${intent.id}`,referenceType:'payment_intent',referenceId:intent.id,
      entries:[{accountId:gatewayAccount,direction:'debit',amountKobo:gross-fee},
        ...(fee>0?[{accountId:feeAccount,direction:'debit' as const,amountKobo:fee}]:[]),
        {accountId:userAccount,direction:'credit',amountKobo:gross}]});
    await client.query("UPDATE payment_intents SET status='succeeded',failure_reason=NULL,fee_kobo=$2,channel=$3,paid_at=$4,ledger_transaction_id=$5,updated_at=now() WHERE id=$1",[intent.id,fee,charge.channel,charge.paidAt,transactionId]);
    return {applied:true,status:'succeeded'};
  });
  if (result.applied) {
    const owner=(await db.query<{user_id:string}>('SELECT user_id FROM payment_intents WHERE provider_reference=$1',[reference])).rows[0];
    if (owner) emitWalletUpdated(owner.user_id);
  }
  return result;
}
export async function getTopup(userId:string,reference:string) {
  const row=(await db.query<IntentRow>('SELECT * FROM payment_intents WHERE user_id=$1 AND provider_reference=$2',[userId,reference])).rows[0];
  if (!row) throw new ApiError(404,'topup_not_found');
  if (['pending','failed','abandoned'].includes(row.status)) await applySuccessfulTopup(reference);
  const current=(await db.query<IntentRow>('SELECT * FROM payment_intents WHERE id=$1',[row.id])).rows[0];
  return {reference:current.provider_reference,status:current.status,amountKobo:Number(current.amount_kobo),target:current.target};
}
```

</details>

## src/modules/payments/withdrawals.service.ts

[Open source](../src/modules/payments/withdrawals.service.ts)

SHA-256: `2dd2fcb7c451778f1fec797086c8d3dffbad0ec800b20ed72435e2142894799e`

<details>
<summary>Full TypeScript implementation</summary>

```ts
import type {PoolClient} from 'pg';
import { randomUUID } from 'node:crypto';
import { db, inTransaction } from '../../shared/config/db';
import { ApiError } from '../../shared/errors';
import { withVerifiedOtp } from '../auth/otp.service';
import { gateway, isTransferNotFound, paymentMode, PaystackRequestError } from './gateway';
import { env } from '../../config/env';
import { getOrCreateEarningsAccount, getSystemAccountId, postTransaction } from './ledger.service';
import { approvedDriver, rateLimit } from './payoutAccounts.service';
import { enqueuePayout } from './paymentQueue';
import { emitWalletUpdated } from '../../websocket/notifications';

interface WithdrawalRow {id:string;user_id:string;amount_kobo:string;fee_kobo:string;status:string;provider_reference:string;provider_transfer_code:string|null;recipient_code:string;attempts:number;request_tx_id:string|null}
export async function requestWithdrawal(userId:string,payoutAccountId:string,amountKobo:number,otpCode:string) {
  if(paymentMode()==='live'&&!env.ENABLE_LIVE_PAYMENTS)throw new ApiError(503,'live_payments_disabled');
  const user=await approvedDriver(userId);
  if (!user.phone||!Number.isSafeInteger(amountKobo)||amountKobo<=0) throw new ApiError(400,'invalid_withdrawal');
  await rateLimit(`payments:withdraw:${userId}`,5,86400);
  const id=randomUUID(),reference=`wd_${id.replace(/-/g,'')}`;
  const result=await withVerifiedOtp(user.phone,'withdrawal',otpCode,async(client)=>{
    await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[userId]);
    const settings=(await client.query<{min_withdrawal_kobo:string;max_daily_withdrawal_kobo:string;withdrawal_fee_kobo:string;new_payout_account_cooldown_hours:number;transfer_fee_tiers:{maxKobo:number|null;feeKobo:number}[]}>(
      'SELECT min_withdrawal_kobo,max_daily_withdrawal_kobo,withdrawal_fee_kobo,new_payout_account_cooldown_hours,transfer_fee_tiers FROM payment_settings WHERE id=true')).rows[0];
    if (!settings||amountKobo<Number(settings.min_withdrawal_kobo)) throw new ApiError(400,'withdrawal_below_minimum');
    const payout=(await client.query<{id:string}>(`SELECT id FROM payout_accounts WHERE id=$1 AND user_id=$2 AND is_active=true
      AND created_at <= now()-($3*interval '1 hour') FOR UPDATE`,[payoutAccountId,userId,settings.new_payout_account_cooldown_hours])).rows[0];
    if (!payout) throw new ApiError(404,'payout_account_unavailable');
    const daily=(await client.query<{total:string}>(`SELECT COALESCE(SUM(amount_kobo),0)::text AS total FROM withdrawals
      WHERE user_id=$1 AND status NOT IN ('failed','reversed') AND (requested_at AT TIME ZONE 'Africa/Lagos')::date=(now() AT TIME ZONE 'Africa/Lagos')::date`,[userId])).rows[0];
    if (Number(daily?.total??0)+amountKobo>Number(settings.max_daily_withdrawal_kobo)) throw new ApiError(400,'daily_withdrawal_limit_exceeded');
    const gatewayFee=settings.transfer_fee_tiers.find((tier)=>tier.maxKobo===null||amountKobo<=tier.maxKobo)?.feeKobo??0;
    await client.query("SELECT pg_advisory_xact_lock(hashtext('payout_gateway_capacity'))");
    const float=await client.query<{code:string;balance_kobo:string}>("SELECT code,balance_kobo FROM ledger_accounts WHERE code IN ('gateway_balance','payout_in_transit')");
    const gatewayBalance=Number(float.rows.find((row)=>row.code==='gateway_balance')?.balance_kobo??0);
    const inTransit=Number(float.rows.find((row)=>row.code==='payout_in_transit')?.balance_kobo??0);
    const reservedFees=Number((await client.query<{total:string}>(`SELECT COALESCE(SUM((l.metadata->>'gatewayFeeEstimateKobo')::bigint),0)::text total FROM withdrawals w LEFT JOIN ledger_transactions l ON l.id=w.request_tx_id WHERE w.status IN ('pending','processing')`)).rows[0].total);
    if(![gatewayBalance,inTransit,reservedFees,gatewayFee].every(Number.isSafeInteger))throw new ApiError(409,'payout_capacity_out_of_range');
    if (gatewayBalance-inTransit-reservedFees<amountKobo+gatewayFee) throw new ApiError(409,'payout_funds_unavailable');
    // Ledger assets do not prove the provider's currently available transfer float.
    // Reserving all in-transit amounts again is deliberately conservative when
    // provider deductions are already in flight; statements resolve that timing.
    const providerAvailable=await gateway.getBalance();
    if(!Number.isSafeInteger(providerAvailable)||providerAvailable-inTransit-reservedFees<amountKobo+gatewayFee)throw new ApiError(409,'provider_payout_funds_unavailable');
    const fee=Number(settings.withdrawal_fee_kobo);
    const earnings=await getOrCreateEarningsAccount(client,userId);
    const inserted=(await client.query<{id:string}>(`INSERT INTO withdrawals(id,user_id,payout_account_id,amount_kobo,fee_kobo,provider_reference)
      VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,[id,userId,payout.id,amountKobo,fee,reference])).rows[0];
    const transit=await getSystemAccountId(client,'payout_in_transit');
    const revenue=await getSystemAccountId(client,'revenue_fees');
    const {transactionId}=await postTransaction(client,{type:'withdrawal_request',idempotencyKey:`withdrawal:${id}:request`,referenceType:'withdrawal',referenceId:id,metadata:{gatewayFeeEstimateKobo:gatewayFee,feeBasis:'request_time_capacity_estimate'},
      entries:[{accountId:earnings,direction:'debit',amountKobo:amountKobo+fee},{accountId:transit,direction:'credit',amountKobo},
        ...(fee>0?[{accountId:revenue,direction:'credit' as const,amountKobo:fee}]:[])]});
    const remaining=Number((await client.query<{balance_kobo:string}>('SELECT balance_kobo FROM ledger_accounts WHERE id=$1',[earnings])).rows[0].balance_kobo);
    if (remaining<0) throw new ApiError(402,'insufficient_earnings');
    await client.query('UPDATE withdrawals SET request_tx_id=$2 WHERE id=$1',[inserted.id,transactionId]);
    return {id,reference,status:'pending'};
  });
  // The committed reservation is recoverable by reconciliation if Redis fails.
  await enqueuePayout(id).catch(()=>console.error('[payments] payout enqueue needs recovery',{withdrawalId:id}));
  emitWalletUpdated(userId);
  return result;
}

export async function listWithdrawals(userId:string) {
  await approvedDriver(userId);
  const {rows}=await db.query(`SELECT w.id,w.amount_kobo,w.fee_kobo,w.status,w.requested_at,w.completed_at,
    p.bank_name,p.account_last4 FROM withdrawals w JOIN payout_accounts p ON p.id=w.payout_account_id
    WHERE w.user_id=$1 ORDER BY w.requested_at DESC LIMIT 50`,[userId]);
  return {withdrawals:rows.map((row)=>({...row,amount_kobo:Number(row.amount_kobo),fee_kobo:Number(row.fee_kobo)}))};
}
export async function getWithdrawal(userId:string,id:string) {
  const row=(await db.query('SELECT id,amount_kobo,fee_kobo,status,requested_at,completed_at,failure_reason FROM withdrawals WHERE id=$1 AND user_id=$2',[id,userId])).rows[0];
  if (!row) throw new ApiError(404,'withdrawal_not_found');
  return {withdrawal:{...row,amount_kobo:Number(row.amount_kobo),fee_kobo:Number(row.fee_kobo)}};
}

/** Serialize transfer initiation across processes, persisting the attempt before the POST.
 * After any uncertain attempt, only an explicit provider not-found permits another
 * POST, using the identical reference. An outage never means "not initiated".
 */
export async function initiatePayout(id:string) {
  if(paymentMode()==='live'&&!env.ENABLE_LIVE_PAYMENTS)throw new ApiError(503,'live_payments_disabled');
  const lock=await db.connect();
  let acquired=false;
  try {
    acquired=(await lock.query<{locked:boolean}>('SELECT pg_try_advisory_lock(hashtext($1),hashtext($2)) AS locked',['paystack_initiation',id])).rows[0].locked;
    if(!acquired)return;
    const wd=(await lock.query<WithdrawalRow>(`SELECT w.*,p.recipient_code FROM withdrawals w JOIN payout_accounts p ON p.id=w.payout_account_id WHERE w.id=$1`,[id])).rows[0];
    if(!wd||wd.status!=='pending')return;
    if(wd.attempts>0) {
      try {await applyWithdrawalOutcome(wd.provider_reference,lock);return;}
      catch(error) {if(!isTransferNotFound(error))throw error;}
    }
    const claimed=await lock.query("UPDATE withdrawals SET attempts=attempts+1,failure_reason='transfer_initiation_uncertain',updated_at=now() WHERE id=$1 AND status='pending' RETURNING id",[id]);
    if(!claimed.rowCount)return;
    const result=await gateway.initiateTransfer({amountKobo:Number(wd.amount_kobo),recipientCode:wd.recipient_code,reference:wd.provider_reference,reason:`Rakky Ride payout ${id}`});
    // Never trust the initiation response to move ledger money. Provider verification
    // and webhooks may race this update; terminal records must not be overwritten.
    await lock.query("UPDATE withdrawals SET provider_transfer_code=COALESCE(provider_transfer_code,$2),updated_at=now() WHERE id=$1 AND status='pending'",[id,result.transferCode]);
    await applyWithdrawalOutcome(wd.provider_reference,lock);
  } catch(error) {
    if(error instanceof PaystackRequestError&&error.category==='access_denied')await lock.query("UPDATE withdrawals SET failure_reason='provider_transfer_access_denied',updated_at=now() WHERE id=$1 AND status IN ('pending','processing')",[id]);
    console.error('[payments] transfer requires reconciliation',{withdrawalId:id,category:error instanceof ApiError?error.code:'provider_unavailable'});
    throw error;
  } finally {
    try {if(acquired)await lock.query('SELECT pg_advisory_unlock(hashtext($1),hashtext($2))',['paystack_initiation',id]);}
    finally {lock.release();}
  }
}

/** Webhooks are notifications to verify, never authority to mark a payout paid. */
export async function applyWithdrawalOutcome(reference:string,connection?:PoolClient) {
  const work=async(client:PoolClient)=>{
    const wd=(await client.query<WithdrawalRow>(`SELECT w.*,p.recipient_code FROM withdrawals w JOIN payout_accounts p ON p.id=w.payout_account_id WHERE w.provider_reference=$1 FOR UPDATE OF w`,[reference])).rows[0];
    if(!wd)return {applied:false,status:'unknown_reference'};
    // Verify while holding the row lock so competing callbacks cannot apply an
    // older provider observation after a newer one.
    const verified=await gateway.verifyTransfer(reference);
    const amount=Number(wd.amount_kobo),fee=Number(wd.fee_kobo);
    const mismatch=verified.reference!==reference || verified.domain!==paymentMode() || verified.currency!=='NGN' || verified.amountKobo!==amount || verified.recipientCode!==wd.recipient_code || !verified.transferCode || (wd.provider_transfer_code!==null&&wd.provider_transfer_code!==verified.transferCode);
    const exception=async(code:string)=>{
      await client.query('UPDATE withdrawals SET failure_reason=$2,updated_at=now() WHERE id=$1',[wd.id,code]);
      return {applied:false,status:wd.status,exception:code};
    };
    if(mismatch)return exception('transfer_verification_mismatch');
    const outcome=verified.status;
    if(['pending','processing','queued','received','ongoing','otp','blocked'].includes(outcome)) {
      if(['success','failed','reversed'].includes(wd.status))return exception('transfer_terminal_conflict');
      await client.query("UPDATE withdrawals SET status='processing',provider_transfer_code=$2,failure_reason=$3,updated_at=now() WHERE id=$1",[wd.id,verified.transferCode,['otp','blocked'].includes(outcome)?`provider_transfer_${outcome}`:null]);
      return {applied:false,status:'processing'};
    }
    if(!['success','failed','reversed'].includes(outcome))return exception('transfer_status_unrecognized');
    if(wd.status===outcome)return {applied:false,status:outcome};
    if(wd.status==='failed'||wd.status==='reversed'||(wd.status==='success'&&outcome==='failed'))return exception('transfer_terminal_conflict');
    if(outcome==='success'&&(!Number.isSafeInteger(verified.feeKobo)||Number(verified.feeKobo)<0))return exception('transfer_fee_evidence_missing');
    const transit=await getSystemAccountId(client,'payout_in_transit');
    const gatewayAccount=await getSystemAccountId(client,'gateway_balance');
    let transactionId:string;
    if(outcome==='success') {
      ({transactionId}=await postTransaction(client,{type:'withdrawal_success',idempotencyKey:`withdrawal:${wd.id}:success`,referenceType:'withdrawal',referenceId:wd.id,
        metadata:{providerReference:reference,transferCode:verified.transferCode,providerDomain:verified.domain,feeKobo:verified.feeKobo},
        entries:[{accountId:transit,direction:'debit',amountKobo:amount},{accountId:gatewayAccount,direction:'credit',amountKobo:amount}]}));
      if(Number(verified.feeKobo)>0)await postTransaction(client,{type:'withdrawal_fee_expense',idempotencyKey:`withdrawal:${wd.id}:gateway_fee`,referenceType:'withdrawal',referenceId:wd.id,
        metadata:{feeBasis:'provider_verified',providerReference:reference},
        entries:[{accountId:await getSystemAccountId(client,'expense_gateway_fees'),direction:'debit',amountKobo:verified.feeKobo!},{accountId:gatewayAccount,direction:'credit',amountKobo:verified.feeKobo!}]});
    } else {
      // A driver's later suspension must not prevent return of reserved funds.
      const earnings=(await client.query<{id:string}>("SELECT id FROM ledger_accounts WHERE owner_user_id=$1 AND kind='driver_earnings'",[wd.user_id])).rows[0]?.id;
      if(!earnings)throw new ApiError(409,'withdrawal_earnings_evidence_missing');
      const source=wd.status==='success'?gatewayAccount:transit;
      const revenue=await getSystemAccountId(client,'revenue_fees');
      ({transactionId}=await postTransaction(client,{type:'withdrawal_reversal',idempotencyKey:`withdrawal:${wd.id}:reversal`,referenceType:'withdrawal',referenceId:wd.id,
        metadata:{providerReference:reference,transferCode:verified.transferCode,providerDomain:verified.domain},
        entries:[{accountId:source,direction:'debit',amountKobo:amount},...(fee>0?[{accountId:revenue,direction:'debit' as const,amountKobo:fee}]:[]),{accountId:earnings,direction:'credit',amountKobo:amount+fee}]}));
      // Provider fee refunds require their own statement evidence; do not invent one.
    }
    await client.query('UPDATE withdrawals SET status=$2,final_tx_id=$3,provider_transfer_code=$4,failure_reason=NULL,completed_at=now(),updated_at=now() WHERE id=$1',[wd.id,outcome,transactionId,verified.transferCode]);
    return {applied:true,status:outcome,userId:wd.user_id};
  };
  const onConnection=async(client:PoolClient)=>{
    await client.query('BEGIN');
    try{const value=await work(client);await client.query('COMMIT');return value;}
    catch(error){await client.query('ROLLBACK');throw error;}
  };
  // Initiation already owns a session advisory lock: reuse its connection rather
  // than consume a second pool slot and deadlock under concurrent payouts.
  const result=connection?await onConnection(connection):await inTransaction(work);
  if(result.applied&&'userId' in result&&result.userId)emitWalletUpdated(result.userId);
  if('exception' in result)throw new ApiError(409,result.exception);
  return result;
}
```

</details>

## src/modules/payments/webhook.service.ts

[Open source](../src/modules/payments/webhook.service.ts)

SHA-256: `65748b92154042c56789a78e3957c9cde13dbf03720a1d7f00e0df98cfa1e40d`

<details>
<summary>Full TypeScript implementation</summary>

```ts
import type { Request, Response } from 'express';
import { db } from '../../shared/config/db';
import { ApiError } from '../../shared/errors';
import { gateway, paymentMode } from './gateway';
import { applySuccessfulTopup } from './topups.service';
import { enqueueWebhook } from './paymentQueue';

interface PaystackEvent {event:string;data:{reference:string;domain:string;transfer_code?:string;id?:number}}
const supported=new Set(['charge.success','transfer.success','transfer.failed','transfer.reversed','charge.dispute.create']);
export async function receivePaystackWebhook(req:Request,res:Response) {
  const raw=req.body as Buffer;
  const header=typeof req.headers['x-paystack-signature']==='string'?req.headers['x-paystack-signature']:undefined;
  if(!Buffer.isBuffer(raw)||!gateway.verifyWebhookSignature(raw,header))return void res.sendStatus(401);
  let input:unknown;
  try {input=JSON.parse(raw.toString('utf8'));}catch{return void res.sendStatus(400);}
  if(!input||typeof input!=='object'||Array.isArray(input))return void res.sendStatus(400);
  const candidate=input as {event?:unknown;data?:unknown};
  if(typeof candidate.event!=='string'||candidate.event.length>60||!candidate.data||typeof candidate.data!=='object'||Array.isArray(candidate.data))return void res.sendStatus(400);
  if(!supported.has(candidate.event))return void res.sendStatus(200);
  const data=candidate.data as Record<string,unknown>;
  const transaction=data.transaction && typeof data.transaction==='object'?data.transaction as Record<string,unknown>:null;
  const reference=candidate.event==='charge.dispute.create'?transaction?.reference??data.reference:data.reference;
  const domain=data.domain??transaction?.domain;
  if(typeof reference!=='string'||!/^[-a-zA-Z0-9_.=]{1,80}$/.test(reference)||typeof domain!=='string'||domain!==paymentMode())return void res.sendStatus(400);
  // Retain only processing evidence, not customer/card/bank payloads.
  const event:PaystackEvent={event:candidate.event,data:{reference,domain}};
  if(typeof data.transfer_code==='string'&&data.transfer_code.length<=40)event.data.transfer_code=data.transfer_code;
  if(Number.isSafeInteger(data.id))event.data.id=Number(data.id);
  const key=`${event.event}:${reference}`;
  await db.query(`INSERT INTO payment_webhook_events(provider,dedupe_key,event_type,payload)
    VALUES('paystack',$1,$2,$3) ON CONFLICT(provider,dedupe_key) DO NOTHING`,[key,event.event,event]);
  // Acknowledge only durable receipt. Redis failure is repaired from PostgreSQL.
  res.sendStatus(200);
  void enqueueWebhook(key).catch(()=>console.error('[payments] webhook enqueue needs recovery',{eventType:event.event}));
}
export async function processWebhook(key:string) {
  const row=(await db.query<{id:string;event_type:string;payload:PaystackEvent;status:string}>('SELECT * FROM payment_webhook_events WHERE provider=$1 AND dedupe_key=$2',['paystack',key])).rows[0];
  if(!row||row.status==='processed'||row.status==='ignored')return;
  try {
    let status='processed';
    if(row.event_type==='charge.success'&&row.payload.data.reference) {
      const result=await applySuccessfulTopup(row.payload.data.reference);
      if(result.status==='unknown_reference')status='ignored';
      else if(result.status!=='succeeded')throw new ApiError(409,result.status==='mismatch'?'topup_verification_mismatch':'topup_not_successful_yet');
    } else if(['transfer.success','transfer.failed','transfer.reversed'].includes(row.event_type)&&row.payload.data.reference) {
      const {applyWithdrawalOutcome}=await import('./withdrawals.service.js');
      const result=await applyWithdrawalOutcome(row.payload.data.reference);
      if(result.status==='unknown_reference')status='ignored';
      else if(!['success','failed','reversed'].includes(result.status))throw new ApiError(409,'transfer_not_terminal_yet');
    } else if(row.event_type==='charge.dispute.create'&&row.payload.data.reference) {
      const intent=(await db.query<{user_id:string}>("SELECT user_id FROM payment_intents WHERE provider_reference=$1 AND status='succeeded'",[row.payload.data.reference])).rows[0];
      if(intent) {
        await db.query("UPDATE ledger_accounts SET is_frozen=true WHERE owner_user_id=$1 AND kind='user_wallet'",[intent.user_id]);
        console.error('[payments] dispute requires review',{reference:row.payload.data.reference});
      } else status='ignored';
    } else status='ignored';
    await db.query('UPDATE payment_webhook_events SET status=$2,processed_at=now(),error=NULL WHERE id=$1',[row.id,status]);
  } catch(error) {
    await db.query("UPDATE payment_webhook_events SET status='failed',error=$2 WHERE id=$1 AND status NOT IN ('processed','ignored')",[row.id,error instanceof ApiError?error.code:'processing_unavailable']);
    throw error;
  }
}
```

</details>

## src/modules/payments/ledger.service.ts

[Open source](../src/modules/payments/ledger.service.ts)

SHA-256: `798aeeb3bed1bcf2c59c8b4e8108e1d12d1dca86b50d94f4d3326c383fd2b6a8`

<details>
<summary>Full TypeScript implementation</summary>

```ts
import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { db } from '../../shared/config/db';
import { ApiError } from '../../shared/errors';

export type Direction = 'debit' | 'credit';
export interface LedgerEntryInput { accountId: string; direction: Direction; amountKobo: number }
export interface LedgerTransactionInput {
  type: string; idempotencyKey: string; referenceType?: string; referenceId?: string;
  description?: string; metadata?: Record<string, unknown>; createdBy?: string;
  entries: LedgerEntryInput[];
}
interface AccountRow { id: string; normal_side: Direction; balance_kobo: string; allow_negative: boolean; is_frozen: boolean }

export async function postTransaction(client: PoolClient, input: LedgerTransactionInput): Promise<{ transactionId: string; replayed: boolean }> {
  if (input.entries.length < 2) throw new ApiError(400, 'too_few_entries');
  let debit = 0, credit = 0;
  for (const entry of input.entries) {
    if (!Number.isSafeInteger(entry.amountKobo) || entry.amountKobo <= 0) throw new ApiError(400, 'bad_amount');
    if (entry.direction === 'debit') debit += entry.amountKobo;
    else if (entry.direction === 'credit') credit += entry.amountKobo;
    else throw new ApiError(400, 'bad_direction');
  }
  if (!Number.isSafeInteger(debit) || debit !== credit) throw new ApiError(400, 'unbalanced_ledger_transaction');
  const hash = createHash('sha256').update(JSON.stringify(input.entries.map((e) => [e.accountId, e.direction, e.amountKobo]))).digest('hex');
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO ledger_transactions(type,idempotency_key,request_hash,reference_type,reference_id,description,metadata,created_by)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(idempotency_key) DO NOTHING RETURNING id`,
    [input.type,input.idempotencyKey,hash,input.referenceType??null,input.referenceId??null,input.description??null,input.metadata??{},input.createdBy??null],
  );
  if (!inserted.rows[0]) {
    const previous = (await client.query<{id:string;request_hash:string}>('SELECT id,request_hash FROM ledger_transactions WHERE idempotency_key=$1',[input.idempotencyKey])).rows[0];
    if (!previous || previous.request_hash !== hash) throw new ApiError(409, 'idempotency_key_reused_with_different_data');
    return { transactionId: previous.id, replayed: true };
  }
  const transactionId = inserted.rows[0].id;
  const accountIds = [...new Set(input.entries.map((e) => e.accountId))].sort();
  const locked = await client.query<AccountRow>('SELECT id,normal_side,balance_kobo,allow_negative,is_frozen FROM ledger_accounts WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',[accountIds]);
  if (locked.rows.length !== accountIds.length) throw new ApiError(400, 'unknown_ledger_account');
  const accounts = new Map(locked.rows.map((row) => [row.id, { ...row, balance: Number(row.balance_kobo) }]));
  for (const entry of input.entries) {
    const account = accounts.get(entry.accountId)!;
    const delta = entry.direction === account.normal_side ? entry.amountKobo : -entry.amountKobo;
    if (delta < 0 && account.is_frozen) throw new ApiError(409, 'account_frozen');
    const next = account.balance + delta;
    if (!Number.isSafeInteger(next)) throw new ApiError(400, 'amount_out_of_range');
    if (next < 0 && !account.allow_negative) throw new ApiError(402, 'insufficient_funds');
    account.balance = next;
    await client.query('INSERT INTO ledger_entries(transaction_id,account_id,direction,amount_kobo,balance_after_kobo) VALUES($1,$2,$3,$4,$5)',[transactionId,entry.accountId,entry.direction,entry.amountKobo,next]);
  }
  for (const account of accounts.values()) await client.query('UPDATE ledger_accounts SET balance_kobo=$2,updated_at=now() WHERE id=$1',[account.id,account.balance]);
  return { transactionId, replayed: false };
}

export async function getSystemAccountId(client: PoolClient, code: string): Promise<string> {
  const row = (await client.query<{id:string}>('SELECT id FROM ledger_accounts WHERE code=$1 AND kind=$2',[code,'system'])).rows[0];
  if (!row) throw new Error(`missing system ledger account: ${code}`);
  return row.id;
}
export async function getOrCreateWalletAccount(client: PoolClient, userId: string): Promise<string> {
  await client.query(`INSERT INTO ledger_accounts(code,kind,type,normal_side,owner_user_id)
    VALUES($1,'user_wallet','liability','credit',$2) ON CONFLICT DO NOTHING`,[`user_wallet:${userId}`,userId]);
  const row = (await client.query<{id:string}>('SELECT id FROM ledger_accounts WHERE owner_user_id=$1 AND kind=$2',[userId,'user_wallet'])).rows[0];
  if (!row) throw new Error('wallet_account_creation_failed');
  return row.id;
}
export async function getOrCreateEarningsAccount(client: PoolClient, userId: string): Promise<string> {
  const approved = (await client.query('SELECT 1 FROM driver_profiles WHERE user_id=$1 AND status=$2',[userId,'approved'])).rowCount;
  if (!approved) throw new ApiError(403, 'driver_not_approved');
  await client.query(`INSERT INTO ledger_accounts(code,kind,type,normal_side,owner_user_id,allow_negative)
    VALUES($1,'driver_earnings','liability','credit',$2,true) ON CONFLICT DO NOTHING`,[`driver_earnings:${userId}`,userId]);
  const row = (await client.query<{id:string}>('SELECT id FROM ledger_accounts WHERE owner_user_id=$1 AND kind=$2',[userId,'driver_earnings'])).rows[0];
  if (!row) throw new Error('earnings_account_creation_failed');
  return row.id;
}
export async function getBalances(userId: string) {
  const { rows } = await db.query<{kind:string;balance_kobo:string}>(
    'SELECT kind,balance_kobo FROM ledger_accounts WHERE owner_user_id=$1',[userId]);
  const walletKobo = Number(rows.find((r) => r.kind === 'user_wallet')?.balance_kobo ?? 0);
  const earningsKobo = Number(rows.find((r) => r.kind === 'driver_earnings')?.balance_kobo ?? 0);
  const limit = Number((await db.query<{cash_debt_limit_kobo:string}>('SELECT cash_debt_limit_kobo FROM payment_settings WHERE id=true')).rows[0]?.cash_debt_limit_kobo ?? 0);
  return { walletKobo, earningsKobo, withdrawableKobo: Math.max(0,earningsKobo), owedKobo: Math.max(0,-earningsKobo), cashDebtLimitKobo: limit, canGoOnline: earningsKobo > -limit };
}

export async function assertDriverCanGoOnline(userId: string): Promise<void> {
  const balance = await getBalances(userId);
  if (!balance.canGoOnline) throw new ApiError(403, 'cash_debt_limit_exceeded', { owedKobo: balance.owedKobo });
}
```

</details>

## src/modules/payments/payoutAccounts.service.ts

[Open source](../src/modules/payments/payoutAccounts.service.ts)

SHA-256: `ecf1b46b8be7d8b79702bae62b387c5c60ddc4d78488f78ef3e58849752c4dcc`

<details>
<summary>Full TypeScript implementation</summary>

```ts
import { db, inTransaction } from '../../shared/config/db';
import { ensureRedis } from '../../shared/config/redis';
import { ApiError } from '../../shared/errors';
import { generateOtp, withVerifiedOtp } from '../auth/otp.service';
import { gateway } from './gateway';

async function approvedDriver(userId:string) {
  const user=(await db.query<{full_name:string;phone:string|null}>("SELECT u.full_name,u.phone FROM users u JOIN driver_profiles d ON d.user_id=u.id AND d.status='approved' WHERE u.id=$1 AND u.is_active=true",[userId])).rows[0];
  if (!user) throw new ApiError(403,'driver_not_approved');
  return user;
}
async function rateLimit(key:string,limit:number,seconds:number) {
  const redis=await ensureRedis();
  const count=await redis.incr(key);
  if (count===1) await redis.expire(key,seconds);
  if (count>limit) throw new ApiError(429,'rate_limited',{retryAfterSeconds:await redis.ttl(key)});
}
export async function sendStepUpOtp(userId:string,purpose:'withdrawal'|'payout_account') {
  const user=await approvedDriver(userId);
  if (!user.phone) throw new ApiError(400,'verified_phone_required');
  await inTransaction((client)=>generateOtp(user.phone!,purpose,client));
  return {sent:true};
}
export async function listPayoutAccounts(userId:string) {
  await approvedDriver(userId);
  const {rows}=await db.query('SELECT id,bank_code,bank_name,account_last4,account_name,created_at FROM payout_accounts WHERE user_id=$1 AND is_active=true ORDER BY created_at DESC',[userId]);
  return {accounts:rows};
}
export async function listBanksCached() {
  const redis=await ensureRedis();
  const cached=await redis.get('payments:banks:nigeria');
  if (cached) {
    const banks=JSON.parse(cached) as Array<{name:string;code:string}>;
    return [...new Map(banks.map((bank)=>[bank.code,bank])).values()];
  }
  const banks=await gateway.listBanks();
  await redis.set('payments:banks:nigeria',JSON.stringify(banks),'EX',86400);
  return banks;
}
export async function resolvePayoutAccount(userId:string,accountNumber:string,bankCode:string) {
  await approvedDriver(userId);
  if (!/^\d{10}$/.test(accountNumber)||!/^\d{3,10}$/.test(bankCode)) throw new ApiError(400,'invalid_bank_account');
  await rateLimit(`payments:resolve:${userId}`,10,3600);
  return gateway.resolveAccount({accountNumber,bankCode});
}
export async function addPayoutAccount(userId:string,input:{accountNumber:string;bankCode:string;otpCode:string}) {
  const user=await approvedDriver(userId);
  if (!user.phone||!/^\d{10}$/.test(input.accountNumber)||!/^\d{3,10}$/.test(input.bankCode)) throw new ApiError(400,'invalid_bank_account');
  const banks=await listBanksCached();
  const bank=banks.find((entry)=>entry.code===input.bankCode);
  if (!bank) throw new ApiError(400,'unknown_bank');
  const resolved=await gateway.resolveAccount({accountNumber:input.accountNumber,bankCode:input.bankCode});
  const mode=(await db.query<{payout_name_match:string}>('SELECT payout_name_match FROM payment_settings WHERE id=true')).rows[0]?.payout_name_match??'lenient';
  const ownTokens=user.full_name.toLowerCase().split(/\s+/).filter((token)=>token.length>1);
  const accountTokens=resolved.accountName.toLowerCase().split(/\s+/);
  const matches=mode==='off'||(mode==='strict'?ownTokens.every((token)=>accountTokens.includes(token)):ownTokens.some((token)=>accountTokens.includes(token)));
  if (!matches) throw new ApiError(409,'payout_name_mismatch');
  await withVerifiedOtp(user.phone,'payout_account',input.otpCode,async()=>undefined);
  const recipient=await gateway.createRecipient({name:resolved.accountName,accountNumber:input.accountNumber,bankCode:input.bankCode});
  const row=(await db.query('INSERT INTO payout_accounts(user_id,bank_code,bank_name,account_last4,account_name,recipient_code) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id,recipient_code) DO UPDATE SET is_active=true RETURNING id,bank_code,bank_name,account_last4,account_name,created_at',
    [userId,input.bankCode,bank.name,input.accountNumber.slice(-4),resolved.accountName,recipient.recipientCode])).rows[0];
  return {account:row};
}
export async function deactivatePayoutAccount(userId:string,id:string) {
  const result=await db.query('UPDATE payout_accounts SET is_active=false WHERE id=$1 AND user_id=$2 AND NOT EXISTS(SELECT 1 FROM withdrawals WHERE payout_account_id=$1 AND status IN(\'pending\',\'processing\')) RETURNING id',[id,userId]);
  if (!result.rowCount) throw new ApiError(409,'payout_account_not_found_or_in_use');
  return {success:true};
}
export { approvedDriver, rateLimit };
```

</details>

## src/config/env.ts

[Open source](../src/config/env.ts)

SHA-256: `b08bedad2b1a4722a7436101a7f6b33975de0ca71aad31a62558038448639f76`

<details>
<summary>Full TypeScript implementation</summary>

```ts
import dotenv from 'dotenv';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {isIP} from 'node:net';

dotenv.config();

// Local development historically kept the server key in mobile/.env. Read only
// that one non-public value as a fallback; never import its PORT or other secrets.
const legacyMobileEnvPath = resolve(process.cwd(), '../mobile/.env');
const legacyGoogleMapsKey = existsSync(legacyMobileEnvPath)
  ? dotenv.parse(readFileSync(legacyMobileEnvPath)).GOOGLE_MAPS_API_KEY
  : undefined;
const nodeEnv = process.env.NODE_ENV ?? 'development';
const paystackBaseUrl=process.env.PAYSTACK_BASE_URL??'https://api.paystack.co';
if((nodeEnv==='production'||process.env.PAYSTACK_SECRET_KEY?.startsWith('sk_live_'))&&paystackBaseUrl!=='https://api.paystack.co')throw new Error('Production/live Paystack credentials require the official API origin.');
const jwtAccessSecret = process.env.JWT_ACCESS_SECRET ?? process.env.JWT_SECRET ?? (nodeEnv === 'development' ? 'development-access-secret-change-me' : '');
if (!jwtAccessSecret) throw new Error('JWT_ACCESS_SECRET is required outside development.');
if(nodeEnv==='production' && (jwtAccessSecret.length<32 || jwtAccessSecret==='development-access-secret-change-me'))throw new Error('Production JWT_ACCESS_SECRET must be a strong, non-development secret.');
const authRateLimit=Number(process.env.AUTH_RATE_LIMIT_PER_MINUTE??300);
if(!Number.isSafeInteger(authRateLimit)||authRateLimit<1)throw new Error('AUTH_RATE_LIMIT_PER_MINUTE must be a positive integer.');
const trustedProxyCidrs=(process.env.TRUSTED_PROXY_CIDRS??'').split(',').map(value=>value.trim()).filter(Boolean);
for(const cidr of trustedProxyCidrs){const parts=cidr.split('/'),bits=isIP(parts[0]);if(!bits||parts.length>2||(parts.length===2&&(!/^\d+$/.test(parts[1])||Number(parts[1])<1||Number(parts[1])>(bits===4?32:128))))throw new Error('TRUSTED_PROXY_CIDRS requires exact IPs or non-wildcard CIDR ranges.');}
const tripQuoteTtlSeconds = Number(process.env.TRIP_QUOTE_TTL_SECONDS ?? 900);
if (!Number.isSafeInteger(tripQuoteTtlSeconds) || tripQuoteTtlSeconds <= 0) {
  throw new Error('TRIP_QUOTE_TTL_SECONDS must be a positive integer.');
}
const numberList = (value: string | undefined, fallback: number[]) => {
  const parsed = (value ?? '').split(',').map(Number).filter((item) => Number.isFinite(item) && item > 0);
  return parsed.length ? parsed : fallback;
};

/**
 * Centralised, typed access to environment variables.
 * Add new config here so the rest of the app never touches process.env directly.
 */
export const env = {
  PORT: Number(process.env.PORT) || 4000,
  NODE_ENV: nodeEnv,
  DATABASE_URL: process.env.DATABASE_URL ?? '',
  REDIS_URL: process.env.REDIS_URL ?? '',
  GOOGLE_MAPS_API_KEY: process.env.GOOGLE_MAPS_SERVER_KEY ?? process.env.GOOGLE_MAPS_API_KEY ?? legacyGoogleMapsKey ?? '',
  FARE_BASE_NGN: Number(process.env.FARE_BASE_NGN) || 800,
  FARE_PER_KM_NGN: Number(process.env.FARE_PER_KM_NGN) || 250,
  FARE_PER_MINUTE_NGN: Number(process.env.FARE_PER_MINUTE_NGN) || 35,
  JWT_ACCESS_SECRET: jwtAccessSecret,
  JWT_ACCESS_EXPIRY: process.env.JWT_ACCESS_EXPIRY ?? '15m',
  REFRESH_TOKEN_EXPIRY_DAYS: Number(process.env.REFRESH_TOKEN_EXPIRY_DAYS) || 30,
  TERMII_API_KEY: process.env.TERMII_API_KEY ?? '',
  TERMII_SENDER_ID: process.env.TERMII_SENDER_ID ?? 'RakkyRide',
  GOOGLE_CLIENT_ID_IOS: process.env.GOOGLE_CLIENT_ID_IOS ?? '',
  GOOGLE_CLIENT_ID_ANDROID: process.env.GOOGLE_CLIENT_ID_ANDROID ?? '',
  GOOGLE_CLIENT_ID_WEB: process.env.GOOGLE_CLIENT_ID_WEB ?? '',
  OTP_RATE_LIMIT_MAX: Number(process.env.OTP_RATE_LIMIT_MAX) || 3,
  OTP_RATE_LIMIT_WINDOW_MINUTES: Number(process.env.OTP_RATE_LIMIT_WINDOW_MINUTES) || 15,
  OTP_RESEND_COOLDOWN_SECONDS: Number(process.env.OTP_RESEND_COOLDOWN_SECONDS) || 60,
  AUTH_RATE_LIMIT_PER_MINUTE:authRateLimit,
  TRUSTED_PROXY_CIDRS:trustedProxyCidrs,
  DISPATCH_RADIUS_STEPS_M: numberList(process.env.DISPATCH_RADIUS_STEPS_M, [3000, 5000, 8000]),
  OFFER_TIMEOUT_SECONDS: Number(process.env.OFFER_TIMEOUT_SECONDS) || 15,
  SEARCH_TIMEOUT_SECONDS: Number(process.env.SEARCH_TIMEOUT_SECONDS) || 120,
  MAX_OFFERS_PER_TRIP: Number(process.env.MAX_OFFERS_PER_TRIP) || 6,
  DRIVER_LOCATION_EMIT_MS: Number(process.env.DRIVER_LOCATION_EMIT_MS) || 4000,
  BREADCRUMB_SAMPLE_SECONDS: Number(process.env.BREADCRUMB_SAMPLE_SECONDS) || 15,
  ETA_REFRESH_SECONDS: Number(process.env.ETA_REFRESH_SECONDS) || 45,
  CASH_DEBT_LIMIT_KOBO: Number(process.env.CASH_DEBT_LIMIT_KOBO) || 500000,
  ENABLE_ADMIN_MONEY_ACTIONS: process.env.ENABLE_ADMIN_MONEY_ACTIONS === 'true',
  ENABLE_LIVE_PAYMENTS: process.env.ENABLE_LIVE_PAYMENTS === 'true',
  PAYSTACK_SECRET_KEY: process.env.PAYSTACK_SECRET_KEY ?? '',
  PAYSTACK_BASE_URL: paystackBaseUrl,
  PAYMENT_CALLBACK_URL: process.env.PAYMENT_CALLBACK_URL ?? '',
  PAYMENT_SYNTHETIC_EMAIL_DOMAIN: process.env.PAYMENT_SYNTHETIC_EMAIL_DOMAIN ?? '',
  ALERT_WEBHOOK_URL: process.env.ALERT_WEBHOOK_URL ?? '',
  TRIP_ESTIMATE_RATE_LIMIT_PER_MIN: Number(process.env.TRIP_ESTIMATE_RATE_LIMIT_PER_MIN) || 20,
  TRIP_QUOTE_TTL_SECONDS: tripQuoteTtlSeconds,
  TRIP_QUEUE_PREFIX: process.env.TRIP_QUEUE_PREFIX ?? 'bull',
} as const;
```

</details>

## src/shared/utils/adminQuery.ts

[Open source](../src/shared/utils/adminQuery.ts)

SHA-256: `83ba8ee94d8f16c2a229d2f1bd31bb175072aad82c7b3b3fc04501640f92aee2`

<details>
<summary>Full TypeScript implementation</summary>

```ts
import { ApiError } from "../errors";
export interface AdminQuery {
  page?: number | null;
  limit: number;
  cursor: { at: string; id: string } | null;
  status: string | null;
  service: string | null;
  mode: string | null;
  id: string | null;
}
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function adminId(value: unknown): string {
  if (typeof value !== "string" || !uuidPattern.test(value))
    throw new ApiError(400, "invalid_id");
  return value;
}
export function adminQuery(
  input: Record<string, unknown>,
  statuses: readonly string[] = [],
  modes: readonly string[] = [],
): AdminQuery {
  for (const key of Object.keys(input))
    if (
      !["page", "limit", "cursor", "status", "service", "mode", "id"].includes(
        key,
      )
    )
      throw new ApiError(400, "unsupported_filter");
  const text = (name: string) => {
    const value = input[name];
    if (value === undefined || value === "") return null;
    if (typeof value !== "string") throw new ApiError(400, "invalid_filter");
    return value;
  };
  const size = text("limit");
  if (size && !/^\d+$/.test(size)) throw new ApiError(400, "invalid_limit");
  const page = adminPageNumber(input.page);
  const limit = size ? Number(size) : page === null ? 50 : 20;
  if (limit < 1 || limit > 100) throw new ApiError(400, "invalid_limit");
  const status = text("status"),
    service = text("service"),
    mode = text("mode"),
    id = text("id");
  if (
    (status && !statuses.includes(status)) ||
    (service && !["ride", "courier"].includes(service)) ||
    (mode && !modes.includes(mode))
  )
    throw new ApiError(400, "invalid_filter");
  let cursor: AdminQuery["cursor"] = null;
  const encoded = text("cursor");
  if (page !== null && encoded)
    throw new ApiError(400, "page_and_cursor_are_exclusive");
  if (encoded) {
    try {
      if (encoded.length > 512) throw new Error();
      const decoded: unknown = JSON.parse(
        Buffer.from(encoded, "base64url").toString(),
      );
      if (
        !decoded ||
        typeof decoded !== "object" ||
        !("at" in decoded) ||
        !("id" in decoded) ||
        typeof decoded.at !== "string" ||
        !Number.isFinite(Date.parse(decoded.at)) ||
        typeof decoded.id !== "string" ||
        !uuidPattern.test(decoded.id)
      )
        throw new Error();
      cursor = { at: decoded.at, id: decoded.id };
    } catch {
      throw new ApiError(400, "invalid_cursor");
    }
  }
  return {
    page,
    limit,
    cursor,
    status,
    service,
    mode,
    id: id ? adminId(id) : null,
  };
}
export function adminPage<T extends { id: string; _cursor: string }>(
  rows: T[],
  query: AdminQuery,
  dateBasis: string,
  paging?: {
    total?: number;
    pagination?: import("./adminPagination").AdminPagination;
  },
) {
  const hasMore = rows.length > query.limit;
  const visible = rows.slice(0, query.limit);
  const last = visible.at(-1);
  return {
    items: visible.map(({ _cursor, ...row }) => row),
    nextCursor:
      hasMore && last
        ? Buffer.from(
            JSON.stringify({ at: last._cursor, id: last.id }),
          ).toString("base64url")
        : null,
    asOf: new Date().toISOString(),
    scope: {
      dateBasis,
      status: query.status,
      service: query.service,
      mode: query.mode,
    },
    pagination: paging?.pagination,
    count: {
      value: paging?.total ?? visible.length,
      exact: paging?.total !== undefined || (!hasMore && !query.cursor),
    },
  };
}
export function maskedPhone(value: string | null): string {
  return value ? `••• ${value.slice(-4)}` : "Not supplied";
}
export function maskedEmail(value: string | null): string {
  return value ? `${value.slice(0, 1)}•••@•••` : "Not supplied";
}

export function entryPageQuery(input: Record<string, unknown>): {
  page: number | null;
  before: string | null;
  limit: number;
} {
  for (const key of Object.keys(input))
    if (!["page", "before", "limit"].includes(key))
      throw new ApiError(400, "unsupported_filter");
  const before = input.before === undefined ? null : input.before;
  if (
    before !== null &&
    (typeof before !== "string" ||
      !/^\d+$/.test(before) ||
      BigInt(before) <= 0n ||
      BigInt(before) > 9223372036854775807n)
  )
    throw new ApiError(400, "invalid_cursor");
  const page = adminPageNumber(input.page);
  if (page !== null && before !== null)
    throw new ApiError(400, "page_and_cursor_are_exclusive");
  const limit =
    input.limit === undefined ? (page === null ? 50 : 20) : Number(input.limit);
  if (
    (input.limit !== undefined &&
      (typeof input.limit !== "string" || !/^\d+$/.test(input.limit))) ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100
  )
    throw new ApiError(400, "invalid_limit");
  return { page, before: before as string | null, limit };
}
export function adminPageNumber(value: unknown): number | null {
  if (value === undefined) return null;
  if (typeof value !== "string" || !/^[1-9]\d{0,5}$/.test(value))
    throw new ApiError(400, "invalid_page");
  return Number(value);
}
```

</details>

## src/shared/utils/adminPagination.ts

[Open source](../src/shared/utils/adminPagination.ts)

SHA-256: `561171a8606c1816e35f0f991a64ca6dee4a554387e1776b43f5e242c8bef77a`

<details>
<summary>Full TypeScript implementation</summary>

```ts
import type { QueryResultRow } from "pg";
import { db, inTransaction } from "../config/db";
import { ApiError } from "../errors";

export interface AdminPagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  from: number;
  to: number;
  hasPrevious: boolean;
  hasNext: boolean;
}
export interface AdminPagingResult {
  total?: number;
  pagination?: AdminPagination;
}
export function paginationMeta(
  page: number,
  pageSize: number,
  total: number,
): AdminPagination {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(page, totalPages);
  return {
    page: current,
    pageSize,
    total,
    totalPages,
    from: total ? (current - 1) * pageSize + 1 : 0,
    to: Math.min(current * pageSize, total),
    hasPrevious: current > 1,
    hasNext: current < totalPages,
  };
}
/** SQL identifiers/order expressions come from fixed domain definitions, never request text. */
export async function readAdminRows<T extends QueryResultRow = QueryResultRow>(
  sql: { select: string; orderBy: string; limitParameter: number },
  values: unknown[],
  query: { page?: number | null; limit: number },
): Promise<{ rows: T[] } & AdminPagingResult> {
  const limit = `$${sql.limitParameter}`;
  if (query.page == null)
    return {
      rows: (
        await db.query<T>(
          `${sql.select} ORDER BY ${sql.orderBy} LIMIT ${limit}`,
          values,
        )
      ).rows,
    };
  try {
    return await inTransaction(async (client) => {
      await client.query(
        "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY",
      );
      await client.query("SET LOCAL statement_timeout = '5000ms'");
      // The limit placeholder is explicitly typed even when it is between filter parameters.
      const counted = await client.query<{ total: string }>(
        `SELECT COUNT(*)::text AS total FROM (${sql.select}) matching WHERE ${limit}::int >= 1`,
        values,
      );
      const total = Number(counted.rows[0].total);
      if (!Number.isSafeInteger(total) || total < 0)
        throw new ApiError(503, "pagination_count_unavailable");
      const pagination = paginationMeta(query.page!, query.limit, total);
      const pageValues = [...values, (pagination.page - 1) * query.limit];
      pageValues[sql.limitParameter - 1] = query.limit;
      const rows = (
        await client.query<T>(
          `${sql.select} ORDER BY ${sql.orderBy} LIMIT ${limit} OFFSET $${pageValues.length}`,
          pageValues,
        )
      ).rows;
      return { rows, total, pagination };
    });
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "57014"
    )
      throw new ApiError(503, "pagination_unavailable");
    throw error;
  }
}
```

</details>

## src/shared/utils/adminAudit.ts

[Open source](../src/shared/utils/adminAudit.ts)

SHA-256: `9d4149ec951820612a3303a06afa80cabcb79597f45b8125102668acfee15986`

<details>
<summary>Full TypeScript implementation</summary>

```ts
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { ApiError } from "../errors";
import { adminId } from "./adminQuery";

export function auditInput(
  reason: unknown,
  requestKey: unknown,
): { reason: string; requestKey: string } {
  if (
    typeof reason !== "string" ||
    reason.trim().length < 5 ||
    reason.trim().length > 1000
  )
    throw new ApiError(400, "meaningful_reason_required");
  return { reason: reason.trim(), requestKey: adminId(requestKey) };
}
/** Locks a persistent staff row, so requests using one staff key cannot interleave across instances. */
export async function replayAdminOperation(
  client: PoolClient,
  actorId: string,
  action: string,
  requestKey: string,
  input: object,
  roles: readonly string[] = ["admin", "super_admin"],
): Promise<{
  hash: string;
  role: string;
  previous: { id: string; transactionId: string | null } | null;
}> {
  const staff = await client.query<{ role: string }>(
    "SELECT role FROM users WHERE id=$1 AND is_active=true FOR UPDATE",
    [actorId],
  );
  if (!staff.rows[0] || !roles.includes(staff.rows[0].role))
    throw new ApiError(403, "insufficient_permissions");
  const hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const { rows } = await client.query<{
    id: string;
    action: string;
    hash: string | null;
    transactionId: string | null;
  }>(
    `SELECT id::text,action,metadata->>'operationHash' AS hash,ledger_transaction_id AS "transactionId" FROM admin_audit_log WHERE actor_id=$1 AND request_key=$2 ORDER BY id LIMIT 1`,
    [actorId, requestKey],
  );
  if (rows[0] && (rows[0].action !== action || rows[0].hash !== hash))
    throw new ApiError(409, "idempotency_key_reused_with_different_data");
  return { hash, role: staff.rows[0].role, previous: rows[0] ?? null };
}

/** Record an authorized sensitive read before returning data. Never store document bytes or live positions. */
export async function recordAdminRead(
  actorId: string,
  action: string,
  objectType: string,
  objectId: string | null = null,
  metadata: object = {},
) {
  const { db } = await import("../config/db.js");
  await db.query(
    "INSERT INTO admin_audit_log(actor_id,action,reason,object_type,object_id,metadata) VALUES($1,$2,$3,$4,$5,$6)",
    [
      actorId,
      action,
      "Authorized staff data inspection",
      objectType,
      objectId,
      metadata,
    ],
  );
}

const visibleAuditFields = new Set(["name","active","role","version","status","state","assigneeId","priority","severity","scheduledAt","scheduled_at","vehicleType","vehicle_type","baseFareKobo","base_fare_kobo","perKmKobo","per_km_kobo","perMinuteKobo","per_min_kobo","minimumFareKobo","min_fare_kobo","commissionBps","commission_bps","is_active","minTopupKobo","maxTopupKobo","minWithdrawalKobo","maxDailyWithdrawalKobo","withdrawalFeeKobo","cashDebtLimitKobo","payoutNameMatch","newPayoutAccountCooldownHours","paystackBalanceAlertKobo","adminAdjustmentApprovalKobo","min_topup_kobo","max_topup_kobo","min_withdrawal_kobo","max_daily_withdrawal_kobo","withdrawal_fee_kobo","cash_debt_limit_kobo","payout_name_match","new_payout_account_cooldown_hours","paystack_balance_alert_kobo","admin_adjustment_approval_kobo"]);
export function visibleAuditChanges(metadata: unknown) {
  const clean = (value: unknown): Record<string,string|number|boolean|null> | null => {
    if(!value || typeof value!=="object" || Array.isArray(value)) return null;
    return Object.fromEntries(Object.entries(value).filter(([key,v])=>visibleAuditFields.has(key) && (v===null || ["string","number","boolean"].includes(typeof v))));
  };
  if(!metadata || typeof metadata!=="object") return {before:null,after:null};
  const value=metadata as Record<string,unknown>;
  return {before:clean(value.before),after:clean(value.after)};
}
```

</details>

## src/shared/utils/adminSearch.ts

[Open source](../src/shared/utils/adminSearch.ts)

SHA-256: `dcea4a68a2bba2501b19c0cf14a175dd0bba09ff64aef73836c9f5e29b3a1132`

<details>
<summary>Full TypeScript implementation</summary>

```ts
import { createHash } from "node:crypto";
import type { QueryResultRow } from "pg";
import { inTransaction } from "../config/db";
import { ApiError } from "../errors";
import { adminId } from "./adminQuery";

export const searchScopes = [
  "all",
  "people",
  "trips",
  "finance",
  "support",
  "safety",
] as const;
export type SearchScope = (typeof searchScopes)[number];
/** Bound database execution time as well as the number of returned records. */
export async function staffSearchRows<T extends QueryResultRow>(
  sql: string,
  values: unknown[],
): Promise<T[]> {
  try {
    return await inTransaction(async (client) => {
      await client.query("SET LOCAL statement_timeout = '3000ms'");
      return (await client.query<T>(sql, values)).rows;
    });
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "57014"
    )
      throw new ApiError(503, "staff_search_timed_out");
    throw error;
  }
}
export interface StaffSearchHit {
  id: string;
  type:
    | "person"
    | "trip"
    | "payment"
    | "withdrawal"
    | "account"
    | "support"
    | "safety";
  title: string;
  subtitle: string;
  href: string;
}
export interface SearchRead {
  query: string;
  prefix: string;
  scope: SearchScope;
  after: { id: string; type: StaffSearchHit["type"] } | null;
  limit: number;
}
const types: Record<
  Exclude<SearchScope, "all">,
  readonly StaffSearchHit["type"][]
> = {
  people: ["person"],
  trips: ["trip"],
  finance: ["payment", "withdrawal", "account"],
  support: ["support"],
  safety: ["safety"],
};
const context = (query: string, scope: string) =>
  createHash("sha256")
    .update(query + "\0" + scope)
    .digest("hex");
export function parseStaffSearch(body: unknown): SearchRead {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new ApiError(400, "invalid_search");
  const input = body as Record<string, unknown>;
  if (
    Object.keys(input).some(
      (key) => !["query", "scope", "cursor"].includes(key),
    )
  )
    throw new ApiError(400, "unsupported_search_field");
  if (typeof input.query !== "string")
    throw new ApiError(400, "invalid_search");
  const query = input.query.trim();
  if (query.length < 3 || query.length > 80 || /[\x00-\x1f\x7f]/.test(query))
    throw new ApiError(400, "search_requires_3_to_80_characters");
  const scope = input.scope ?? "all";
  if (typeof scope !== "string" || !searchScopes.includes(scope as SearchScope))
    throw new ApiError(400, "invalid_search_scope");
  let after: SearchRead["after"] = null;
  if (
    input.cursor !== undefined &&
    input.cursor !== null &&
    input.cursor !== ""
  ) {
    try {
      if (
        scope === "all" ||
        typeof input.cursor !== "string" ||
        input.cursor.length > 512
      )
        throw new Error();
      const decoded: unknown = JSON.parse(
        Buffer.from(input.cursor, "base64url").toString(),
      );
      if (
        !decoded ||
        typeof decoded !== "object" ||
        !("id" in decoded) ||
        !("type" in decoded) ||
        !("context" in decoded) ||
        decoded.context !== context(query, scope) ||
        typeof decoded.type !== "string" ||
        !types[scope as Exclude<SearchScope, "all">].includes(
          decoded.type as StaffSearchHit["type"],
        )
      )
        throw new Error();
      after = {
        id: adminId(decoded.id),
        type: decoded.type as StaffSearchHit["type"],
      };
    } catch {
      throw new ApiError(400, "invalid_search_cursor");
    }
  }
  return {
    query,
    prefix:
      query
        .toLowerCase()
        .replaceAll("!", "!!")
        .replaceAll("%", "!%")
        .replaceAll("_", "!_") + "%",
    scope: scope as SearchScope,
    after,
    limit: scope === "all" ? 5 : 20,
  };
}
export function staffSearchPage(
  scope: Exclude<SearchScope, "all">,
  label: string,
  rows: StaffSearchHit[],
  query: SearchRead,
) {
  const items = rows.slice(0, query.limit),
    last = items.at(-1),
    hasMore = rows.length > query.limit;
  return {
    scope,
    label,
    items,
    hasMore,
    nextCursor:
      hasMore && last
        ? Buffer.from(
            JSON.stringify({
              id: last.id,
              type: last.type,
              context: context(query.query, scope),
            }),
          ).toString("base64url")
        : null,
  };
}
```

</details>

## src/shared/errors.ts

[Open source](../src/shared/errors.ts)

SHA-256: `86b7d3bfafc52c6a22a06ab633a6360180ca2c907a9332a5d65a3fd139dbc088`

<details>
<summary>Full TypeScript implementation</summary>

```ts
export class ApiError extends Error {
  constructor(public status: number, public code: string, public details?: Record<string, unknown>) {
    super(code);
    this.name = 'ApiError';
  }
}
```

</details>
