import { Router } from 'express';
import { z } from 'zod';
import type { Db } from '../db/pool.js';
import { currentUser, hashPassword, type Role, type TokenService, verifyPassword } from '../http/auth.js';
import { conflict, notFound, unauthorized } from '../http/errors.js';
import { Email, NonEmpty, Password } from '../http/validation.js';

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  full_name: string;
  role: Role;
  curator_id: string | null;
  goal_score: number;
  created_at: Date;
}

export const toUserDto = (u: UserRow) => ({
  id: u.id,
  email: u.email,
  fullName: u.full_name,
  role: u.role,
  curatorId: u.curator_id,
  goalScore: u.goal_score,
  createdAt: u.created_at,
});

const RegisterBody = z.object({ email: Email, password: Password, fullName: NonEmpty(120) });
const LoginBody = z.object({ email: Email, password: z.string().min(1) });
const UpdateMeBody = z
  .object({
    fullName: NonEmpty(120).optional(),
    goalScore: z.number().int().min(200).max(800).multipleOf(10).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, 'Nothing to update');

/** Public routes: sign up and log in. */
export function authRoutes(db: Db, tokens: TokenService): Router {
  const r = Router();

  r.post('/register', async (req, res) => {
    const body = RegisterBody.parse(req.body);
    const passwordHash = await hashPassword(body.password);
    try {
      // New accounts are always students; admins promote curators.
      const { rows } = await db.query<UserRow>(
        `INSERT INTO users (email, password_hash, full_name) VALUES ($1, $2, $3) RETURNING *`,
        [body.email, passwordHash, body.fullName],
      );
      const user = rows[0]!;
      res.status(201).json({ token: tokens.sign(user), user: toUserDto(user) });
    } catch (err) {
      if ((err as { code?: string }).code === '23505') throw conflict('An account with this email already exists');
      throw err;
    }
  });

  r.post('/login', async (req, res) => {
    const body = LoginBody.parse(req.body);
    const { rows } = await db.query<UserRow>('SELECT * FROM users WHERE lower(email) = $1', [body.email]);
    const user = rows[0];
    // Same error for unknown email and wrong password, so emails can't be probed.
    if (!user || !(await verifyPassword(body.password, user.password_hash))) {
      throw unauthorized('Wrong email or password');
    }
    res.json({ token: tokens.sign(user), user: toUserDto(user) });
  });

  return r;
}

/** Authenticated routes about the current user. */
export function meRoutes(db: Db): Router {
  const r = Router();

  r.get('/', async (req, res) => {
    const { rows } = await db.query<UserRow>('SELECT * FROM users WHERE id = $1', [currentUser(req).id]);
    if (!rows[0]) throw notFound('User');
    res.json(toUserDto(rows[0]));
  });

  r.patch('/', async (req, res) => {
    const body = UpdateMeBody.parse(req.body);
    const { rows } = await db.query<UserRow>(
      `UPDATE users
          SET full_name  = COALESCE($2, full_name),
              goal_score = COALESCE($3, goal_score)
        WHERE id = $1
        RETURNING *`,
      [currentUser(req).id, body.fullName ?? null, body.goalScore ?? null],
    );
    if (!rows[0]) throw notFound('User');
    res.json(toUserDto(rows[0]));
  });

  return r;
}
