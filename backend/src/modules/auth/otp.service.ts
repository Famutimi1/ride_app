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

// Staff and customer logins share the login purpose; role checks still happen
// when issuing the session. Step-up verification never accepts the shared code.
const allowsTestOtp = (purpose: OtpPurpose): boolean =>
  env.TEST_OTP_ENABLED && (purpose === 'registration' || purpose === 'login');

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
  if (allowsTestOtp(purpose)) {
    // Explicit internal testing mode works with NODE_ENV=production and no SMS
    // provider. Keep the random code available as an alternative for testers.
    console.info(`[auth] Internal-test OTP for ${phone.slice(0, 7)}****: ${code}`);
  } else {
    await provider.send(phone, code);
  }
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
  const matchesGenerated = expected.length === actual.length && timingSafeEqual(expected, actual);
  const matchesTest = allowsTestOtp(purpose) && timingSafeEqual(digest(env.TEST_OTP_CODE), actual);
  if (!matchesGenerated && !matchesTest) return new ApiError(400, 'otp_invalid');
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
