import axios, { AxiosError, create, isAxiosError, type InternalAxiosRequestConfig } from 'axios';
import { API_BASE_URL } from '@/services/api';
import { tokenStore } from './secureTokenStore';

export const apiClient = create({
  baseURL: `${API_BASE_URL}/api`,
  timeout: 10_000,
  headers: { 'Content-Type': 'application/json' },
});

apiClient.interceptors.request.use(async (config) => {
  const token = await tokenStore.getAccessToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

let refreshPromise: Promise<void> | null = null;

async function refresh() {
  const refreshToken = await tokenStore.getRefreshToken();
  if (!refreshToken) throw new Error('missing_refresh_token');
  const { data } = await axios.post(`${API_BASE_URL}/api/auth/refresh`, { refreshToken });
  await tokenStore.setTokens(data.tokens);
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
    const config = error.config as (InternalAxiosRequestConfig & { _retry?: boolean }) | undefined;
    const refreshToken = await tokenStore.getRefreshToken();
    const shouldRefresh = error.response?.status === 401
      && config
      && !config._retry
      && !isPublicAuthPath(config.url)
      && refreshToken;

    if (shouldRefresh) {
      config._retry = true;
      try {
        refreshPromise ??= refresh().finally(() => { refreshPromise = null; });
        await refreshPromise;
        return apiClient(config);
      } catch (refreshError) {
        await tokenStore.clear();
        throw refreshError;
      }
    }

    throw error;
  },
);

export function apiErrorMessage(error: unknown) {
  if (isAxiosError(error)) {
    const data = error.response?.data as { error?: string; retryAfterSeconds?: number } | undefined;
    if (data?.error === 'otp_cooldown') {
      return `Please wait ${data.retryAfterSeconds ?? 60} seconds before requesting another code.`;
    }
    return data?.error?.replaceAll('_', ' ') ?? 'The service is unavailable. Please retry.';
  }
  return error instanceof Error ? error.message : 'Something went wrong.';
}
