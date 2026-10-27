import { readFileSync } from 'node:fs';

type Settings = Record<string, string | undefined>;
type ReadCredential = (path: string) => unknown;

/** Normal product features need no switches. Keep explicit overrides for existing deployments. */
export function communicationConfiguration(settings: Settings, readCredential: ReadCredential = path => JSON.parse(readFileSync(path, 'utf8')), defaultCredentialFile = '') {
  const enabled = (name: string, fallback = true) => {
    const value = settings[name];
    if (value === undefined || value === '') return fallback;
    if (value !== 'true' && value !== 'false') throw new Error(`${name} must be true or false.`);
    return value === 'true';
  };
  const local = ['development', 'test'].includes(settings.NODE_ENV ?? 'development');
  const directOnly = enabled('COMMUNICATION_AUDIO_ALLOW_DIRECT_ONLY');
  const credentialFile = settings.CALL_FCM_CREDENTIALS_FILE?.trim() || settings.GOOGLE_APPLICATION_CREDENTIALS?.trim() || defaultCredentialFile;
  let projectId = settings.CALL_FCM_PROJECT_ID?.trim() || '';
  if (credentialFile) {
    let credential: unknown;
    try { credential = readCredential(credentialFile); }
    catch { throw new Error('CALL_FCM_CREDENTIALS_FILE must reference a readable service-account JSON file.'); }
    if (!credential || typeof credential !== 'object') throw new Error('FCM requires a service-account JSON file.');
    const account = credential as Record<string, unknown>;
    if (account.type !== 'service_account' || typeof account.project_id !== 'string'
      || !/^[a-z][a-z0-9-]{4,62}$/.test(account.project_id)
      || typeof account.client_email !== 'string' || !account.client_email.endsWith('.gserviceaccount.com')
      || typeof account.private_key !== 'string' || !account.private_key.trim())
      throw new Error('FCM requires a service-account JSON with project_id, client_email and private_key.');
    if (projectId && projectId !== account.project_id) throw new Error('CALL_FCM_PROJECT_ID conflicts with the service-account JSON project_id. Remove the redundant override.');
    projectId = account.project_id;
  }
  return {
    COMMUNICATION_CHAT_ENABLED: enabled('COMMUNICATION_CHAT_ENABLED'),
    COMMUNICATION_AUDIO_ENABLED: enabled('COMMUNICATION_AUDIO_ENABLED'),
    COMMUNICATION_VIDEO_ENABLED: enabled('COMMUNICATION_VIDEO_ENABLED'),
    COMMUNICATION_NATIVE_CALLS_ENABLED: enabled('COMMUNICATION_NATIVE_CALLS_ENABLED'),
    COMMUNICATION_AUDIO_ALLOW_DIRECT_ONLY: local && directOnly,
    CALL_FCM_CREDENTIALS_FILE: credentialFile,
    CALL_FCM_PROJECT_ID: projectId,
  };
}
