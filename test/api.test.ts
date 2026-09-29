import { beforeAll, describe, expect, it } from 'vitest';
import { createCourse, createUser, setupTestApp } from './helpers.js';

const ctx = await setupTestApp();
const { api } = ctx;

describe('auth', () => {
  it('registers a student and logs in with any email casing', async () => {
    const reg = await api()
      .post('/auth/register')
      .send({ email: 'Amir@Example.com', password: 'supersecret', fullName: 'Amir' });
    expect(reg.status).toBe(201);
    expect(reg.body.user).toMatchObject({ email: 'amir@example.com', role: 'student', goalScore: 750 });
    expect(reg.body.user).not.toHaveProperty('passwordHash');

    const login = await api().post('/auth/login').send({ email: 'AMIR@example.com', password: 'supersecret' });
    expect(login.status).toBe(200);

    const me = await api().get('/me').set('Authorization', `Bearer ${login.body.token}`);
    expect(me.body.email).toBe('amir@example.com');
  });

  it('rejects a duplicate email', async () => {
    const body = { email: 'dup@example.com', password: 'supersecret', fullName: 'A' };
    await api().post('/auth/register').send(body);
    const again = await api().post('/auth/register').send({ ...body, email: 'DUP@example.com' });
    expect(again.status).toBe(409);
  });

  it('returns the same error for unknown email and wrong password', async () => {
    const unknown = await api().post('/auth/login').send({ email: 'nobody@example.com', password: 'x' });
    const wrong = await api().post('/auth/login').send({ email: 'amir@example.com', password: 'wrongpass' });
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
  });

  it('validates input', async () => {
    const res = await api().post('/auth/register').send({ email: 'not-an-email', password: '123', fullName: '' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_failed');
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toEqual(
      expect.arrayContaining(['email', 'password', 'fullName']),
    );
  });

  it('requires a valid token', async () => {
    expect((await api().get('/me')).status).toBe(401);
    expect((await api().get('/me').set('Authorization', 'Bearer nope')).status).toBe(401);
  });
});

describe('courses and lessons', () => {
  let course: Awaited<ReturnType<typeof createCourse>>;
  let student: Awaited<ReturnType<typeof createUser>>;

  beforeAll(async () => {
    course = await createCourse(ctx.db, 3);
    student = await createUser(ctx);
  });

  it('hides lessons until the student enrolls', async () => {
    const lessonId = course.lessonIds[0]!;
    expect((await api().get(`/lessons/${lessonId}`).set('Authorization', student.auth)).status).toBe(403);

    const enroll = await api().post(`/courses/${course.courseId}/enroll`).set('Authorization', student.auth);
    expect(enroll.status).toBe(201);
    const again = await api().post(`/courses/${course.courseId}/enroll`).set('Authorization', student.auth);
    expect(again.status).toBe(200);

    const lesson = await api().get(`/lessons/${lessonId}`).set('Authorization', student.auth);
    expect(lesson.status).toBe(200);
    expect(lesson.body).toMatchObject({ position: 1, previousLessonId: null, nextLessonId: course.lessonIds[1] });
  });

  it('lists courses with totals', async () => {
    const res = await api().get('/courses').set('Authorization', student.auth);
    const mine = res.body.find((c: { id: string }) => c.id === course.courseId);
    expect(mine).toMatchObject({ lessonsCount: 3, totalDurationSec: 1800, enrolled: true });
  });

  it('tracks progress from the video player', async () => {
    const lessonId = course.lessonIds[0]!;
    const put = (body: object) =>
      api().put(`/lessons/${lessonId}/progress`).set('Authorization', student.auth).send(body);

    expect((await put({ watchedSec: 300 })).body).toMatchObject({ watchedSec: 300, completed: false });
    expect((await put({ watchedSec: 100 })).body).toMatchObject({ watchedSec: 300 });
    expect((await put({ watchedSec: 560 })).body).toMatchObject({ watchedSec: 560, completed: true });

    const page = await api().get(`/courses/${course.courseId}`).set('Authorization', student.auth);
    expect(page.body.lessons[0]).toMatchObject({ watchedSec: 560, completed: true });
    expect(page.body.lessons[1]).toMatchObject({ watchedSec: 0, completed: false });
  });

  it('returns 404 for unknown ids and 400 for malformed ones', async () => {
    const unknown = await api().get('/lessons/00000000-0000-4000-8000-000000000000').set('Authorization', student.auth);
    expect(unknown.status).toBe(404);
    const malformed = await api().get('/lessons/123').set('Authorization', student.auth);
    expect(malformed.status).toBe(400);
  });
});

describe('tasks', () => {
  it('grades answers without leaking the correct one to students', async () => {
    const { courseId, lessonIds } = await createCourse(ctx.db, 1);
    const admin = await createUser(ctx, 'admin');
    const student = await createUser(ctx);
    await api().post(`/courses/${courseId}/enroll`).set('Authorization', student.auth);

    const task = await api()
      .post(`/lessons/${lessonIds[0]}/tasks`)
      .set('Authorization', admin.auth)
      .send({ position: 1, prompt: 'Factor x^2 - 9. What is the positive root?', answer: '3' });
    expect(task.status).toBe(201);

    const lesson = await api().get(`/lessons/${lessonIds[0]}`).set('Authorization', student.auth);
    expect(lesson.body.tasks[0]).not.toHaveProperty('answer');
    expect(lesson.body.tasks[0].solved).toBe(false);

    const attempt = (answer: string) =>
      api().post(`/tasks/${task.body.id}/attempts`).set('Authorization', student.auth).send({ answer });
    expect((await attempt('9')).body).toEqual({ taskId: task.body.id, correct: false });
    expect((await attempt('3.0')).body).toEqual({ taskId: task.body.id, correct: true });

    const after = await api().get(`/lessons/${lessonIds[0]}`).set('Authorization', student.auth);
    expect(after.body.tasks[0].solved).toBe(true);
  });

  it('only lets admins create content', async () => {
    const { lessonIds } = await createCourse(ctx.db, 1);
    const student = await createUser(ctx);
    const res = await api()
      .post(`/lessons/${lessonIds[0]}/tasks`)
      .set('Authorization', student.auth)
      .send({ position: 1, prompt: 'x', answer: '1' });
    expect(res.status).toBe(403);
  });
});

describe('student dashboard', () => {
  it('matches the "Мой прогресс" screen', async () => {
    const { courseId, lessonIds } = await createCourse(ctx.db, 3);
    const curator = await createUser(ctx, 'curator');
    const student = await createUser(ctx, 'student', { curatorId: curator.id });
    const as = (u: { auth: string }) => ({ Authorization: u.auth });

    await api().post(`/courses/${courseId}/enroll`).set(as(student));
    await api().put(`/lessons/${lessonIds[0]}/progress`).set(as(student)).send({ watchedSec: 600 });
    await api().put(`/lessons/${lessonIds[1]}/progress`).set(as(student)).send({ watchedSec: 120 });
    await api().post('/me/mock-tests').set(as(student)).send({ score: 680 });
    await api().put(`/curator/students/${student.id}/note`).set(as(curator)).send({ body: 'Повтори проценты' });

    const res = await api().get('/me/dashboard').set(as(student));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      course: { id: courseId },
      lessonsCompleted: 1,
      lessonsTotal: 3,
      timeLearnedSec: 720,
      courseDurationSec: 1800,
      goalScore: 750,
      lastMockTest: { score: 680 },
      nextLesson: { id: lessonIds[1], position: 2 },
      curatorComment: { body: 'Повтори проценты' },
    });
  });

  it('rejects impossible SAT scores', async () => {
    const student = await createUser(ctx);
    const res = await api().post('/me/mock-tests').set('Authorization', student.auth).send({ score: 805 });
    expect(res.status).toBe(400);
  });

  it('is only for students', async () => {
    const curator = await createUser(ctx, 'curator');
    expect((await api().get('/me/dashboard').set('Authorization', curator.auth)).status).toBe(403);
    // ...but /me itself works for every role
    expect((await api().get('/me').set('Authorization', curator.auth)).status).toBe(200);
  });
});

