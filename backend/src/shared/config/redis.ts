import Redis from 'ioredis';
import { env } from '../../config/env';

export const redis = env.REDIS_URL
  ? new Redis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 })
  : null;

export async function ensureRedis() {
  if (!redis) throw new Error('Redis is not configured');
  if (redis.status === 'wait') await redis.connect();
  return redis;
}
