CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
    CREATE TYPE user_role AS ENUM ('SUBMITTER', 'OPERATOR', 'ADMIN', 'THEATRE_ADMIN', 'THEATRE_TECH', 'DESIGNER', 'CLIENT');
  ELSE
    BEGIN
      ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'THEATRE_ADMIN';
      ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'THEATRE_TECH';
      ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'DESIGNER';
      ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'CLIENT';
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'venue_role') THEN
    CREATE TYPE venue_role AS ENUM ('SUBMITTER', 'OPERATOR', 'ADMIN');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'cue_status') THEN
    CREATE TYPE cue_status AS ENUM ('PENDING', 'APPROVED', 'EXECUTED', 'REJECTED', 'FAILED');
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  password_hash TEXT NOT NULL,
  role user_role NOT NULL,
  theatre_id UUID,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS venues (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  patch_range_min INTEGER NOT NULL DEFAULT 1,
  patch_range_max INTEGER NOT NULL DEFAULT 512,
  locked_cue_numbers INTEGER[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS venue_users (
  id UUID PRIMARY KEY,
  venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role venue_role NOT NULL,
  created_at TIMESTAMP NOT NULL,
  UNIQUE (venue_id, user_id)
);

CREATE TABLE IF NOT EXISTS cues (
  id UUID PRIMARY KEY,
  cue_number INTEGER NOT NULL,
  cue_list INTEGER NOT NULL DEFAULT 1,
  fade_time FLOAT NOT NULL,
  notes TEXT,
  status cue_status NOT NULL,
  venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  submitted_by UUID NOT NULL REFERENCES users(id),
  approved_by UUID REFERENCES users(id),
  executed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS rig_versions (
  id UUID PRIMARY KEY,
  theatre_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  created_by_user_id UUID NOT NULL REFERENCES users(id),
  notes TEXT,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS positions (
  id UUID PRIMARY KEY,
  rig_version_id UUID NOT NULL REFERENCES rig_versions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS fixture_types (
  id UUID PRIMARY KEY,
  manufacturer TEXT NOT NULL,
  model TEXT NOT NULL,
  category TEXT NOT NULL,
  capabilities JSONB NOT NULL,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS fixture_instances (
  id UUID PRIMARY KEY,
  rig_version_id UUID NOT NULL REFERENCES rig_versions(id) ON DELETE CASCADE,
  fixture_type_id UUID NOT NULL REFERENCES fixture_types(id),
  position_id UUID NOT NULL REFERENCES positions(id),
  label TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  orientation JSONB,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS patches (
  id UUID PRIMARY KEY,
  fixture_instance_id UUID NOT NULL REFERENCES fixture_instances(id) ON DELETE CASCADE,
  protocol TEXT NOT NULL,
  universe INTEGER NOT NULL,
  address INTEGER NOT NULL,
  channel INTEGER,
  mode_name TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS groups (
  id UUID PRIMARY KEY,
  rig_version_id UUID NOT NULL REFERENCES rig_versions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS group_fixtures (
  id UUID PRIMARY KEY,
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  fixture_instance_id UUID NOT NULL REFERENCES fixture_instances(id) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL,
  UNIQUE (group_id, fixture_instance_id)
);

CREATE TABLE IF NOT EXISTS stage_backgrounds (
  id UUID PRIMARY KEY,
  rig_version_id UUID NOT NULL REFERENCES rig_versions(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  width_px INTEGER NOT NULL,
  height_px INTEGER NOT NULL,
  camera_notes TEXT,
  calibration JSONB NOT NULL,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS fixture_placements (
  id UUID PRIMARY KEY,
  fixture_instance_id UUID NOT NULL REFERENCES fixture_instances(id) ON DELETE CASCADE,
  stage_x DOUBLE PRECISION NOT NULL,
  stage_y DOUBLE PRECISION NOT NULL,
  height DOUBLE PRECISION,
  photo_x_px DOUBLE PRECISION,
  photo_y_px DOUBLE PRECISION,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS media_assets (
  id UUID PRIMARY KEY,
  uploaded_by_user_id UUID NOT NULL REFERENCES users(id),
  theatre_id UUID REFERENCES venues(id),
  type TEXT NOT NULL,
  url TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  waveform_data_url TEXT,
  video_metadata JSONB,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS autoque_sessions (
  id UUID PRIMARY KEY,
  theatre_id UUID NOT NULL REFERENCES venues(id),
  rig_version_id UUID NOT NULL REFERENCES rig_versions(id),
  created_by_user_id UUID NOT NULL REFERENCES users(id),
  status TEXT NOT NULL,
  media_asset_id UUID NOT NULL REFERENCES media_assets(id),
  theme JSONB NOT NULL,
  analysis JSONB NOT NULL,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS cue_events (
  id UUID PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES autoque_sessions(id) ON DELETE CASCADE,
  t_ms INTEGER NOT NULL,
  duration_ms INTEGER,
  type TEXT NOT NULL,
  targets JSONB NOT NULL,
  look JSONB NOT NULL,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS session_shares (
  id UUID PRIMARY KEY,
  session_id UUID REFERENCES autoque_sessions(id) ON DELETE CASCADE,
  rig_version_id UUID REFERENCES rig_versions(id) ON DELETE CASCADE,
  shared_with_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  email_invite TEXT,
  permission TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL
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
  venue_id UUID REFERENCES venues(id),
  event_type TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cues_status ON cues(status);
CREATE INDEX IF NOT EXISTS idx_cues_venue_id ON cues(venue_id);
CREATE INDEX IF NOT EXISTS idx_venue_users_user_id ON venue_users(user_id);
CREATE INDEX IF NOT EXISTS idx_rig_versions_theatre_id ON rig_versions(theatre_id);
CREATE INDEX IF NOT EXISTS idx_fixture_instances_rig_version_id ON fixture_instances(rig_version_id);
CREATE INDEX IF NOT EXISTS idx_media_assets_theatre_id ON media_assets(theatre_id);
CREATE INDEX IF NOT EXISTS idx_autoque_sessions_theatre_id ON autoque_sessions(theatre_id);
CREATE INDEX IF NOT EXISTS idx_cue_channels_cue_id ON cue_channels(cue_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_cue_id ON audit_logs(cue_id);
