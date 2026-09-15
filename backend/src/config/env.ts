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

/**
 * Centralised, typed access to environment variables.
 * Add new config here so the rest of the app never touches process.env directly.
 */
export const env = {
  PORT: Number(process.env.PORT) || 4000,
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  DATABASE_URL: process.env.DATABASE_URL ?? '',
  REDIS_URL: process.env.REDIS_URL ?? '',
  GOOGLE_MAPS_API_KEY: process.env.GOOGLE_MAPS_API_KEY ?? legacyGoogleMapsKey ?? '',
  FARE_BASE_NGN: Number(process.env.FARE_BASE_NGN) || 800,
  FARE_PER_KM_NGN: Number(process.env.FARE_PER_KM_NGN) || 250,
  FARE_PER_MINUTE_NGN: Number(process.env.FARE_PER_MINUTE_NGN) || 35,
} as const;
