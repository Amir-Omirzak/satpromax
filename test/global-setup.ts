/**
 * Starts a throwaway PostgreSQL server once for the whole test run, so
 * `npm test` works without Docker or a local database.
 */
import { rm } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    adminDatabaseUrl: string;
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}

export default async function setup(project: TestProject) {
  const port = await freePort();
  const databaseDir = path.resolve(import.meta.dirname, '../.pg-test', String(port));
  const pg = new EmbeddedPostgres({
    databaseDir,
    port,
    user: 'postgres',
    password: 'postgres',
    persistent: false,
    onLog: () => {},
  });
  await pg.initialise();
  await pg.start();
  project.provide('adminDatabaseUrl', `postgres://postgres:postgres@127.0.0.1:${port}/postgres`);

  return async () => {
    await pg.stop();
    await rm(databaseDir, { recursive: true, force: true });
  };
}
