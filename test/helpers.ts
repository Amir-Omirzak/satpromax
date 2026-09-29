import { randomUUID } from 'node:crypto';
import pg from 'pg';
import request from 'supertest';
import { afterAll, inject } from 'vitest';
import { createApp } from '../src/app.js';
import { migrate } from '../src/db/migrate.js';
import { createPool, type Db } from '../src/db/pool.js';
import { createTokenService, hashPassword, type Role } from '../src/http/auth.js';

/** Creates a fresh, migrated database for one test file and an app wired to it. */
export async function setupTestApp() {
  const adminUrl = inject('adminDatabaseUrl');
  const name = `test_${randomUUID().replaceAll('-', '')}`;

  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();

  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const db = createPool(url.toString());
  await migrate(db);

  const tokens = createTokenService('test-secret-that-is-long-enough-for-hs256-signing', '1h');
  const app = createApp({ db, tokens });
  afterAll(() => db.end());

  return { app, db, tokens, api: () => request(app) };
}

let counter = 0;

/** Inserts a user directly (bypassing /auth/register) and returns a bearer token for them. */
export async function createUser(
  ctx: { db: Db; tokens: ReturnType<typeof createTokenService> },
  role: Role = 'student',
  extra: { curatorId?: string } = {},
) {
  counter += 1;
  const email = `${role}${counter}@example.com`;
  const { rows } = await ctx.db.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name, role, curator_id)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [email, await hashPassword('password123'), `${role} ${counter}`, role, extra.curatorId ?? null],
  );
  const id = rows[0]!.id;
  return { id, email, auth: `Bearer ${ctx.tokens.sign({ id, role })}` };
}

/** A course with `n` lessons of 600s each. */
export async function createCourse(db: Db, n = 3) {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO courses (slug, title) VALUES ($1, 'SAT Fundamentals') RETURNING id`,
    [`course-${randomUUID().slice(0, 8)}`],
  );
  const courseId = rows[0]!.id;
  const lessonIds: string[] = [];
  for (let i = 1; i <= n; i++) {
    const { rows: l } = await db.query<{ id: string }>(
      `INSERT INTO lessons (course_id, position, title, duration_sec) VALUES ($1, $2, $3, 600) RETURNING id`,
      [courseId, i, `Lesson ${i}`],
    );
    lessonIds.push(l[0]!.id);
  }
  return { courseId, lessonIds };
}
