import type { Queryable } from '../db/pool.js';
import { type AuthUser, isStaff } from '../http/auth.js';
import { forbidden, notFound } from '../http/errors.js';

export interface LessonRow {
  id: string;
  course_id: string;
  position: number;
  title: string;
  duration_sec: number;
  video_url: string | null;
  summary: string;
  materials: { title: string; url: string }[];
}

export async function isEnrolled(db: Queryable, studentId: string, courseId: string): Promise<boolean> {
  const { rowCount } = await db.query('SELECT 1 FROM enrollments WHERE student_id = $1 AND course_id = $2', [
    studentId,
    courseId,
  ]);
  return rowCount === 1;
}

/** Staff can open any course; students only the ones they're enrolled in. */
export async function assertCourseAccess(db: Queryable, user: AuthUser, courseId: string): Promise<void> {
  if (isStaff(user)) return;
  if (!(await isEnrolled(db, user.id, courseId))) {
    throw forbidden('Enroll in this course to access its lessons');
  }
}

export async function getLessonForUser(db: Queryable, user: AuthUser, lessonId: string): Promise<LessonRow> {
  const { rows } = await db.query<LessonRow>('SELECT * FROM lessons WHERE id = $1', [lessonId]);
  const lesson = rows[0];
  if (!lesson) throw notFound('Lesson');
  await assertCourseAccess(db, user, lesson.course_id);
  return lesson;
}

/** Curators may only act on their own students; admins on anyone. */
export async function assertCanManageStudent(db: Queryable, user: AuthUser, studentId: string): Promise<void> {
  const { rows } = await db.query<{ role: string; curator_id: string | null }>(
    'SELECT role, curator_id FROM users WHERE id = $1',
    [studentId],
  );
  const student = rows[0];
  if (!student || student.role !== 'student') throw notFound('Student');
  if (user.role === 'admin') return;
  if (user.role === 'curator' && student.curator_id === user.id) return;
  throw forbidden('This student is not assigned to you');
}
