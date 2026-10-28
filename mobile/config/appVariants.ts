export type AppVariant = 'development' | 'preview' | 'production';

export function appVariant(value = 'development') {
  if (!['development', 'preview', 'production'].includes(value)) {
    throw new Error('APP_VARIANT must be development, preview or production.');
  }
  const variant = value as AppVariant;
  const production = variant === 'production';
  return {
    variant,
    production,
    applicationId: production ? 'com.rackyride.app' : 'com.rackyride.app.test',
    name: production ? 'RackyRide' : 'Rakky Ride Test',
    scheme: production ? 'rackyride' : 'rackyride-test',
    googleServicesFile: production ? './google-services.json' : './google-services.test.json',
    developmentClient: variant === 'development',
  };
}

/** Preview APKs need an explicit reachable server; production needs HTTPS. */
export function validateVariantApi(variant: AppVariant, value: string | undefined) {
  if (variant === 'development') return;
  let url: URL;
  try { url = new URL(value ?? ''); }
  catch { throw new Error(`Set EXPO_PUBLIC_API_BASE_URL in the ${variant} EAS environment before building.`); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash || url.search
    || ['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0', '10.0.2.2'].includes(url.hostname)) {
    throw new Error(`${variant} needs an API address reachable from the phone, not localhost or an emulator-only address.`);
  }
  const privateHost = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.|169\.254\.)/.test(url.hostname)
    || url.hostname.endsWith('.local');
  if (variant === 'production' && (url.protocol !== 'https:' || privateHost)) {
    throw new Error('Production requires a public HTTPS EXPO_PUBLIC_API_BASE_URL.');
  }
}

export function validateFirebaseClient(value: unknown, applicationId: string) {
  const data = value as { project_info?: { project_id?: unknown }; client?: { client_info?: { android_client_info?: { package_name?: unknown } } }[] } | null;
  if (!data || typeof data.project_info?.project_id !== 'string' || !Array.isArray(data.client)
    || !data.client.some(client => client?.client_info?.android_client_info?.package_name === applicationId)) {
    throw new Error(`The Firebase client JSON must include Android package ${applicationId}. Register that package in the existing Firebase project and download its client configuration.`);
  }
}
