import IORedis from 'ioredis';
import { Queue, Worker } from 'bullmq';
import { env } from '../../config/env';
import { dispatchNext, expireOffer, expireSearch, logStaleTrips } from './dispatch.service';

const connection = env.REDIS_URL ? new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null }) : null;
const options = connection ? { connection } : null;
const dispatchQueue = options ? new Queue('trip-dispatch', options) : null;
const offerTimeoutQueue = options ? new Queue('trip-offer-timeout', options) : null;
const searchExpiryQueue = options ? new Queue('trip-search-expiry', options) : null;
const maintenanceQueue = options ? new Queue('trip-maintenance', options) : null;
let started = false;

export async function enqueueDispatch(tripId: string, radiusIndex = 0, delay = 0) {
  if (!dispatchQueue) throw new Error('Redis is required for trip dispatch');
  await dispatchQueue.add('dispatch', { tripId, radiusIndex }, { delay, jobId: `dispatch-${tripId}-${Date.now()}-${radiusIndex}`, removeOnComplete: 100, removeOnFail: 100 });
}

export async function enqueueOfferTimeout(tripId: string, driverId: string, delay: number) {
  if (!offerTimeoutQueue) throw new Error('Redis is required for trip dispatch');
  await offerTimeoutQueue.add('offer-timeout', { tripId, driverId }, { delay, jobId: `offer-${tripId}-${driverId}`, removeOnComplete: true, removeOnFail: 100 });
}

export async function enqueueSearchExpiry(tripId: string) {
  if (!searchExpiryQueue) throw new Error('Redis is required for trip dispatch');
  await searchExpiryQueue.add('search-expiry', { tripId }, { delay: env.SEARCH_TIMEOUT_SECONDS * 1000, jobId: `search-${tripId}`, removeOnComplete: true, removeOnFail: 100 });
}

export async function removeTripJobs(tripId: string, driverId?: string) {
  await Promise.all([
    searchExpiryQueue?.getJob(`search-${tripId}`).then((job) => job?.remove()),
    driverId ? offerTimeoutQueue?.getJob(`offer-${tripId}-${driverId}`).then((job) => job?.remove()) : undefined,
  ]);
}

export async function startTripWorkers() {
  if (!connection || started) return;
  started = true;
  const workerOptions = { connection };
  const dispatchWorker = new Worker('trip-dispatch', async (job) => {
    const result = await dispatchNext(job.data.tripId as string, Number(job.data.radiusIndex) || 0);
    if (result.kind === 'expand') await enqueueDispatch(job.data.tripId as string, result.radiusIndex, 250);
    if (result.kind === 'offered') await enqueueOfferTimeout(job.data.tripId as string, result.driverId, env.OFFER_TIMEOUT_SECONDS * 1000);
  }, workerOptions);
  const offerWorker = new Worker('trip-offer-timeout', async (job) => {
    if (await expireOffer(job.data.tripId as string, job.data.driverId as string)) await enqueueDispatch(job.data.tripId as string);
  }, workerOptions);
  const searchWorker = new Worker('trip-search-expiry', (job) => expireSearch(job.data.tripId as string), workerOptions);
  const maintenanceWorker = new Worker('trip-maintenance', () => logStaleTrips(), workerOptions);
  for (const worker of [dispatchWorker, offerWorker, searchWorker, maintenanceWorker]) {
    worker.on('error', (error) => console.error('[trips] queue worker error', error.message));
  }
  await maintenanceQueue?.upsertJobScheduler('stale-trip-reaper', { every: 5 * 60 * 1000 }, { name: 'stale-trip-reaper' });
}
