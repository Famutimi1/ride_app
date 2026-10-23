import { OAuth2Client } from 'google-auth-library';
import { env } from '../../config/env';
import { ApiError } from '../../shared/errors';

const client = new OAuth2Client();
export async function verifyStaffGoogleToken(idToken: string, expectedNonce: string) {
  if (!env.GOOGLE_CLIENT_ID_WEB) throw new ApiError(503, 'google_sign_in_not_configured');
  try {
    const ticket = await client.verifyIdToken({ idToken, audience: env.GOOGLE_CLIENT_ID_WEB });
    const profile = ticket.getPayload();
    if (!profile?.sub || !profile.email || profile.email_verified !== true || profile.nonce !== expectedNonce)
      throw new ApiError(401, 'invalid_google_token');
    return profile;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(401, 'invalid_google_token');
  }
}
export async function verifyGoogleToken(idToken: string, expectedNonce?: string) {
  const audience = (expectedNonce ? [env.GOOGLE_CLIENT_ID_WEB] : [env.GOOGLE_CLIENT_ID_IOS, env.GOOGLE_CLIENT_ID_ANDROID, env.GOOGLE_CLIENT_ID_WEB]).filter(Boolean);
  if (!audience.length) throw new ApiError(503, 'google_sign_in_not_configured');
  const ticket = await client.verifyIdToken({ idToken, audience });
  const payload = ticket.getPayload();
  if (!payload?.sub || !payload.email || !payload.name || payload.email_verified !== true || (expectedNonce && payload.nonce !== expectedNonce)) throw new ApiError(401, 'invalid_google_token');
  return payload;
}
