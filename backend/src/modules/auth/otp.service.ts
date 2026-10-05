import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import type { PoolClient } from 'pg';
import { env } from '../../config/env';
import { ensureRedis } from '../../shared/config/redis';
import { ApiError } from '../../shared/errors';
import type { OtpPurpose } from './auth.types';
import type { OtpProvider } from './otp.provider.interface';
import { TermiiOtpProvider } from './otp.provider.termii';

const provider: OtpProvider = new TermiiOtpProvider();
const digest = (value: string) => createHash('sha256').update(value).digest();

async function enforceRateLimit(phone: string) {
  const redis = await ensureRedis();
  const cooldownKey = `otp:cooldown:${phone}`;
  const cooldown = await redis.ttl(cooldownKey);
  if (cooldown > 0) throw new ApiError(429, 'otp_cooldown', { retryAfterSeconds: cooldown });
  const rateKey = `otp:rate:${phone}`;
  const count = await redis.incr(rateKey);
  if (count === 1) await redis.expire(rateKey, env.OTP_RATE_LIMIT_WINDOW_MINUTES * 60);
  if (count > env.OTP_RATE_LIMIT_MAX) throw new ApiError(429, 'otp_rate_limited', { retryAfterSeconds: await redis.ttl(rateKey) });
  await redis.set(cooldownKey, '1', 'EX', env.OTP_RESEND_COOLDOWN_SECONDS);
}

export async function generateOtp(phone: string, purpose: OtpPurpose, client: PoolClient) {
  await enforceRateLimit(phone);
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await client.query(`INSERT INTO otp_codes (phone, code_hash, purpose, expires_at) VALUES ($1,$2,$3,now() + interval '5 minutes')`, [phone, digest(code).toString('hex'), purpose]);
  await provider.send(phone, code);
}

export async function verifyOtp(phone: string, purpose: OtpPurpose, submitted: string, client: PoolClient) {
  const { rows } = await client.query(`SELECT * FROM otp_codes WHERE phone=$1 AND purpose=$2 AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1 FOR UPDATE`, [phone, purpose]);
  const record = rows[0];
  if (!record) throw new ApiError(400, 'otp_not_found');
  if (record.attempts >= record.max_attempts) throw new ApiError(429, 'otp_attempts_exceeded');
  await client.query('UPDATE otp_codes SET attempts=attempts+1 WHERE id=$1', [record.id]);
  if (new Date(record.expires_at).getTime() <= Date.now()) throw new ApiError(400, 'otp_expired');
  const expected = Buffer.from(record.code_hash, 'hex');
  const actual = digest(submitted);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new ApiError(400, 'otp_invalid');
  await client.query('UPDATE otp_codes SET consumed_at=now() WHERE id=$1', [record.id]);
}
