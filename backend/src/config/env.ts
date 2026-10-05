import dotenv from 'dotenv';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

dotenv.config();

// Local development historically kept the server key in mobile/.env. Read only
// that one non-public value as a fallback; never import its PORT or other secrets.
const legacyMobileEnvPath = resolve(process.cwd(), '../mobile/.env');
const legacyGoogleMapsKey = existsSync(legacyMobileEnvPath)
  ? dotenv.parse(readFileSync(legacyMobileEnvPath)).GOOGLE_MAPS_API_KEY
  : undefined;
const nodeEnv = process.env.NODE_ENV ?? 'development';
const jwtAccessSecret = process.env.JWT_ACCESS_SECRET ?? process.env.JWT_SECRET ?? (nodeEnv === 'development' ? 'development-access-secret-change-me' : '');
if (!jwtAccessSecret) throw new Error('JWT_ACCESS_SECRET is required outside development.');
const numberList = (value: string | undefined, fallback: number[]) => {
  const parsed = (value ?? '').split(',').map(Number).filter((item) => Number.isFinite(item) && item > 0);
  return parsed.length ? parsed : fallback;
};

/**
 * Centralised, typed access to environment variables.
 * Add new config here so the rest of the app never touches process.env directly.
 */
export const env = {
  PORT: Number(process.env.PORT) || 4000,
  NODE_ENV: nodeEnv,
  DATABASE_URL: process.env.DATABASE_URL ?? '',
  REDIS_URL: process.env.REDIS_URL ?? '',
  GOOGLE_MAPS_API_KEY: process.env.GOOGLE_MAPS_SERVER_KEY ?? process.env.GOOGLE_MAPS_API_KEY ?? legacyGoogleMapsKey ?? '',
  FARE_BASE_NGN: Number(process.env.FARE_BASE_NGN) || 800,
  FARE_PER_KM_NGN: Number(process.env.FARE_PER_KM_NGN) || 250,
  FARE_PER_MINUTE_NGN: Number(process.env.FARE_PER_MINUTE_NGN) || 35,
  JWT_ACCESS_SECRET: jwtAccessSecret,
  JWT_ACCESS_EXPIRY: process.env.JWT_ACCESS_EXPIRY ?? '15m',
  REFRESH_TOKEN_EXPIRY_DAYS: Number(process.env.REFRESH_TOKEN_EXPIRY_DAYS) || 30,
  TERMII_API_KEY: process.env.TERMII_API_KEY ?? '',
  TERMII_SENDER_ID: process.env.TERMII_SENDER_ID ?? 'RakkyRide',
  GOOGLE_CLIENT_ID_IOS: process.env.GOOGLE_CLIENT_ID_IOS ?? '',
  GOOGLE_CLIENT_ID_ANDROID: process.env.GOOGLE_CLIENT_ID_ANDROID ?? '',
  GOOGLE_CLIENT_ID_WEB: process.env.GOOGLE_CLIENT_ID_WEB ?? '',
  OTP_RATE_LIMIT_MAX: Number(process.env.OTP_RATE_LIMIT_MAX) || 3,
  OTP_RATE_LIMIT_WINDOW_MINUTES: Number(process.env.OTP_RATE_LIMIT_WINDOW_MINUTES) || 15,
  OTP_RESEND_COOLDOWN_SECONDS: Number(process.env.OTP_RESEND_COOLDOWN_SECONDS) || 60,
  DISPATCH_RADIUS_STEPS_M: numberList(process.env.DISPATCH_RADIUS_STEPS_M, [3000, 5000, 8000]),
  OFFER_TIMEOUT_SECONDS: Number(process.env.OFFER_TIMEOUT_SECONDS) || 15,
  SEARCH_TIMEOUT_SECONDS: Number(process.env.SEARCH_TIMEOUT_SECONDS) || 120,
  MAX_OFFERS_PER_TRIP: Number(process.env.MAX_OFFERS_PER_TRIP) || 6,
  DRIVER_LOCATION_EMIT_MS: Number(process.env.DRIVER_LOCATION_EMIT_MS) || 4000,
  BREADCRUMB_SAMPLE_SECONDS: Number(process.env.BREADCRUMB_SAMPLE_SECONDS) || 15,
  ETA_REFRESH_SECONDS: Number(process.env.ETA_REFRESH_SECONDS) || 45,
  CASH_DEBT_LIMIT_KOBO: Number(process.env.CASH_DEBT_LIMIT_KOBO) || 500000,
  PAYSTACK_SECRET_KEY: process.env.PAYSTACK_SECRET_KEY ?? '',
  PAYSTACK_BASE_URL: process.env.PAYSTACK_BASE_URL ?? 'https://api.paystack.co',
  PAYMENT_SYNTHETIC_EMAIL_DOMAIN: process.env.PAYMENT_SYNTHETIC_EMAIL_DOMAIN ?? '',
  ALERT_WEBHOOK_URL: process.env.ALERT_WEBHOOK_URL ?? '',
  TRIP_ESTIMATE_RATE_LIMIT_PER_MIN: Number(process.env.TRIP_ESTIMATE_RATE_LIMIT_PER_MIN) || 20,
} as const;
