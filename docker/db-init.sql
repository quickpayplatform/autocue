CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
    CREATE TYPE user_role AS ENUM ('SUBMITTER', 'OPERATOR', 'ADMIN');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'cue_status') THEN
    CREATE TYPE cue_status AS ENUM ('PENDING', 'APPROVED', 'EXECUTED', 'REJECTED', 'FAILED');
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role user_role NOT NULL,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS cues (
  id UUID PRIMARY KEY,
  cue_number INTEGER NOT NULL,
  cue_list INTEGER NOT NULL DEFAULT 1,
  fade_time FLOAT NOT NULL,
  notes TEXT,
  status cue_status NOT NULL,
  submitted_by UUID NOT NULL REFERENCES users(id),
  approved_by UUID REFERENCES users(id),
  executed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS cue_channels (
  id UUID PRIMARY KEY,
  cue_id UUID NOT NULL REFERENCES cues(id) ON DELETE CASCADE,
  channel_number INTEGER NOT NULL,
  level INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY,
  cue_id UUID REFERENCES cues(id),
  event_type TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cues_status ON cues(status);
CREATE INDEX IF NOT EXISTS idx_cue_channels_cue_id ON cue_channels(cue_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_cue_id ON audit_logs(cue_id);
