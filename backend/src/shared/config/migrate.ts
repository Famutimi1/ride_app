import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { db } from './db';

async function migrate() {
  const directory = resolve(process.cwd(), 'migrations');
  const lock=await db.connect();
  try {
  await lock.query("SET lock_timeout='10s'");
  await lock.query("SELECT pg_advisory_lock(hashtext('rakky_schema_migrations'))");
  await lock.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    filename TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  const files = (await readdir(directory)).filter((file) => /^\d+_.*\.sql$/.test(file)).sort();
  for (const filename of files) {
    const applied = await lock.query('SELECT 1 FROM schema_migrations WHERE filename=$1', [filename]);
    if (applied.rowCount) continue;
    const sql = await readFile(resolve(directory, filename), 'utf8');
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
      await client.query('COMMIT');
      console.info(`Migration applied: ${filename}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  } finally {
    try {await lock.query("SELECT pg_advisory_unlock(hashtext('rakky_schema_migrations'))");}
    finally {lock.release();await db.end();}
  }
}
migrate().catch(async(error)=>{const value=error as {message?:string;code?:string;errors?:Array<{code?:string}>};console.error(value.message||value.code||value.errors?.[0]?.code||'Migration failed');try{await db.end();}catch{}process.exitCode=1;});
