import type { PoolClient } from 'pg';
import { env } from '../../config/env';
import { ApiError } from '../../shared/errors';
import { normalizeNigerianPhone } from '../../shared/utils/phone';
import { publicUser, type AccountType, type AuthUserRow, type DriverStatus, type OtpPurpose } from './auth.types';
import { generateOtp, verifyOtp } from './otp.service';
import { createRefreshToken, hashToken, signAccessToken, signPhoneVerificationToken, verifyPhoneVerificationToken } from './jwt.service';
import { verifyGoogleToken } from './google.service';

export async function getDriverStatus(userId: string, client: PoolClient): Promise<DriverStatus> {
  const { rows } = await client.query('SELECT status FROM driver_profiles WHERE user_id=$1', [userId]);
  return rows[0]?.status ?? 'none';
}
const effectiveRole = (user: AuthUserRow, status: DriverStatus): AccountType => user.active_role === 'driver' && status === 'approved' ? 'driver' : 'rider';

export async function issueTokenPair(user: AuthUserRow, deviceInfo: string | undefined, client: PoolClient) {
  const accessToken = signAccessToken(user);
  const refreshToken = createRefreshToken();
  await client.query(`INSERT INTO refresh_tokens (user_id,token_hash,device_info,expires_at) VALUES ($1,$2,$3,now() + ($4 * interval '1 day'))`, [user.id, hashToken(refreshToken), deviceInfo?.slice(0, 255), env.REFRESH_TOKEN_EXPIRY_DAYS]);
  return { accessToken, refreshToken };
}

