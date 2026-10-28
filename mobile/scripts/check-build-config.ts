import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { appVariant, validateFirebaseClient, validateVariantApi } from '../config/appVariants.ts';

try {
  try { loadEnvFile(resolve('.env')); }
  catch (error) { if ((error as { code?: string }).code !== 'ENOENT') throw error; }
  const selected = appVariant(process.env.APP_VARIANT);
  validateVariantApi(selected.variant, process.env.EXPO_PUBLIC_API_BASE_URL);
  if (process.env.EAS_BUILD_PLATFORM !== 'ios') {
    const path = resolve(process.env.GOOGLE_SERVICES_JSON ?? selected.googleServicesFile);
    if (!existsSync(path)) throw new Error(`Firebase client configuration for ${selected.applicationId} is missing. Supply GOOGLE_SERVICES_JSON in the matching EAS environment or save ${selected.googleServicesFile} locally.`);
    let client: unknown;
    try { client = JSON.parse(readFileSync(path, 'utf8')); }
    catch { throw new Error('The Firebase client configuration must be readable JSON.'); }
    validateFirebaseClient(client, selected.applicationId);
  }
  console.info(`Build configuration ready: ${selected.variant}, ${selected.applicationId}.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Build configuration validation failed.');
  process.exitCode = 1;
}
