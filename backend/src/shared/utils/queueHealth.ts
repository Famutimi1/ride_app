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
