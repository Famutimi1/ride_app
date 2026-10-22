import IORedis from 'ioredis';
import { Queue, Worker } from 'bullmq';
import { env } from '../../config/env';
import { mediaConfigured } from '../../shared/utils/cloudinary';
import { observeWorker } from '../../shared/utils/queueHealth';
import { reconcileMedia } from './media.service';
let connection: IORedis | null = null, queue: Queue | null = null, worker: Worker | null = null;
export async function startMediaWorkers() {
    if (worker || !mediaConfigured())
        return;
    connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
    queue = new Queue('media-cleanup', { connection, prefix: env.TRIP_QUEUE_PREFIX });
    worker = new Worker('media-cleanup', async () => reconcileMedia(), { connection, prefix: env.TRIP_QUEUE_PREFIX, concurrency: 1 });
    observeWorker(queue, worker, connection);
    worker.on('error', () => console.error('[media] cleanup worker unavailable'));
    await worker.waitUntilReady();
    await queue.upsertJobScheduler('media-reconciliation', { every: 60000 }, { name: 'reconcile', opts: { attempts: 3, backoff: { type: 'exponential', delay: 30000 }, removeOnComplete: true, removeOnFail: 20 } });
}
export async function stopMediaWorkers() { await worker?.close(); worker = null; await queue?.close(); queue = null; await connection?.quit(); connection = null; }
