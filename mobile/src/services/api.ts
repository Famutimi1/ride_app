import Constants from 'expo-constants';
import { Platform } from 'react-native';

const configuredUrl = (process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:4000').replace(/\/$/, '');
const configured = new URL(configuredUrl);
const metroHost = Constants.expoConfig?.hostUri?.split(':')[0];

const nativeDevelopmentHost = metroHost ?? (Platform.OS === 'android' ? '10.0.2.2' : 'localhost');

// A physical phone cannot reach the Mac through "localhost". During Expo LAN
// development, reuse Metro's host while preserving the configured backend port.
// An Android emulator that launches without Metro reaches the Mac at 10.0.2.2.
export const API_BASE_URL = Platform.OS !== 'web' && ['localhost', '127.0.0.1'].includes(configured.hostname)
  ? `${configured.protocol}//${nativeDevelopmentHost}:${configured.port || '4000'}`
  : configuredUrl;

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? 'The service is unavailable. Please retry.');
  return body;
}
