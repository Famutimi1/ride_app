import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { AddressInfo } from 'node:net';

// This test never loads backend/.env. Its database, Redis and credentials are
// disposable and isolated under a unique Compose project, with no public ports.
async function run(args: string[], environment: NodeJS.ProcessEnv, capture = false): Promise<string> {
  const child = spawn('docker', args, {
    env: environment,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  let output = '';
  if (capture) {
    child.stdout?.on('data', (chunk: Buffer) => { output += chunk.toString(); });
    child.stderr?.on('data', (chunk: Buffer) => { output += chunk.toString(); });
  }
  return new Promise((done, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) done(output.trim());
      else reject(new Error(`Docker command failed (${code ?? 'signal'}): ${args.slice(0, 2).join(' ')}${capture ? `\n${output}` : ''}`));
    });
  });
}

async function main(): Promise<void> {
  const environment = { ...process.env };
  assert.equal(await run(['info', '--format', '{{.OSType}}'], environment, true), 'linux', 'Start a Linux Docker engine before this test.');
  const directory = await mkdtemp(join(tmpdir(), 'rakky-docker-'));
  const project = `rakky-smoke-${process.pid}-${randomBytes(4).toString('hex')}`;
  const reservation = createServer();
  await new Promise<void>((done, reject) => {
    reservation.once('error', reject);
    reservation.listen(0, '127.0.0.1', done);
  });
  const port = (reservation.address() as AddressInfo).port;
  await new Promise<void>((done, reject) => reservation.close(error => error ? reject(error) : done()));
  environment.SMOKE_POSTGRES_PASSWORD = randomBytes(24).toString('hex');
  environment.SMOKE_REDIS_PASSWORD = randomBytes(24).toString('hex');
  environment.SMOKE_JWT_ACCESS_SECRET = randomBytes(32).toString('hex');
  environment.SMOKE_HTTP_PORT = String(port);
  const envFile = join(directory, '.env.smoke');
  await writeFile(envFile, '', { mode: 0o600 });
  const prefix = ['compose', '--project-name', project, '--env-file', envFile, '-f', resolve('docker/compose.smoke.yaml')];
  const compose = (args: string[], capture = false) => run([...prefix, ...args], environment, capture);
  let started = false;
  try {
    await compose(['config', '--quiet']);
    started = true;
    console.info('[docker] Build image, migrate disposable PostgreSQL, start Redis and API.');
    await compose(['up', '--build', '--wait', '--wait-timeout', '180']);
    const base = `http://127.0.0.1:${port}`;
    assert.deepEqual(await (await fetch(`${base}/api/health/ready`, { signal: AbortSignal.timeout(5000) })).json(), { status: 'ready' });
    assert.deepEqual(await (await fetch(`${base}/api/health/live`, { signal: AbortSignal.timeout(5000) })).json(), { status: 'alive' });
    await compose(['exec', '-T', 'api', 'node', '-e', `
      const assert=require('node:assert/strict'); const fs=require('node:fs');
      assert.equal(process.getuid(),1000);
      assert.equal(fs.existsSync('/app/.env'),false);
      assert.equal(fs.existsSync('/app/src'),false);
      assert.throws(()=>require.resolve('tsx'));
      assert.throws(()=>require.resolve('typescript'));
      fs.writeFileSync('/app/.private-uploads/docker-smoke','persistent fixture',{mode:0o600});
    `]);
    console.info('[docker] Re-run compiled migrations and verify all migrations are tracked.');
    await compose(['run', '--rm', 'migrate']);
    const count = await compose(['exec', '-T', 'postgres', 'psql', '-U', 'postgres', '-d', 'rakky_smoke', '-Atc', 'SELECT count(*) FROM schema_migrations'], true);
    const migrations = (await readdir('migrations')).filter(file => /^\d+_.*\.sql$/.test(file));
    assert.equal(Number(count), migrations.length);
    console.info('[docker] Recreate API and verify private documents survive replacement.');
    await compose(['up', '--force-recreate', '--no-deps', '--wait', '--wait-timeout', '90', 'api']);
    await compose(['exec', '-T', 'api', 'node', '-e', "require('node:assert/strict').equal(require('node:fs').readFileSync('/app/.private-uploads/docker-smoke','utf8'),'persistent fixture')"]);
    console.info('[docker] Verify SIGTERM drains the compiled server successfully.');
    const container = await compose(['ps', '--quiet', 'api'], true);
    await compose(['stop', '--timeout', '30', 'api']);
    assert.equal(await run(['inspect', '--format', '{{.State.ExitCode}}', container], environment, true), '0');
    console.info('[docker] Passed: image isolation, readiness, compiled migrations, volume persistence and graceful shutdown.');
  } finally {
    try {
      if (started) await compose(['down', '--volumes', '--remove-orphans', '--timeout', '30']);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Docker smoke test failed.');
  process.exitCode = 1;
});
