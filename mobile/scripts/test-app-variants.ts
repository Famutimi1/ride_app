import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { appVariant, validateFirebaseClient, validateVariantApi } from '../config/appVariants.ts';

test('production preserves the published identity; preview and development share a separate test identity', () => {
  assert.equal(appVariant('production').applicationId, 'com.rackyride.app');
  assert.equal(appVariant('production').scheme, 'rackyride');
  for (const variant of ['preview', 'development']) {
    const selected = appVariant(variant);
    assert.equal(selected.applicationId, 'com.rackyride.app.test');
    assert.equal(selected.scheme, 'rackyride-test');
    assert.equal(selected.name, 'Rakky Ride Test');
  }
  assert.equal(appVariant().variant, 'development');
  assert.throws(() => appVariant('prodution'), /APP_VARIANT/);
});

test('each EAS build selects its identity, environment and update channel together', () => {
  const config = JSON.parse(readFileSync('eas.json', 'utf8'));
  for (const name of ['development', 'preview', 'production']) {
    const profile = config.build[name];
    assert.equal(profile.env.APP_VARIANT, name);
    assert.equal(profile.environment, name);
    assert.equal(profile.channel, name);
  }
  assert.equal(config.build.preview.android.buildType, 'apk');
  assert.equal(config.build.production.android.buildType, 'app-bundle');
  assert.equal(config.build.development.developmentClient, true);
});

test('production and preview retain native fingerprint compatibility and the existing Expo project', () => {
  const config = JSON.parse(readFileSync('app.json', 'utf8')).expo;
  assert.equal(config.runtimeVersion.policy, 'fingerprint');
  assert.equal(config.updates.url, `https://u.expo.dev/${config.extra.eas.projectId}`);
  assert.notEqual(appVariant('production').googleServicesFile, appVariant('preview').googleServicesFile);
  assert.equal(appVariant('preview').developmentClient, false);
});

test('production cannot silently use local or insecure API addresses', () => {
  for (const value of [undefined, 'http://api.example.test', 'https://localhost:4000', 'https://10.0.0.1', 'https://127.0.0.2', 'https://api.local', 'https://user:password@api.example.test']) {
    assert.throws(() => validateVariantApi('production', value));
  }
  assert.doesNotThrow(() => validateVariantApi('production', 'https://api.example.test'));
});

test('standalone test APK needs a reachable API, while Metro development can use localhost', () => {
  assert.throws(() => validateVariantApi('preview', undefined));
  assert.throws(() => validateVariantApi('preview', 'http://localhost:4000'));
  assert.throws(() => validateVariantApi('preview', 'http://10.0.2.2:4000'));
  assert.doesNotThrow(() => validateVariantApi('preview', 'http://192.168.1.20:4000'));
  assert.doesNotThrow(() => validateVariantApi('development', 'http://localhost:4000'));
});

test('test and production Firebase client registrations must match the selected Android package', () => {
  const client = (id: string) => ({ project_info: { project_id: 'existing-project' }, client: [{ client_info: { android_client_info: { package_name: id } } }] });
  assert.doesNotThrow(() => validateFirebaseClient(client('com.rackyride.app'), 'com.rackyride.app'));
  assert.doesNotThrow(() => validateFirebaseClient(client('com.rackyride.app.test'), 'com.rackyride.app.test'));
  assert.throws(() => validateFirebaseClient(client('com.rackyride.app'), 'com.rackyride.app.test'), /must include Android package/);
  assert.throws(() => validateFirebaseClient({ type: 'service_account' }, 'com.rackyride.app.test'));
});
