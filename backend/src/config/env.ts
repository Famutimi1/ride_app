import dotenv from 'dotenv';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {isIP} from 'node:net';

dotenv.config();

// Local development historically kept the server key in mobile/.env. Read only
// that one non-public value as a fallback; never import its PORT or other secrets.
const legacyMobileEnvPath = resolve(process.cwd(), '../mobile/.env');
const legacyGoogleMapsKey = existsSync(legacyMobileEnvPath)
  ? dotenv.parse(readFileSync(legacyMobileEnvPath)).GOOGLE_MAPS_API_KEY
  : undefined;
const nodeEnv = process.env.NODE_ENV ?? 'development';
const paystackBaseUrl=process.env.PAYSTACK_BASE_URL??'https://api.paystack.co';
if((nodeEnv==='production'||process.env.PAYSTACK_SECRET_KEY?.startsWith('sk_live_'))&&paystackBaseUrl!=='https://api.paystack.co')throw new Error('Production/live Paystack credentials require the official API origin.');
const jwtAccessSecret = process.env.JWT_ACCESS_SECRET ?? process.env.JWT_SECRET ?? (nodeEnv === 'development' ? 'development-access-secret-change-me' : '');
if (!jwtAccessSecret) throw new Error('JWT_ACCESS_SECRET is required outside development.');
if(nodeEnv==='production' && (jwtAccessSecret.length<32 || jwtAccessSecret==='development-access-secret-change-me'))throw new Error('Production JWT_ACCESS_SECRET must be a strong, non-development secret.');
const authRateLimit=Number(process.env.AUTH_RATE_LIMIT_PER_MINUTE??300);
if(!Number.isSafeInteger(authRateLimit)||authRateLimit<1)throw new Error('AUTH_RATE_LIMIT_PER_MINUTE must be a positive integer.');
const trustedProxyCidrs=(process.env.TRUSTED_PROXY_CIDRS??'').split(',').map(value=>value.trim()).filter(Boolean);
for(const cidr of trustedProxyCidrs){const parts=cidr.split('/'),bits=isIP(parts[0]);if(!bits||parts.length>2||(parts.length===2&&(!/^\d+$/.test(parts[1])||Number(parts[1])<1||Number(parts[1])>(bits===4?32:128))))throw new Error('TRUSTED_PROXY_CIDRS requires exact IPs or non-wildcard CIDR ranges.');}
const tripQuoteTtlSeconds = Number(process.env.TRIP_QUOTE_TTL_SECONDS ?? 900);
if (!Number.isSafeInteger(tripQuoteTtlSeconds) || tripQuoteTtlSeconds <= 0) {
  throw new Error('TRIP_QUOTE_TTL_SECONDS must be a positive integer.');
}
const numberList = (value: string | undefined, fallback: number[]) => {
  const parsed = (value ?? '').split(',').map(Number).filter((item) => Number.isFinite(item) && item > 0);
  return parsed.length ? parsed : fallback;
};

