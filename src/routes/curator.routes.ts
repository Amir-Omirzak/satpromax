import { Router } from 'express';
import { z } from 'zod';
import type { Db } from '../db/pool.js';
import { type AuthUser, currentUser, requireRole } from '../http/auth.js';
import { badRequest, conflict, notFound } from '../http/errors.js';
import { idParam, NonEmpty, Uuid } from '../http/validation.js';
import { toUserDto } from './auth.routes.js';
import { assertCanManageStudent } from '../services/access.js';

const QuestionsQuery = z.object({ status: z.enum(['open', 'answered', 'all']).default('open') });
const AnswerBody = z.object({ answer: NonEmpty(4_000) });
const NoteBody = z.object({ body: NonEmpty(4_000) });
const UpdateUserBody = z
  .object({
    role: z.enum(['student', 'curator', 'admin']).optional(),
    curatorId: Uuid.nullable().optional(),
  })
  .refine((b) => b.role !== undefined || b.curatorId !== undefined, 'Nothing to update');

/** Curators see only their own students; admins see everyone. `$1` is the user id. */
const scopeToCurator = (user: AuthUser, column: string) =>
  user.role === 'admin' ? 'TRUE' : `${column} = $1`;

export function curatorRoutes(db: Db): Router {
  const r = Router();
  r.use(requireRole('curator', 'admin'));

  // "Мои ученики": progress summary per student.
  r.get('/students', async (req, res) => {
    const user = currentUser(req);
    const { rows } = await db.query(
      `SELECT s.id, s.full_name AS "fullName", s.email, s.goal_score AS "goalScore",
              (SELECT count(*)::int FROM lesson_progress p WHERE p.student_id = s.id AND p.completed_at IS NOT NULL) AS "lessonsCompleted",
              (SELECT score FROM mock_tests m WHERE m.student_id = s.id ORDER BY taken_at DESC LIMIT 1) AS "lastMockScore",
              (SELECT count(*)::int FROM questions q WHERE q.student_id = s.id AND q.answer IS NULL) AS "openQuestions"
         FROM users s
        WHERE s.role = 'student' AND ${scopeToCurator(user, 's.curator_id')}
        ORDER BY s.full_name`,
      user.role === 'admin' ? [] : [user.id],
    );
    res.json(rows);
  });

  r.get('/questions', async (req, res) => {
    const user = currentUser(req);
    const { status } = QuestionsQuery.parse(req.query);
    const statusFilter = { open: 'q.answer IS NULL', answered: 'q.answer IS NOT NULL', all: 'TRUE' }[status];
    const { rows } = await db.query(
      `SELECT q.id, q.body, q.answer, q.created_at AS "createdAt", q.answered_at AS "answeredAt",
              s.id AS "studentId", s.full_name AS "studentName",
              l.id AS "lessonId", l.title AS "lessonTitle"
         FROM questions q
         JOIN users s   ON s.id = q.student_id
         JOIN lessons l ON l.id = q.lesson_id
        WHERE ${statusFilter} AND ${scopeToCurator(user, 's.curator_id')}
        ORDER BY q.created_at`,
      user.role === 'admin' ? [] : [user.id],
    );
    res.json(rows);
  });

  r.post('/questions/:questionId/answer', async (req, res) => {
    const user = currentUser(req);
    const questionId = idParam(req, 'questionId');
    const { answer } = AnswerBody.parse(req.body);

    const { rows } = await db.query<{ student_id: string; answer: string | null }>(
      'SELECT student_id, answer FROM questions WHERE id = $1',
      [questionId],
    );
    const question = rows[0];
    if (!question) throw notFound('Question');
    await assertCanManageStudent(db, user, question.student_id);

    // The WHERE guard makes answering idempotent-safe under concurrent curators.
    const { rows: updated } = await db.query(
      `UPDATE questions SET answer = $2, answered_by = $3, answered_at = now()
        WHERE id = $1 AND answer IS NULL
        RETURNING id, body, answer, answered_at AS "answeredAt"`,
      [questionId, answer, user.id],
    );
    if (!updated[0]) throw conflict('This question has already been answered');
    res.json(updated[0]);
  });

  // "Комментарий куратора" shown on the student's dashboard.
  r.put('/students/:studentId/note', async (req, res) => {
    const user = currentUser(req);
    const studentId = idParam(req, 'studentId');
    const { body } = NoteBody.parse(req.body);
    await assertCanManageStudent(db, user, studentId);
    const { rows } = await db.query(
      `INSERT INTO curator_notes (student_id, curator_id, body) VALUES ($1, $2, $3)
       ON CONFLICT (student_id) DO UPDATE SET curator_id = $2, body = $3, updated_at = now()
       RETURNING body, updated_at AS "updatedAt"`,
      [studentId, user.id, body],
    );
    res.json(rows[0]);
  });

  return r;
}

export function adminRoutes(db: Db): Router {
  const r = Router();
  r.use(requireRole('admin'));

  r.get('/users', async (_req, res) => {
    const { rows } = await db.query('SELECT * FROM users ORDER BY created_at');
    res.json(rows.map(toUserDto));
  });

  // Promote someone to curator, or assign a student to a curator.
  r.patch('/users/:userId', async (req, res) => {
    const userId = idParam(req, 'userId');
    const body = UpdateUserBody.parse(req.body);

    if (body.curatorId) {
      const { rows } = await db.query<{ role: string }>('SELECT role FROM users WHERE id = $1', [body.curatorId]);
      if (rows[0]?.role !== 'curator') throw badRequest('curatorId must belong to a curator');
      if (body.curatorId === userId) throw badRequest('A user cannot be their own curator');
    }

    const { rows } = await db.query(
      `UPDATE users
          SET role       = COALESCE($2, role),
              curator_id = CASE WHEN $3 THEN $4::uuid ELSE curator_id END
        WHERE id = $1
        RETURNING *`,
      [userId, body.role ?? null, body.curatorId !== undefined, body.curatorId ?? null],
    );
    if (!rows[0]) throw notFound('User');
    res.json(toUserDto(rows[0]));
  });

  return r;
}
