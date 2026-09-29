import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { withTransaction, type Db } from './pool.js';

const MIGRATIONS_DIR = path.resolve(import.meta.dirname, '../../migrations');

/**
 * Applies every .sql file in migrations/ that hasn't run yet, in filename order.
 * Each file runs in its own transaction; an advisory lock keeps two app
 * instances from migrating at the same time.
 */
export async function migrate(db: Db, dir = MIGRATIONS_DIR): Promise<string[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const applied: string[] = [];

  const lock = await db.connect();
  try {
    await lock.query('SELECT pg_advisory_lock(727274)');
    await lock.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const { rows } = await lock.query<{ name: string }>('SELECT name FROM schema_migrations');
    const done = new Set(rows.map((r) => r.name));

    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await readFile(path.join(dir, file), 'utf8');
      await withTransaction(db, async (tx) => {
        await tx.query(sql);
        await tx.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      });
      applied.push(file);
    }
  } finally {
    await lock.query('SELECT pg_advisory_unlock(727274)');
    lock.release();
  }
  return applied;
}
