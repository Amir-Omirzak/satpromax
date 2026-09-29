import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { RequestHandler } from 'express';
import { forbidden, unauthorized } from './errors.js';

export type Role = 'student' | 'curator' | 'admin';

export interface AuthUser {
  id: string;
  role: Role;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

const BCRYPT_ROUNDS = 10;

export const hashPassword = (password: string) => bcrypt.hash(password, BCRYPT_ROUNDS);
export const verifyPassword = (password: string, hash: string) => bcrypt.compare(password, hash);

export interface TokenService {
  sign(user: AuthUser): string;
  verify(token: string): AuthUser;
}

export function createTokenService(secret: string, expiresIn: string): TokenService {
  return {
    sign: (user) =>
      jwt.sign({ role: user.role }, secret, {
        subject: user.id,
        expiresIn: expiresIn as jwt.SignOptions['expiresIn'],
        algorithm: 'HS256',
      }),
    verify: (token) => {
      const payload = jwt.verify(token, secret, { algorithms: ['HS256'] });
      if (typeof payload === 'string' || !payload.sub || typeof payload.role !== 'string') {
        throw unauthorized('Invalid token');
      }
      return { id: payload.sub, role: payload.role as Role };
    },
  };
}

/** Reads `Authorization: Bearer <token>` and puts the user on `req.user`. */
export function requireAuth(tokens: TokenService): RequestHandler {
  return (req, _res, next) => {
    const header = req.get('authorization') ?? '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) return next(unauthorized());
    try {
      req.user = tokens.verify(token);
      next();
    } catch {
      next(unauthorized('Invalid or expired token'));
    }
  };
}

export function requireRole(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden());
    next();
  };
}

/** Narrowing helper for handlers mounted behind requireAuth. */
export function currentUser(req: Express.Request): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}

export const isStaff = (user: AuthUser) => user.role === 'curator' || user.role === 'admin';
