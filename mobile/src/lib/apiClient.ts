import axios, { AxiosError, create, isAxiosError, type InternalAxiosRequestConfig } from 'axios';
import { API_BASE_URL } from '@/services/api';
import { userErrorMessage } from '@/utils/userMessage';
import { tokenStore } from './secureTokenStore';

export const apiClient = create({
  baseURL: `${API_BASE_URL}/api`,
  timeout: 10_000,
  headers: { 'Content-Type': 'application/json' },
});

type SessionRequestConfig = InternalAxiosRequestConfig & { _retry?: boolean; _sessionGeneration?: number };
apiClient.interceptors.request.use(async (config: SessionRequestConfig) => {
  config._sessionGeneration ??= tokenStore.getSessionGeneration();
  const token = await tokenStore.getAccessToken();
  if (config._sessionGeneration !== tokenStore.getSessionGeneration()) throw new Error('The signed-in account changed. Please retry.');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

let refreshPromise: Promise<void> | null = null;
const expiredListeners = new Set<() => void>();

export class SessionExpiredError extends Error {
  constructor() { super('Your session has expired. Please sign in again.'); this.name = 'SessionExpiredError'; }
}

export function isSessionRejected(error: unknown) {
  return error instanceof SessionExpiredError || (isAxiosError(error) && error.response?.status === 401);
}

export function subscribeSessionExpired(listener: () => void) {
  expiredListeners.add(listener);
  return () => { expiredListeners.delete(listener); };
}

async function refresh() {
  const refreshToken = await tokenStore.getRefreshToken();
  if (!refreshToken) throw new SessionExpiredError();
  try {
    const { data } = await axios.post(`${API_BASE_URL}/api/auth/refresh`, { refreshToken }, { timeout: 10_000 });
    if (!await tokenStore.setTokens(data.tokens, refreshToken)) throw new Error('The signed-in account changed during refresh.');
  } catch (error) {
    if (isSessionRejected(error) && await tokenStore.getRefreshToken() === refreshToken) {
      await tokenStore.clear();
      expiredListeners.forEach((listener) => listener());
      throw new SessionExpiredError();
    }
    throw error;
  }
}

export function refreshAccessToken() {
  refreshPromise ??= refresh().finally(() => { refreshPromise = null; });
  return refreshPromise;
}

function isPublicAuthPath(url?: string) {
  return url?.startsWith('/auth/register/')
    || url?.startsWith('/auth/login/')
    || url?.startsWith('/auth/otp/')
    || url === '/auth/google'
    || url === '/auth/refresh';
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const config = error.config as SessionRequestConfig | undefined;
    if (config?._sessionGeneration !== undefined && config._sessionGeneration !== tokenStore.getSessionGeneration()) {
      throw new Error('The signed-in account changed. Please retry.');
    }
    const refreshToken = await tokenStore.getRefreshToken();
    const shouldRefresh = error.response?.status === 401
      && config
      && !config._retry
      && !isPublicAuthPath(config.url)
      && refreshToken;

    if (shouldRefresh) {
      config._retry = true;
      try {
        await refreshAccessToken();
        return apiClient(config);
      } catch (refreshError) {
        throw refreshError;
      }
    }

    error.message = userErrorMessage(error);
    throw error;
  },
);

/** Stable public messages; Axios response codes stay intact for recovery/state logic. */
export { userErrorMessage as apiErrorMessage } from '@/utils/userMessage';