async function sessionPayload(user: AuthUserRow, deviceInfo: string | undefined, client: PoolClient) {
  const driverStatus = await getDriverStatus(user.id, client);
  return { tokens: await issueTokenPair(user, deviceInfo, client), user: publicUser(user), driverStatus, activeRole: effectiveRole(user, driverStatus) };
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

export async function verifyRegistration(input: { fullName?: unknown; phone?: unknown; code?: unknown; accountType?: unknown; phoneVerificationToken?: unknown }, deviceInfo: string | undefined, client: PoolClient) {
  const phone = normalizeNigerianPhone(input.phone);
  const code = String(input.code ?? '');
  const accountType: AccountType = input.accountType === 'driver' ? 'driver' : 'rider';
  await verifyOtp(phone, 'registration', code, client);
  let user: AuthUserRow;
  if (input.phoneVerificationToken) {
    let userId: string;
    try { userId = verifyPhoneVerificationToken(String(input.phoneVerificationToken)); } catch { throw new ApiError(401, 'invalid_phone_verification_token'); }
    const { rows } = await client.query(`UPDATE users SET phone=$1,phone_verified_at=now(),updated_at=now() WHERE id=$2 AND phone IS NULL RETURNING *`, [phone, userId]);
    if (!rows[0]) throw new ApiError(409, 'phone_link_failed');
    user = rows[0];
  } else {
    const fullName = String(input.fullName ?? '').trim();
    if (fullName.length < 2 || fullName.length > 120) throw new ApiError(400, 'invalid_full_name');
    const { rows } = await client.query(`INSERT INTO users (full_name,phone,phone_verified_at) VALUES ($1,$2,now()) RETURNING *`, [fullName, phone]);
    user = rows[0];
  }
  return { ...(await sessionPayload(user, deviceInfo, client)), accountType };
}

export async function initiateLogin(phoneValue: unknown, client: PoolClient) {
  const phone = normalizeNigerianPhone(phoneValue);
  if (!(await client.query('SELECT 1 FROM users WHERE phone=$1 AND is_active=true', [phone])).rowCount) throw new ApiError(404, 'account_not_found');
  await generateOtp(phone, 'login', client);
  return { phone, retryAfterSeconds: env.OTP_RESEND_COOLDOWN_SECONDS };
}

export async function verifyLogin(phoneValue: unknown, codeValue: unknown, deviceInfo: string | undefined, client: PoolClient) {
  const phone = normalizeNigerianPhone(phoneValue);
  await verifyOtp(phone, 'login', String(codeValue ?? ''), client);
  const { rows } = await client.query('SELECT * FROM users WHERE phone=$1 AND is_active=true', [phone]);
  if (!rows[0]) throw new ApiError(404, 'account_not_found');
  return sessionPayload(rows[0], deviceInfo, client);
}

export async function resendOtp(phoneValue: unknown, purpose: unknown, client: PoolClient) {
  if (!['registration','login','phone_change'].includes(String(purpose))) throw new ApiError(400, 'invalid_otp_purpose');
  const phone = normalizeNigerianPhone(phoneValue);
  await generateOtp(phone, purpose as OtpPurpose, client);
  return { retryAfterSeconds: env.OTP_RESEND_COOLDOWN_SECONDS };
}

export async function rotateRefreshToken(raw: unknown, deviceInfo: string | undefined, client: PoolClient) {
  if (typeof raw !== 'string' || raw.length < 64) throw new ApiError(401, 'invalid_refresh_token');
  const { rows } = await client.query('SELECT * FROM refresh_tokens WHERE token_hash=$1 FOR UPDATE', [hashToken(raw)]);
  const existing = rows[0];
  if (!existing) throw new ApiError(401, 'invalid_refresh_token');
  if (existing.revoked_at || existing.replaced_by) {
    await client.query('UPDATE refresh_tokens SET revoked_at=COALESCE(revoked_at,now()) WHERE user_id=$1 AND revoked_at IS NULL', [existing.user_id]);
    return { reuseDetected: true as const };
  }
  if (new Date(existing.expires_at).getTime() <= Date.now()) throw new ApiError(401, 'refresh_token_expired');
  const user = (await client.query('SELECT * FROM users WHERE id=$1 AND is_active=true', [existing.user_id])).rows[0];
  if (!user) throw new ApiError(401, 'account_inactive');
  const pair = await issueTokenPair(user, deviceInfo, client);
  await client.query(`UPDATE refresh_tokens SET revoked_at=now(),replaced_by=(SELECT id FROM refresh_tokens WHERE token_hash=$1) WHERE id=$2`, [hashToken(pair.refreshToken), existing.id]);
  return { reuseDetected: false as const, tokens: pair };
}

export async function revokeToken(userId: string, raw: unknown, client: PoolClient) {
  if (typeof raw === 'string') await client.query('UPDATE refresh_tokens SET revoked_at=COALESCE(revoked_at,now()) WHERE user_id=$1 AND token_hash=$2', [userId, hashToken(raw)]);
}
export async function revokeAll(userId: string, client: PoolClient) { await client.query('UPDATE refresh_tokens SET revoked_at=COALESCE(revoked_at,now()) WHERE user_id=$1 AND revoked_at IS NULL', [userId]); }

export async function getMe(userId: string, client: PoolClient) {
  const user = (await client.query('SELECT * FROM users WHERE id=$1 AND is_active=true', [userId])).rows[0];
  if (!user) throw new ApiError(404, 'account_not_found');
  const driverStatus = await getDriverStatus(userId, client);
  return { user: publicUser(user), driverStatus, activeRole: effectiveRole(user, driverStatus) };
}

export async function switchActiveRole(userId: string, requestedRole: unknown, client: PoolClient) {
  if (requestedRole !== 'rider' && requestedRole !== 'driver') throw new ApiError(400, 'invalid_role');
  if (requestedRole === 'driver') { const status = await getDriverStatus(userId, client); if (status !== 'approved') throw new ApiError(403, 'driver_not_approved', { driverStatus: status }); }
  await client.query('UPDATE users SET active_role=$1,updated_at=now() WHERE id=$2', [requestedRole, userId]);
  return { activeRole: requestedRole };
}

export async function googleSignIn(idToken: unknown, deviceInfo: string | undefined, client: PoolClient) {
  if (typeof idToken !== 'string') throw new ApiError(400, 'missing_google_token');
  const profile = await verifyGoogleToken(idToken);
  let user = (await client.query('SELECT * FROM users WHERE google_id=$1 OR email=$2 LIMIT 1 FOR UPDATE', [profile.sub, profile.email])).rows[0] as AuthUserRow | undefined;
  if (user) {
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
