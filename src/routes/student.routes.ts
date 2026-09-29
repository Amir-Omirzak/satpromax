import { Router } from 'express';
import { z } from 'zod';
import type { Db } from '../db/pool.js';
import { currentUser, requireRole } from '../http/auth.js';
import { notFound } from '../http/errors.js';
import { Uuid } from '../http/validation.js';

const DashboardQuery = z.object({ courseId: Uuid.optional() });
const MockTestBody = z.object({
  score: z.number().int().min(200).max(800).multipleOf(10, 'SAT section scores go in steps of 10'),
});

/** Student-only routes under /me: the "Мой прогресс" dashboard, mock tests, my questions. */
export function studentRoutes(db: Db): Router {
  const r = Router();
  // Per-route guard: this router shares the /me prefix with routes open to every role.
  const studentOnly = requireRole('student');

  r.get('/dashboard', studentOnly, async (req, res) => {
    const user = currentUser(req);
    const { courseId: requested } = DashboardQuery.parse(req.query);

    // Default to the course the student enrolled in most recently.
    const { rows: courses } = await db.query<{ id: string; title: string }>(
      `SELECT c.id, c.title
         FROM enrollments e JOIN courses c ON c.id = e.course_id
        WHERE e.student_id = $1 AND ($2::uuid IS NULL OR c.id = $2)
        ORDER BY e.enrolled_at DESC
        LIMIT 1`,
      [user.id, requested ?? null],
    );
    const course = courses[0];
    if (!course) throw notFound(requested ? 'Enrollment in this course' : 'Enrollment');

    const [stats, next, lastMock, goal, note] = await Promise.all([
      db.query(
        `SELECT count(l.id)::int                                AS "lessonsTotal",
                count(p.completed_at)::int                      AS "lessonsCompleted",
                coalesce(sum(p.watched_sec), 0)::int            AS "timeLearnedSec",
                coalesce(sum(l.duration_sec), 0)::int           AS "courseDurationSec"
           FROM lessons l
           LEFT JOIN lesson_progress p ON p.lesson_id = l.id AND p.student_id = $2
          WHERE l.course_id = $1`,
        [course.id, user.id],
      ),
      db.query(
        `SELECT l.id, l.position, l.title, l.duration_sec AS "durationSec"
           FROM lessons l
           LEFT JOIN lesson_progress p ON p.lesson_id = l.id AND p.student_id = $2
          WHERE l.course_id = $1 AND p.completed_at IS NULL
          ORDER BY l.position LIMIT 1`,
        [course.id, user.id],
      ),
      db.query(
        `SELECT score, taken_at AS "takenAt" FROM mock_tests WHERE student_id = $1 ORDER BY taken_at DESC LIMIT 1`,
        [user.id],
      ),
      db.query<{ goal_score: number }>('SELECT goal_score FROM users WHERE id = $1', [user.id]),
      db.query(
        `SELECT n.body, n.updated_at AS "updatedAt", u.full_name AS "curatorName"
           FROM curator_notes n JOIN users u ON u.id = n.curator_id
          WHERE n.student_id = $1`,
        [user.id],
      ),
    ]);

    res.json({
      course,
      ...stats.rows[0],
      nextLesson: next.rows[0] ?? null,
      lastMockTest: lastMock.rows[0] ?? null,
      goalScore: goal.rows[0]?.goal_score ?? 750,
      curatorComment: note.rows[0] ?? null,
    });
  });

  r.post('/mock-tests', studentOnly, async (req, res) => {
    const { score } = MockTestBody.parse(req.body);
    const { rows } = await db.query(
      `INSERT INTO mock_tests (student_id, score) VALUES ($1, $2) RETURNING id, score, taken_at AS "takenAt"`,
      [currentUser(req).id, score],
    );
    res.status(201).json(rows[0]);
  });

  r.get('/mock-tests', studentOnly, async (req, res) => {
    const { rows } = await db.query(
      `SELECT id, score, taken_at AS "takenAt" FROM mock_tests WHERE student_id = $1 ORDER BY taken_at DESC`,
      [currentUser(req).id],
    );
    res.json(rows);
  });

  r.get('/questions', studentOnly, async (req, res) => {
    const { rows } = await db.query(
      `SELECT q.id, q.lesson_id AS "lessonId", l.title AS "lessonTitle", q.body, q.answer,
              q.created_at AS "createdAt", q.answered_at AS "answeredAt"
         FROM questions q JOIN lessons l ON l.id = q.lesson_id
        WHERE q.student_id = $1
        ORDER BY q.created_at DESC`,
      [currentUser(req).id],
    );
    res.json(rows);
  });

  return r;
}
