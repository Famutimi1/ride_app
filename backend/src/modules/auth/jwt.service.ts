import { createHash, randomBytes } from 'node:crypto';
import jwt, { type JwtPayload, type SignOptions } from 'jsonwebtoken';
import { env } from '../../config/env';
import type { SessionScope } from './auth.types';

export function signAccessToken(user: { id: string; phone?: string | null }, sessionScope: SessionScope = 'app', session?: {id:string;startedAt:Date}) {
  return jwt.sign({ phone: user.phone ?? undefined, sessionScope, sessionId: session?.id,
    ...(sessionScope==='staff' && session ? {sessionExpiresAt:Math.floor(session.startedAt.getTime()/1000)+12*60*60} : {}),
  }, env.JWT_ACCESS_SECRET, { subject: user.id, expiresIn: env.JWT_ACCESS_EXPIRY as SignOptions['expiresIn'] });
}
export function createRefreshToken() { return randomBytes(48).toString('hex'); }
export function hashToken(token: string) { return createHash('sha256').update(token).digest('hex'); }
function verifiedPayload(token: string): JwtPayload {
  const payload = jwt.verify(token, env.JWT_ACCESS_SECRET);
  if (typeof payload === 'string' || !payload.sub) throw new Error('invalid_token');
  return payload;
}
export function verifyAccessToken(token: string): JwtPayload & { sessionScope: SessionScope; sessionId?:string } {
  const payload = verifiedPayload(token);
  if (payload.tokenType !== undefined) throw new Error('invalid_access_token_type');
  if (payload.sessionScope !== undefined && payload.sessionScope !== 'app' && payload.sessionScope !== 'staff') throw new Error('invalid_session_scope');
  if(typeof payload.iat!=='number'||typeof payload.exp!=='number')throw new Error('missing_token_lifetime');
  if(payload.sessionId!==undefined && (typeof payload.sessionId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.sessionId)))throw new Error('invalid_session_id');
  if(payload.sessionExpiresAt!==undefined && (typeof payload.sessionExpiresAt!=='number'||payload.sessionExpiresAt<=Date.now()/1000))throw new Error('session_expired');
  if(!payload.sessionId && payload.iat+15*60<=Date.now()/1000)throw new Error('legacy_access_expired');
  // Older tokens have customer access only; staff must sign in again.
  return { ...payload, sessionScope: payload.sessionScope ?? 'app' };
}
export function signPhoneVerificationToken(userId: string) { return jwt.sign({ tokenType: 'phone_verification' }, env.JWT_ACCESS_SECRET, { subject: userId, expiresIn: '10m' }); }
export function verifyPhoneVerificationToken(token: string) {
  const payload = verifiedPayload(token);
  if (payload.tokenType !== 'phone_verification' || !payload.sub) throw new Error('invalid_phone_verification_token');
  return payload.sub;
}
export function signPhoneChangeToken(userId: string, phone: string, otpId: string) {
  return jwt.sign({ tokenType: 'phone_change', phone, otpId }, env.JWT_ACCESS_SECRET, { subject: userId, expiresIn: '5m' });
}
export function verifyPhoneChangeToken(token: string, userId: string) {
  const payload = verifiedPayload(token);
  if (payload.tokenType !== 'phone_change' || payload.sub !== userId || typeof payload.phone !== 'string' || typeof payload.otpId !== 'string') throw new Error('invalid_phone_change_token');
  return { phone: payload.phone, otpId: payload.otpId };
}