describe('curator Q&A', () => {
  it("lets a curator answer only their own students' questions", async () => {
    const { courseId, lessonIds } = await createCourse(ctx.db, 1);
    const curator = await createUser(ctx, 'curator');
    const otherCurator = await createUser(ctx, 'curator');
    const student = await createUser(ctx, 'student', { curatorId: curator.id });
    await api().post(`/courses/${courseId}/enroll`).set('Authorization', student.auth);

    const asked = await api()
      .post(`/lessons/${lessonIds[0]}/questions`)
      .set('Authorization', student.auth)
      .send({ body: 'Почему в задаче 2 ответ 3, а не -3?' });
    expect(asked.status).toBe(201);

    const inbox = await api().get('/curator/questions').set('Authorization', curator.auth);
    expect(inbox.body.map((q: { id: string }) => q.id)).toContain(asked.body.id);
    const otherInbox = await api().get('/curator/questions').set('Authorization', otherCurator.auth);
    expect(otherInbox.body.map((q: { id: string }) => q.id)).not.toContain(asked.body.id);

    const answerUrl = `/curator/questions/${asked.body.id}/answer`;
    expect((await api().post(answerUrl).set('Authorization', otherCurator.auth).send({ answer: 'x' })).status).toBe(403);
    expect((await api().post(answerUrl).set('Authorization', curator.auth).send({ answer: 'Нужен положительный корень' })).status).toBe(200);
    expect((await api().post(answerUrl).set('Authorization', curator.auth).send({ answer: 'again' })).status).toBe(409);

    const mine = await api().get('/me/questions').set('Authorization', student.auth);
    expect(mine.body[0]).toMatchObject({ answer: 'Нужен положительный корень', lessonTitle: 'Lesson 1' });

    const students = await api().get('/curator/students').set('Authorization', curator.auth);
    expect(students.body).toEqual([expect.objectContaining({ id: student.id, openQuestions: 0 })]);
  });

  it('lets an admin assign a student to a curator', async () => {
    const admin = await createUser(ctx, 'admin');
    const curator = await createUser(ctx, 'curator');
    const student = await createUser(ctx);

    const res = await api()
      .patch(`/admin/users/${student.id}`)
      .set('Authorization', admin.auth)
      .send({ curatorId: curator.id });
    expect(res.body.curatorId).toBe(curator.id);

    const bad = await api()
      .patch(`/admin/users/${student.id}`)
      .set('Authorization', admin.auth)
      .send({ curatorId: student.id });
    expect(bad.status).toBe(400);
  });
});
