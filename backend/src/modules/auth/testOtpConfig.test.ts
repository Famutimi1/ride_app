import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

test('shared OTP configuration requires explicit valid settings and supports production runtime', async (t) => {
  // The isolated runner builds dist first. A clean cwd prevents the developer's
  // .env from supplying missing settings to these separate startup processes.
  const directory = mkdtempSync(join(tmpdir(), 'rakky-otp-config-'));
  const configPath = resolve('dist/config/env.js');
  const startup = (settings: Record<string, string>) => {
    const childEnv = { ...process.env };
    delete childEnv.TEST_OTP_ENABLED;
    delete childEnv.TEST_OTP_CODE;
    return spawnSync(process.execPath, ['-e',
      `const { env } = require(${JSON.stringify(configPath)}); console.log(JSON.stringify({ enabled: env.TEST_OTP_ENABLED, code: env.TEST_OTP_CODE }));`,
    ], {
      cwd: directory, encoding: 'utf8',
      env: { ...childEnv, NODE_ENV: 'production', JWT_ACCESS_SECRET: 'test-only-strong-access-secret-for-otp-config', PAYSTACK_BASE_URL: 'https://api.paystack.co', ...settings },
    });
  };
  try {
    await t.test('defaults to disabled in production', () => {
      const result = startup({});
      assert.equal(result.status, 0, result.stderr);
      assert.ok(result.stdout.includes('"enabled":false'));
      assert.equal(result.stderr.includes('Shared test OTP enabled'), false);
    });
    await t.test('explicit production opt-in works and announces the testing mode', () => {
      const result = startup({ TEST_OTP_ENABLED: 'true', TEST_OTP_CODE: '666666' });
      assert.equal(result.status, 0, result.stderr);
      assert.ok(result.stdout.includes('"enabled":true'));
      assert.ok(result.stderr.includes('Shared test OTP enabled'));
    });
    await t.test('missing and malformed codes prevent startup when enabled', () => {
      for (const code of ['', '66666', '6666666', 'abcdef', ' 666666']) {
        const result = startup({ TEST_OTP_ENABLED: 'true', TEST_OTP_CODE: code });
        assert.notEqual(result.status, 0);
        assert.ok(result.stderr.includes('TEST_OTP_CODE must contain exactly six digits'));
      }
    });
    await t.test('ambiguous flags prevent startup, while false disables a retained code', () => {
      assert.notEqual(startup({ TEST_OTP_ENABLED: '1', TEST_OTP_CODE: '666666' }).status, 0);
      const result = startup({ TEST_OTP_ENABLED: 'false', TEST_OTP_CODE: '666666' });
      assert.equal(result.status, 0, result.stderr);
      assert.ok(result.stdout.includes('"enabled":false'));
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
