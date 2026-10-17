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
