-- Users of the platform. Curators are assigned to students via curator_id.
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL,
  password_hash text NOT NULL,
  full_name     text NOT NULL,
  role          text NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'curator', 'admin')),
  curator_id    uuid REFERENCES users (id) ON DELETE SET NULL,
  goal_score    integer NOT NULL DEFAULT 750 CHECK (goal_score BETWEEN 200 AND 800),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email));
CREATE INDEX users_curator_id_idx ON users (curator_id);

CREATE TABLE courses (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug       text NOT NULL UNIQUE,
  title      text NOT NULL,
  subtitle   text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE lessons (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id    uuid NOT NULL REFERENCES courses (id) ON DELETE CASCADE,
  position     integer NOT NULL CHECK (position > 0),
  title        text NOT NULL,
  duration_sec integer NOT NULL CHECK (duration_sec > 0),
  video_url    text,
  summary      text NOT NULL DEFAULT '',
  -- [{ "title": "...", "url": "..." }]
  materials    jsonb NOT NULL DEFAULT '[]'::jsonb,
  UNIQUE (course_id, position)
);

-- Practice problems attached to a lesson. The answer is never sent to students.
CREATE TABLE tasks (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id uuid NOT NULL REFERENCES lessons (id) ON DELETE CASCADE,
  position  integer NOT NULL CHECK (position > 0),
  prompt    text NOT NULL,
  answer    text NOT NULL,
  UNIQUE (lesson_id, position)
);

CREATE TABLE task_attempts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id      uuid NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  student_id   uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  answer       text NOT NULL,
  is_correct   boolean NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX task_attempts_student_idx ON task_attempts (student_id, task_id);

CREATE TABLE enrollments (
  student_id  uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  course_id   uuid NOT NULL REFERENCES courses (id) ON DELETE CASCADE,
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (student_id, course_id)
);

CREATE TABLE lesson_progress (
  student_id   uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  lesson_id    uuid NOT NULL REFERENCES lessons (id) ON DELETE CASCADE,
  watched_sec  integer NOT NULL DEFAULT 0 CHECK (watched_sec >= 0),
  completed_at timestamptz,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (student_id, lesson_id)
);

CREATE TABLE mock_tests (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  score      integer NOT NULL CHECK (score BETWEEN 200 AND 800 AND score % 10 = 0),
  taken_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mock_tests_student_idx ON mock_tests (student_id, taken_at DESC);

-- Questions a student asks the curator about a lesson.
CREATE TABLE questions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id   uuid NOT NULL REFERENCES lessons (id) ON DELETE CASCADE,
  student_id  uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  body        text NOT NULL,
  answer      text,
  answered_by uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  answered_at timestamptz
);
CREATE INDEX questions_student_idx ON questions (student_id, created_at DESC);
CREATE INDEX questions_open_idx ON questions (created_at) WHERE answer IS NULL;

-- One running comment per student from their curator ("Комментарий куратора").
CREATE TABLE curator_notes (
  student_id uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  curator_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  body       text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
