import type { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { db } from '../../shared/config/db';
import { assertDriverMaterialEditable } from '../driver/driver.service';
import { env } from '../../config/env';
import { ApiError } from '../../shared/errors';
import { normalizeNigerianPhone } from '../../shared/utils/phone';
import { isAppAccountRole, publicUser, type AccountType, type AuthUserRow, type DriverStatus, type OtpPurpose, type SessionScope } from './auth.types';
import { generateOtp, withVerifiedOtp } from './otp.service';
import { createRefreshToken, hashToken, signAccessToken, signPhoneVerificationToken, verifyPhoneVerificationToken, signPhoneChangeToken, verifyPhoneChangeToken } from './jwt.service';
import { verifyGoogleToken, verifyStaffGoogleToken } from './google.service';
import { normalizedEmail, queueSignupEmails, resolveWelcomeEmail } from '../notifications/email.service';

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

export async function verifyRegistration(input: { fullName?: unknown; phone?: unknown; code?: unknown; accountType?: unknown; phoneVerificationToken?: unknown; email?:unknown }, deviceInfo: string | undefined) {
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
      const email=normalizedEmail(input.email);
      const { rows } = await client.query(`INSERT INTO users (full_name,phone,phone_verified_at,email) VALUES ($1,$2,now(),$3) RETURNING *`, [fullName, phone,email]);
      user = rows[0];
    }
    await queueSignupEmails(client,user,accountType);
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
  if (!isAppAccountRole(user.role)) throw new ApiError(403, 'app_account_required');
  // Staff may use their customer profile, but changing their sign-in email stays
  // a staff identity operation. Sending the unchanged address is safe for forms.
  if (user.role !== 'user' && hasEmail && email !== (user.email?.trim().toLowerCase() ?? null)) throw new ApiError(403, 'staff_email_requires_admin');
  if(hasName&&name!==user.full_name)await assertDriverMaterialEditable(userId,client);
  try {
    await client.query(`UPDATE users SET full_name=CASE WHEN $2 THEN $3 ELSE full_name END,
      email=CASE WHEN $4 THEN $5 ELSE email END,updated_at=now() WHERE id=$1`, [userId, hasName, name, hasEmail, email]);
  } catch (error) {
    if ((error as { code?: string }).code === '23505') throw new ApiError(409, 'email_already_registered');
    throw error;
  }
  if(hasEmail&&email)await resolveWelcomeEmail(client,userId,email);
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
      const updated = (await client.query('UPDATE users SET google_id=$1,avatar_url=CASE WHEN avatar_revision=0 THEN COALESCE(avatar_url,$2) ELSE avatar_url END,updated_at=now() WHERE id=$3 RETURNING *', [profile.sub, profile.picture ?? null, user.id])).rows[0] as AuthUserRow | undefined;
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
