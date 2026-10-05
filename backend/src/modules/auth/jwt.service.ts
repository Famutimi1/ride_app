import { createHash, randomBytes } from 'node:crypto';
import jwt, { type JwtPayload, type SignOptions } from 'jsonwebtoken';
import { env } from '../../config/env';

export function signAccessToken(user: { id: string; phone?: string | null }) {
  return jwt.sign({ phone: user.phone ?? undefined }, env.JWT_ACCESS_SECRET, { subject: user.id, expiresIn: env.JWT_ACCESS_EXPIRY as SignOptions['expiresIn'] });
}
export function createRefreshToken() { return randomBytes(48).toString('hex'); }
export function hashToken(token: string) { return createHash('sha256').update(token).digest('hex'); }
export function verifyAccessToken(token: string): JwtPayload {
  const payload = jwt.verify(token, env.JWT_ACCESS_SECRET);
  if (typeof payload === 'string' || !payload.sub) throw new Error('invalid_token');
  return payload;
}
export function signPhoneVerificationToken(userId: string) { return jwt.sign({ tokenType: 'phone_verification' }, env.JWT_ACCESS_SECRET, { subject: userId, expiresIn: '10m' }); }
export function verifyPhoneVerificationToken(token: string) {
  const payload = verifyAccessToken(token);
  if (payload.tokenType !== 'phone_verification' || !payload.sub) throw new Error('invalid_phone_verification_token');
  return payload.sub;
}
