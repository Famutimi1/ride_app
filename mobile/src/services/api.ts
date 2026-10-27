import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { UserFacingError, userErrorMessage } from '@/utils/userMessage';

const configuredUrl = (process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:4000').replace(/\/$/, '');
const configured = new URL(configuredUrl);
const metroHost = Constants.expoConfig?.hostUri?.split(':')[0];
const nativeDevelopmentHost = metroHost ?? (Platform.OS === 'android' ? '10.0.2.2' : 'localhost');

// A phone cannot reach the Mac through localhost. Reuse Metro's development host.
export const API_BASE_URL = Platform.OS !== 'web' && ['localhost', '127.0.0.1'].includes(configured.hostname)
  ? `${configured.protocol}//${nativeDevelopmentHost}:${configured.port || '4000'}`
  : configuredUrl;

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  try {
    const response = await fetch(`${API_BASE_URL}/api${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init?.headers },
      signal: init?.signal ?? AbortSignal.timeout(10_000),
    });
    // Proxies may return HTML; a JSON parsing exception is never useful public copy.
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) throw new UserFacingError(userErrorMessage({ response: { status: response.status, data: body } }));
    if (body === null) throw new UserFacingError('We couldn’t load this information. Please try again.');
    return body as T;
  } catch (error) {
    throw new UserFacingError(userErrorMessage(error));
  }
}
