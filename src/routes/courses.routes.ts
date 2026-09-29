import { Router } from 'express';
import { z } from 'zod';
import type { Db } from '../db/pool.js';
import { currentUser, requireRole } from '../http/auth.js';
import { conflict, notFound } from '../http/errors.js';
import { idParam, NonEmpty } from '../http/validation.js';
import { isEnrolled } from '../services/access.js';

const CreateCourseBody = z.object({
  slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use lowercase letters, digits and dashes'),
  title: NonEmpty(200),
  subtitle: z.string().trim().max(300).default(''),
});

const Material = z.object({ title: NonEmpty(200), url: z.url() });

const CreateLessonBody = z.object({
  position: z.number().int().positive(),
  title: NonEmpty(200),
  durationSec: z.number().int().positive(),
  videoUrl: z.url().nullable().default(null),
  summary: z.string().max(20_000).default(''),
  materials: z.array(Material).max(50).default([]),
});

const isUniqueViolation = (err: unknown) => (err as { code?: string }).code === '23505';

export function courseRoutes(db: Db): Router {
  const r = Router();

  // Catalog: every signed-in user can see which courses exist.
  r.get('/', async (req, res) => {
    const { rows } = await db.query(
      `SELECT c.id, c.slug, c.title, c.subtitle,
              count(l.id)::int                    AS "lessonsCount",
              coalesce(sum(l.duration_sec), 0)::int AS "totalDurationSec",
              EXISTS (SELECT 1 FROM enrollments e WHERE e.course_id = c.id AND e.student_id = $1) AS enrolled
         FROM courses c
         LEFT JOIN lessons l ON l.course_id = c.id
        GROUP BY c.id
        ORDER BY c.created_at`,
      [currentUser(req).id],
    );
    res.json(rows);
  });

  // Course page with its lesson list; enrolled students also get their progress per lesson.
  r.get('/:courseId', async (req, res) => {
    const courseId = idParam(req, 'courseId');
    const user = currentUser(req);
    const { rows: courses } = await db.query('SELECT id, slug, title, subtitle FROM courses WHERE id = $1', [courseId]);
    if (!courses[0]) throw notFound('Course');

    const { rows: lessons } = await db.query(
      `SELECT l.id, l.position, l.title, l.duration_sec AS "durationSec",
              coalesce(p.watched_sec, 0)   AS "watchedSec",
              p.completed_at IS NOT NULL   AS completed
         FROM lessons l
         LEFT JOIN lesson_progress p ON p.lesson_id = l.id AND p.student_id = $2
        WHERE l.course_id = $1
        ORDER BY l.position`,
      [courseId, user.id],
    );
    const enrolled = user.role === 'student' && (await isEnrolled(db, user.id, courseId));
    res.json({ ...courses[0], enrolled, lessons });
  });

  r.post('/:courseId/enroll', requireRole('student'), async (req, res) => {
    const courseId = idParam(req, 'courseId');
    const { rowCount: exists } = await db.query('SELECT 1 FROM courses WHERE id = $1', [courseId]);
    if (!exists) throw notFound('Course');
    const { rowCount } = await db.query(
      `INSERT INTO enrollments (student_id, course_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [currentUser(req).id, courseId],
    );
    res.status(rowCount ? 201 : 200).json({ courseId, enrolled: true });
  });

  r.post('/', requireRole('admin'), async (req, res) => {
    const body = CreateCourseBody.parse(req.body);
    try {
      const { rows } = await db.query(
        `INSERT INTO courses (slug, title, subtitle) VALUES ($1, $2, $3) RETURNING id, slug, title, subtitle`,
        [body.slug, body.title, body.subtitle],
      );
      res.status(201).json(rows[0]);
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict(`A course with slug "${body.slug}" already exists`);
      throw err;
    }
  });

  r.post('/:courseId/lessons', requireRole('admin'), async (req, res) => {
    const courseId = idParam(req, 'courseId');
    const body = CreateLessonBody.parse(req.body);
    const { rowCount: exists } = await db.query('SELECT 1 FROM courses WHERE id = $1', [courseId]);
    if (!exists) throw notFound('Course');
    try {
      const { rows } = await db.query(
        `INSERT INTO lessons (course_id, position, title, duration_sec, video_url, summary, materials)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, position, title, duration_sec AS "durationSec", video_url AS "videoUrl", summary, materials`,
        [courseId, body.position, body.title, body.durationSec, body.videoUrl, body.summary, JSON.stringify(body.materials)],
      );
      res.status(201).json(rows[0]);
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict(`Lesson #${body.position} already exists in this course`);
      throw err;
    }
  });

  return r;
}
