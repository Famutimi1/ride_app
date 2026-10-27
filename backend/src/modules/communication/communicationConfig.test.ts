import assert from 'node:assert/strict';
import test from 'node:test';
import { communicationConfiguration } from './communication.config';

const account = { type: 'service_account', project_id: 'rakky-fixture', client_email: 'sender@rakky-fixture.iam.gserviceaccount.com', private_key: 'fixture-key' };

test('normal communication features need no explicit enable values', () => {
  const config = communicationConfiguration({});
  assert.equal(config.COMMUNICATION_CHAT_ENABLED, true);
  assert.equal(config.COMMUNICATION_AUDIO_ENABLED, true);
  assert.equal(config.COMMUNICATION_VIDEO_ENABLED, true);
  assert.equal(config.COMMUNICATION_NATIVE_CALLS_ENABLED, true);
  assert.equal(config.COMMUNICATION_AUDIO_ALLOW_DIRECT_ONLY, true);
  assert.equal(config.CALL_FCM_CREDENTIALS_FILE, '');
  assert.equal(config.CALL_FCM_PROJECT_ID, '');
});

test('production never gains direct-only calling from local defaults or an old override', () => {
  for (const value of [undefined, 'true', 'false']) {
    assert.equal(communicationConfiguration({ NODE_ENV: 'production', COMMUNICATION_AUDIO_ALLOW_DIRECT_ONLY: value }).COMMUNICATION_AUDIO_ALLOW_DIRECT_ONLY, false);
  }
});

test('existing deployments retain explicit communication shutdown overrides', () => {
  const names = ['COMMUNICATION_CHAT_ENABLED', 'COMMUNICATION_AUDIO_ENABLED', 'COMMUNICATION_VIDEO_ENABLED', 'COMMUNICATION_NATIVE_CALLS_ENABLED', 'COMMUNICATION_AUDIO_ALLOW_DIRECT_ONLY'] as const;
  const config = communicationConfiguration(Object.fromEntries(names.map(name => [name, 'false'])));
  for (const name of names) {
    assert.equal(config[name], false);
    assert.throws(() => communicationConfiguration({ [name]: 'yes' }), /must be true or false/);
  }
});

test('FCM project comes from the existing service-account JSON without a duplicate environment value', () => {
  const config = communicationConfiguration({ CALL_FCM_CREDENTIALS_FILE: '/private/fcm.json' }, path => {
    assert.equal(path, '/private/fcm.json'); return account;
  });
  assert.equal(config.CALL_FCM_PROJECT_ID, account.project_id);
  assert.equal(config.CALL_FCM_CREDENTIALS_FILE, '/private/fcm.json');
  assert.equal(JSON.stringify(config).includes(account.private_key), false);
});

test('an existing Google credentials path works and an explicit call credentials path takes priority', () => {
  const paths: string[] = [];
  const read = (path: string) => { paths.push(path); return account; };
  communicationConfiguration({ GOOGLE_APPLICATION_CREDENTIALS: '/private/google.json', CALL_FCM_CREDENTIALS_FILE: '' }, read);
  communicationConfiguration({ GOOGLE_APPLICATION_CREDENTIALS: '/private/google.json', CALL_FCM_CREDENTIALS_FILE: '/private/calls.json' }, read);
  assert.deepEqual(paths, ['/private/google.json', '/private/calls.json']);
});

test('the fixed credential location needs no environment path and still reads its project from JSON', () => {
  const config = communicationConfiguration({}, path => {
    assert.equal(path, '/private/fixed-location.json'); return account;
  }, '/private/fixed-location.json');
  assert.equal(config.CALL_FCM_CREDENTIALS_FILE, '/private/fixed-location.json');
  assert.equal(config.CALL_FCM_PROJECT_ID, account.project_id);
});

test('an intentional deployment override takes priority over the fixed credential location', () => {
  const read = (path: string) => { assert.equal(path, '/deployment/fcm.json'); return account; };
  const config = communicationConfiguration({ CALL_FCM_CREDENTIALS_FILE: '/deployment/fcm.json' }, read, '/private/fixed-location.json');
  assert.equal(config.CALL_FCM_CREDENTIALS_FILE, '/deployment/fcm.json');
});

test('conflicting legacy project IDs fail without exposing private credential contents', () => {
  assert.equal(communicationConfiguration({ CALL_FCM_CREDENTIALS_FILE: '/private/fcm.json', CALL_FCM_PROJECT_ID: account.project_id }, () => account).CALL_FCM_PROJECT_ID, account.project_id);
  assert.throws(() => communicationConfiguration({ CALL_FCM_CREDENTIALS_FILE: '/private/fcm.json', CALL_FCM_PROJECT_ID: 'different-project' }, () => account), /conflicts with the service-account JSON/);
});

test('missing files, malformed JSON and mobile app configuration cannot masquerade as server credentials', () => {
  const settings = { CALL_FCM_CREDENTIALS_FILE: '/private/fcm.json' };
  assert.throws(() => communicationConfiguration(settings, () => { throw new Error('sensitive file contents'); }), error => error instanceof Error && !error.message.includes('sensitive file contents'));
  for (const value of [null, [], { project_info: { project_id: account.project_id } }, { ...account, private_key: '' }, { ...account, project_id: '../unsafe' }]) {
    assert.throws(() => communicationConfiguration(settings, () => value), /service-account JSON/);
  }
});
