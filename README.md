# SAT PRO MAX — Platform API

Backend for the SAT PRO MAX learning platform: video courses for SAT Math, student progress tracking, practice tasks, mock-test scores and a curator who answers students' questions.

**Stack:** Node.js 24 · TypeScript · Express 5 · PostgreSQL 18 · Zod · JWT · Vitest · Docker

## What it does

| Student | Curator | Admin |
|---|---|---|
| Signs up, enrolls in a course | Sees their students' progress | Creates courses, lessons, tasks |
| Watches lessons; progress is saved from the video player | Answers questions from their students | Promotes users to curators |
| Solves practice tasks, gets instant grading | Leaves a comment on a student's dashboard | Assigns students to curators |
| Logs mock-test scores, sees a progress dashboard | | |
| Asks the curator questions about a lesson | | |

## Design decisions

- **Plain SQL, no ORM.** Queries live next to the routes that use them and do their aggregation in PostgreSQL (the dashboard is five small queries run in parallel). Migrations are ordered `.sql` files applied under an advisory lock, so several instances can start at once.
- **Progress can't go backwards.** The player reports watched seconds; rewinding never erases progress, the value is capped at the lesson length, and a lesson auto-completes at 90%. Updates lock the row (`SELECT … FOR UPDATE`) so concurrent reports from the player don't overwrite each other. See `src/services/progress.ts`.
- **SAT-aware grading.** `3/4`, `.75` and `0.75` are all accepted for the same grid-in answer. Correct answers are never sent to students. See `src/services/grading.ts`.
- **Authorization lives in one place.** Students only see courses they're enrolled in; curators only see and answer their own students; admins see everything (`src/services/access.ts`).
- **Safe by default.** bcrypt password hashing, JWT pinned to HS256, identical errors for unknown email and wrong password, validated input on every route, `helmet` headers, JSON body size limit.
- **Tests run against real PostgreSQL** without Docker: the suite starts a throwaway server with `embedded-postgres` and gives every test file its own database.

## Run it

**With Docker** (API + PostgreSQL):

```bash
cp .env.example .env          # then set JWT_SECRET
docker compose up --build     # API on http://localhost:3000

# create an admin and the SAT Fundamentals course
docker compose exec -e SEED_ADMIN_EMAIL=you@example.com -e SEED_ADMIN_PASSWORD='choose-a-password' api node dist/cli/seed.js
```

**Locally** (needs a PostgreSQL you can reach via `DATABASE_URL`):

```bash
npm install
cp .env.example .env
npm run dev                   # migrations run on startup
SEED_ADMIN_EMAIL=you@example.com SEED_ADMIN_PASSWORD='choose-a-password' npm run seed
```

**Tests** (no database needed):

```bash
npm test
```

## API

All routes except `/auth/*` and `/health` need `Authorization: Bearer <token>`. Errors look like `{ "error": { "code": "...", "message": "..." } }`.

| Method | Path | Who | |
|---|---|---|---|
| POST | `/auth/register` | anyone | Create a student account → `{ token, user }` |
| POST | `/auth/login` | anyone | → `{ token, user }` |
| GET / PATCH | `/me` | any role | Profile, SAT goal score |
| GET | `/me/dashboard?courseId=` | student | Lessons done, time learned, next lesson, last mock test, curator comment |
| POST / GET | `/me/mock-tests` | student | Log / list mock-test scores (200–800) |
| GET | `/me/questions` | student | My questions and the curator's answers |
| GET | `/courses` | any role | Catalog with lesson count and total length |
| GET | `/courses/:id` | any role | Lessons with my progress |
| POST | `/courses/:id/enroll` | student | |
| POST | `/courses` · `/courses/:id/lessons` | admin | Create content |
| GET | `/lessons/:id` | enrolled / staff | Video, summary, materials, tasks, progress, prev/next |
| PUT | `/lessons/:id/progress` | student | `{ watchedSec, completed? }` from the player |
| POST | `/lessons/:id/tasks` | admin | Add a practice task |
| POST | `/lessons/:id/questions` | student | Ask the curator |
| POST | `/tasks/:id/attempts` | student | `{ answer }` → `{ correct }` |
| GET | `/curator/students` | curator, admin | Progress summary per student |
| GET | `/curator/questions?status=open\|answered\|all` | curator, admin | |
| POST | `/curator/questions/:id/answer` | curator, admin | |
| PUT | `/curator/students/:id/note` | curator, admin | Comment shown on the student's dashboard |
| GET / PATCH | `/admin/users[/:id]` | admin | Change role, assign curator |

## Project layout

```
migrations/        SQL schema, applied in order
src/
  app.ts           Express app and route wiring
  server.ts        Entry point: config, migrations, graceful shutdown
  routes/          HTTP handlers grouped by area
  services/        Access rules, grading, progress logic
  http/            Auth, validation, error handling
  db/              Connection pool, transactions, migration runner
test/              Unit tests and end-to-end API tests
```
