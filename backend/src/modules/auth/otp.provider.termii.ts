import { env } from '../../config/env';
import { ApiError } from '../../shared/errors';
import type { OtpProvider } from './otp.provider.interface';

export class TermiiOtpProvider implements OtpProvider {
  async send(phone: string, code: string) {
    if (env.NODE_ENV === 'development') {
      console.info(`[auth] Development OTP for ${phone.slice(0, 7)}****: ${code}`);
      return;
    }
    if (!env.TERMII_API_KEY) throw new ApiError(503, 'otp_provider_not_configured');
    const response = await fetch('https://api.ng.termii.com/api/sms/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ api_key: env.TERMII_API_KEY, to: phone, from: env.TERMII_SENDER_ID, sms: `Your Rakky Ride verification code is ${code}. It expires in 5 minutes.`, type: 'plain', channel: 'generic' }) });
    if (!response.ok) throw new ApiError(502, 'otp_delivery_failed');
  }
}
