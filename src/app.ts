import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import type { Db } from './db/pool.js';
import { requireAuth, type TokenService } from './http/auth.js';
import { errorHandler, notFoundHandler } from './http/errors.js';
import { authRoutes, meRoutes } from './routes/auth.routes.js';
import { courseRoutes } from './routes/courses.routes.js';
import { adminRoutes, curatorRoutes } from './routes/curator.routes.js';
import { lessonRoutes, taskRoutes } from './routes/lessons.routes.js';
import { studentRoutes } from './routes/student.routes.js';

export interface AppDeps {
  db: Db;
  tokens: TokenService;
}

export function createApp({ db, tokens }: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', async (_req, res) => {
    await db.query('SELECT 1');
    res.json({ status: 'ok' });
  });

  app.use('/auth', authRoutes(db, tokens));

  const auth = requireAuth(tokens);
  app.use('/me', auth, meRoutes(db), studentRoutes(db));
  app.use('/courses', auth, courseRoutes(db));
  app.use('/lessons', auth, lessonRoutes(db));
  app.use('/tasks', auth, taskRoutes(db));
  app.use('/curator', auth, curatorRoutes(db));
  app.use('/admin', auth, adminRoutes(db));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
