import { startMediaWorkers,stopMediaWorkers } from './modules/auth/mediaQueue';
import { createServer } from 'node:http';
import type { Server as SocketServer } from 'socket.io';
import { createApp } from './app';
import { env } from './config/env';
import { attachWebsocket } from './websocket';
import { registerTripSocketServer } from './modules/trips/tripSocket';
import { startTripWorkers, stopTripWorkers } from './modules/trips/tripQueue';
import { startPaymentWorkers, stopPaymentWorkers } from './modules/payments/paymentQueue';
import { startNotificationWorkers, stopNotificationWorkers } from './modules/notifications/notificationQueue';
import { startEmailWorkers, stopEmailWorkers } from './modules/notifications/emailQueue';
import { setServerReadiness } from './modules/auth/admin.service';
import { db } from './shared/config/db';
import { redis } from './shared/config/redis';
import { startCommunicationWorkers, stopCommunicationWorkers } from './modules/communication/communicationQueue';

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
    await Promise.all([closed, stopTripWorkers(), stopPaymentWorkers(), stopNotificationWorkers(), stopEmailWorkers(),stopMediaWorkers(),stopCommunicationWorkers()]);
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
  const workers=await Promise.allSettled([startTripWorkers(), startPaymentWorkers(), startNotificationWorkers(), startEmailWorkers(),startMediaWorkers(),startCommunicationWorkers()]);
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