const emailAdmins=[...new Set((process.env.EMAIL_ADMIN_RECIPIENTS??'').split(',').map(value=>value.trim().toLowerCase()).filter(Boolean))];
const validEmailAddress=(value:string)=>value.length<=160&&!/[\u0000-\u0020\u007f<>]/.test(value)&&/^[^@]+@[^@]+\.[^@]+$/.test(value);
if(emailAdmins.length>20||emailAdmins.some(value=>!validEmailAddress(value)))throw new Error('EMAIL_ADMIN_RECIPIENTS requires at most 20 valid email addresses.');
const emailFrom=(process.env.EMAIL_FROM??'').trim();
if(emailFrom&&(/[\r\n\u0000]/.test(emailFrom)||!validEmailAddress(emailFrom.match(/<([^<>]+)>$/)?.[1]??emailFrom)))throw new Error('EMAIL_FROM requires a valid sender address.');
const emailReplyTo=(process.env.EMAIL_REPLY_TO??'').trim();
if(emailReplyTo&&!validEmailAddress(emailReplyTo))throw new Error('EMAIL_REPLY_TO requires a valid email address.');
function emailUrl(name:string){
  const value=(process.env[name]??'').trim();
  if(!value)return '';
  try{const url=new URL(value);if(url.username||url.password||url.hash||!['https:',...(nodeEnv==='production'?[]:['http:'])].includes(url.protocol))throw new Error();return url.toString();}
  catch{throw new Error(`${name} requires a trusted HTTPS URL (HTTP is allowed only outside production).`);}
}

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
  AUTH_RATE_LIMIT_PER_MINUTE:authRateLimit,
  TRUSTED_PROXY_CIDRS:trustedProxyCidrs,
  DISPATCH_RADIUS_STEPS_M: numberList(process.env.DISPATCH_RADIUS_STEPS_M, [3000, 5000, 8000]),
  OFFER_TIMEOUT_SECONDS: Number(process.env.OFFER_TIMEOUT_SECONDS) || 15,
  SEARCH_TIMEOUT_SECONDS: Number(process.env.SEARCH_TIMEOUT_SECONDS) || 120,
  MAX_OFFERS_PER_TRIP: Number(process.env.MAX_OFFERS_PER_TRIP) || 6,
  DRIVER_LOCATION_EMIT_MS: Number(process.env.DRIVER_LOCATION_EMIT_MS) || 4000,
  BREADCRUMB_SAMPLE_SECONDS: Number(process.env.BREADCRUMB_SAMPLE_SECONDS) || 15,
  ETA_REFRESH_SECONDS: Number(process.env.ETA_REFRESH_SECONDS) || 45,
  CASH_DEBT_LIMIT_KOBO: Number(process.env.CASH_DEBT_LIMIT_KOBO) || 500000,
  ENABLE_ADMIN_MONEY_ACTIONS: process.env.ENABLE_ADMIN_MONEY_ACTIONS === 'true',
  ENABLE_LIVE_PAYMENTS: process.env.ENABLE_LIVE_PAYMENTS === 'true',
  PAYSTACK_SECRET_KEY: process.env.PAYSTACK_SECRET_KEY ?? '',
  PAYSTACK_BASE_URL: paystackBaseUrl,
  PAYMENT_CALLBACK_URL: process.env.PAYMENT_CALLBACK_URL ?? '',
  PAYMENT_SYNTHETIC_EMAIL_DOMAIN: process.env.PAYMENT_SYNTHETIC_EMAIL_DOMAIN ?? '',
  ALERT_WEBHOOK_URL: process.env.ALERT_WEBHOOK_URL ?? '',
  TRIP_ESTIMATE_RATE_LIMIT_PER_MIN: Number(process.env.TRIP_ESTIMATE_RATE_LIMIT_PER_MIN) || 20,
  TRIP_QUOTE_TTL_SECONDS: tripQuoteTtlSeconds,
  TRIP_QUEUE_PREFIX: process.env.TRIP_QUEUE_PREFIX ?? 'bull',
  EXPO_ACCESS_TOKEN: process.env.EXPO_ACCESS_TOKEN ?? '',
  EMAIL_ENABLED: process.env.EMAIL_ENABLED === 'true',
  RESEND_API_KEY: process.env.RESEND_API_KEY ?? '',
  RESEND_WEBHOOK_SECRET: process.env.RESEND_WEBHOOK_SECRET ?? '',
  EMAIL_FROM: emailFrom,
  EMAIL_REPLY_TO: emailReplyTo,
  EMAIL_ADMIN_RECIPIENTS: emailAdmins,
  EMAIL_DASHBOARD_URL: emailUrl('EMAIL_DASHBOARD_URL'),
  EMAIL_LOGO_URL: emailUrl('EMAIL_LOGO_URL'),
} as const;
