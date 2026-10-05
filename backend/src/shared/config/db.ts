import { Pool, type PoolClient } from 'pg';
import { env } from '../../config/env';

export const db = new Pool({ connectionString: env.DATABASE_URL });

export async function inTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
