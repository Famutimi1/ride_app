import { OAuth2Client } from 'google-auth-library';
import { env } from '../../config/env';
import { ApiError } from '../../shared/errors';

const client = new OAuth2Client();
export async function verifyGoogleToken(idToken: string) {
  const audience = [env.GOOGLE_CLIENT_ID_IOS, env.GOOGLE_CLIENT_ID_ANDROID, env.GOOGLE_CLIENT_ID_WEB].filter(Boolean);
  if (!audience.length) throw new ApiError(503, 'google_sign_in_not_configured');
  const ticket = await client.verifyIdToken({ idToken, audience });
  const payload = ticket.getPayload();
  if (!payload?.sub || !payload.email || !payload.name) throw new ApiError(401, 'invalid_google_token');
  return payload;
}
