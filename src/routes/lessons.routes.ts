import { Router } from 'express';
import { z } from 'zod';
import { type Db, withTransaction } from '../db/pool.js';
import { currentUser, isStaff, requireRole } from '../http/auth.js';
import { conflict, notFound } from '../http/errors.js';
import { idParam, NonEmpty } from '../http/validation.js';
import { getLessonForUser } from '../services/access.js';
import { isCorrectAnswer } from '../services/grading.js';
import { mergeProgress } from '../services/progress.js';

const ProgressBody = z.object({
  watchedSec: z.number().min(0),
  completed: z.boolean().optional(),
});
const CreateTaskBody = z.object({
  position: z.number().int().positive(),
  prompt: NonEmpty(5_000),
  answer: NonEmpty(100),
});
const AttemptBody = z.object({ answer: NonEmpty(100) });
const QuestionBody = z.object({ body: NonEmpty(4_000) });

export function lessonRoutes(db: Db): Router {
  const r = Router();

  // Lesson page: video, summary ("Конспект"), tasks, materials, the student's progress and neighbours.
  r.get('/:lessonId', async (req, res) => {
    const user = currentUser(req);
    const lesson = await getLessonForUser(db, user, idParam(req, 'lessonId'));

    const [tasks, progress, neighbours] = await Promise.all([
      db.query(
        `SELECT t.id, t.position, t.prompt, ${isStaff(user) ? 't.answer,' : ''}
                EXISTS (SELECT 1 FROM task_attempts a
                         WHERE a.task_id = t.id AND a.student_id = $2 AND a.is_correct) AS solved
           FROM tasks t WHERE t.lesson_id = $1 ORDER BY t.position`,
        [lesson.id, user.id],
      ),
      db.query(
        `SELECT watched_sec AS "watchedSec", completed_at IS NOT NULL AS completed
           FROM lesson_progress WHERE lesson_id = $1 AND student_id = $2`,
        [lesson.id, user.id],
      ),
      db.query(
        `SELECT (SELECT id FROM lessons WHERE course_id = $1 AND position < $2 ORDER BY position DESC LIMIT 1) AS "previousLessonId",
                (SELECT id FROM lessons WHERE course_id = $1 AND position > $2 ORDER BY position ASC  LIMIT 1) AS "nextLessonId"`,
        [lesson.course_id, lesson.position],
      ),
    ]);

    res.json({
      id: lesson.id,
      courseId: lesson.course_id,
      position: lesson.position,
      title: lesson.title,
      durationSec: lesson.duration_sec,
      videoUrl: lesson.video_url,
      summary: lesson.summary,
      materials: lesson.materials,
      tasks: tasks.rows,
      progress: progress.rows[0] ?? { watchedSec: 0, completed: false },
      ...neighbours.rows[0],
    });
  });

  // Called periodically by the video player and by "Отметить как пройденный".
  r.put('/:lessonId/progress', requireRole('student'), async (req, res) => {
    const user = currentUser(req);
    const body = ProgressBody.parse(req.body);
    const lesson = await getLessonForUser(db, user, idParam(req, 'lessonId'));

    const saved = await withTransaction(db, async (tx) => {
      // Lock the row so two concurrent reports from the player can't overwrite each other.
      const { rows } = await tx.query<{ watched_sec: number; completed: boolean }>(
        `SELECT watched_sec, completed_at IS NOT NULL AS completed
           FROM lesson_progress WHERE student_id = $1 AND lesson_id = $2 FOR UPDATE`,
        [user.id, lesson.id],
      );
      const current = rows[0] && { watchedSec: rows[0].watched_sec, completed: rows[0].completed };
      const next = mergeProgress(current, body, lesson.duration_sec);
      await tx.query(
        `INSERT INTO lesson_progress (student_id, lesson_id, watched_sec, completed_at, updated_at)
         VALUES ($1, $2, $3, CASE WHEN $4 THEN now() END, now())
         ON CONFLICT (student_id, lesson_id) DO UPDATE
            SET watched_sec  = EXCLUDED.watched_sec,
                completed_at = coalesce(lesson_progress.completed_at, EXCLUDED.completed_at),
                updated_at   = now()`,
        [user.id, lesson.id, next.watchedSec, next.completed],
      );
      return next;
    });
    res.json({ lessonId: lesson.id, ...saved });
  });

  r.post('/:lessonId/tasks', requireRole('admin'), async (req, res) => {
    const lessonId = idParam(req, 'lessonId');
    const body = CreateTaskBody.parse(req.body);
    const { rowCount } = await db.query('SELECT 1 FROM lessons WHERE id = $1', [lessonId]);
    if (!rowCount) throw notFound('Lesson');
    try {
      const { rows } = await db.query(
        `INSERT INTO tasks (lesson_id, position, prompt, answer) VALUES ($1, $2, $3, $4)
         RETURNING id, position, prompt, answer`,
        [lessonId, body.position, body.prompt, body.answer],
      );
      res.status(201).json(rows[0]);
    } catch (err) {
      if ((err as { code?: string }).code === '23505') throw conflict(`Task #${body.position} already exists`);
      throw err;
    }
  });

  r.post('/:lessonId/questions', requireRole('student'), async (req, res) => {
    const user = currentUser(req);
    const lesson = await getLessonForUser(db, user, idParam(req, 'lessonId'));
    const { body } = QuestionBody.parse(req.body);
    const { rows } = await db.query(
      `INSERT INTO questions (lesson_id, student_id, body) VALUES ($1, $2, $3)
       RETURNING id, lesson_id AS "lessonId", body, answer, created_at AS "createdAt"`,
      [lesson.id, user.id, body],
    );
    res.status(201).json(rows[0]);
  });

  return r;
}

export function taskRoutes(db: Db): Router {
  const r = Router();

  // Students submit an answer; the correct answer itself is never returned.
  r.post('/:taskId/attempts', requireRole('student'), async (req, res) => {
    const user = currentUser(req);
    const taskId = idParam(req, 'taskId');
    const { answer } = AttemptBody.parse(req.body);

    const { rows } = await db.query<{ lesson_id: string; answer: string }>(
      'SELECT lesson_id, answer FROM tasks WHERE id = $1',
      [taskId],
    );
    const task = rows[0];
    if (!task) throw notFound('Task');
    await getLessonForUser(db, user, task.lesson_id);

    const correct = isCorrectAnswer(answer, task.answer);
    await db.query(`INSERT INTO task_attempts (task_id, student_id, answer, is_correct) VALUES ($1, $2, $3, $4)`, [
      taskId,
      user.id,
      answer,
      correct,
    ]);
    res.status(201).json({ taskId, correct });
  });

  return r;
}
