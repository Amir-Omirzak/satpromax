/**
 * Seeds an admin account and the SAT Fundamentals course.
 *
 *   SEED_ADMIN_EMAIL=you@example.com SEED_ADMIN_PASSWORD='...' npm run seed
 *
 * Safe to run more than once. Only the first five lessons are filled in; the
 * remaining eight can be added through POST /courses/:id/lessons.
 */
import { migrate } from '../db/migrate.js';
import { createPool } from '../db/pool.js';
import { hashPassword } from '../http/auth.js';

const { DATABASE_URL, SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD } = process.env;
if (!DATABASE_URL) throw new Error('DATABASE_URL is required');
if (!SEED_ADMIN_EMAIL || !SEED_ADMIN_PASSWORD || SEED_ADMIN_PASSWORD.length < 8) {
  throw new Error('Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD (8+ characters)');
}

const lessons: [title: string, duration: string][] = [
  ['Factorization', '30:46'],
  ['Radicals and Exponents', '40:57'],
  ['Percents', '27:13'],
  ['Linear Equations', '40:28'],
  ['Exponential Graphs', '23:56'],
];
const toSeconds = (mmss: string) => {
  const [m, s] = mmss.split(':').map(Number);
  return m! * 60 + s!;
};

const db = createPool(DATABASE_URL);
try {
  await migrate(db);

  await db.query(
    `INSERT INTO users (email, password_hash, full_name, role) VALUES ($1, $2, 'Admin', 'admin')
     ON CONFLICT ((lower(email))) DO NOTHING`,
    [SEED_ADMIN_EMAIL.toLowerCase(), await hashPassword(SEED_ADMIN_PASSWORD)],
  );

  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO courses (slug, title, subtitle)
     VALUES ('sat-fundamentals', 'SAT Fundamentals', 'The Ultimate 750+ Guide')
     ON CONFLICT (slug) DO UPDATE SET title = EXCLUDED.title
     RETURNING id`,
  );
  const courseId = rows[0]!.id;

  for (const [i, [title, duration]] of lessons.entries()) {
    await db.query(
      `INSERT INTO lessons (course_id, position, title, duration_sec) VALUES ($1, $2, $3, $4)
       ON CONFLICT (course_id, position) DO NOTHING`,
      [courseId, i + 1, title, toSeconds(duration)],
    );
  }
  console.log(`Seeded admin ${SEED_ADMIN_EMAIL} and course "SAT Fundamentals" (${lessons.length} lessons)`);
} finally {
  await db.end();
}
