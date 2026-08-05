CREATE TABLE users (
  id text PRIMARY KEY,
  email text NOT NULL,
  email_normalized text NOT NULL UNIQUE,
  display_name text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE user_sessions (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash char(64) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK (expires_at > created_at)
);

CREATE INDEX user_sessions_user_active_idx
  ON user_sessions (user_id, expires_at)
  WHERE revoked_at IS NULL;

ALTER TABLE rooms
  ADD COLUMN owner_user_id text REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX rooms_owner_user_created_idx
  ON rooms (owner_user_id, created_at DESC)
  WHERE owner_user_id IS NOT NULL;

ALTER TABLE room_members
  ADD COLUMN user_id text REFERENCES users(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX room_members_room_user_idx
  ON room_members (room_id, user_id)
  WHERE user_id IS NOT NULL;
