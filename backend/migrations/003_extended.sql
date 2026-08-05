-- Attachments, outbox, auth tokens, moderation, and OAuth support.

-- Member tokens can now be revoked (kick / token rotation).
ALTER TABLE room_members
  ADD COLUMN token_revoked_at timestamptz,
  ADD COLUMN removed_at timestamptz;

-- Users can verify their email address.
ALTER TABLE users
  ADD COLUMN email_verified_at timestamptz;

-- Single-use email verification / password reset codes.
CREATE TABLE email_codes (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('email_verify', 'password_reset')),
  code_hash char(64) NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  failed_attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL
);

CREATE INDEX email_codes_user_purpose_idx
  ON email_codes (user_id, purpose, created_at DESC);

-- OAuth identities linked to accounts.
CREATE TABLE oauth_accounts (
  provider text NOT NULL CHECK (provider IN ('google', 'github')),
  provider_user_id text NOT NULL,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (provider, provider_user_id)
);

CREATE INDEX oauth_accounts_user_idx ON oauth_accounts (user_id);

-- File attachment metadata; bytes live in S3-compatible object storage.
CREATE TABLE attachments (
  id text PRIMARY KEY,
  room_id text NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  uploader_member_id text NOT NULL REFERENCES room_members(id) ON DELETE CASCADE,
  name text NOT NULL,
  media_type text NOT NULL,
  size bigint NOT NULL CHECK (size > 0),
  sha256 char(64) NOT NULL,
  storage_key text NOT NULL,
  scan_state text NOT NULL CHECK (scan_state IN ('pending', 'clean', 'flagged')),
  created_at timestamptz NOT NULL
);

CREATE INDEX attachments_room_created_idx
  ON attachments (room_id, created_at DESC);

-- Transactional outbox for realtime fan-out after commit.
CREATE TABLE outbox (
  id bigserial PRIMARY KEY,
  room_id text NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  published_at timestamptz
);

CREATE INDEX outbox_pending_idx
  ON outbox (id)
  WHERE published_at IS NULL;

-- Room-scoped content moderation rules.
CREATE TABLE moderation_rules (
  id text PRIMARY KEY,
  room_id text NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  pattern text NOT NULL,
  action text NOT NULL CHECK (action IN ('flag', 'reject')),
  created_by_member_id text NOT NULL REFERENCES room_members(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL
);

CREATE INDEX moderation_rules_room_idx ON moderation_rules (room_id);

-- Messages carry the moderation outcome when moderation is enabled.
ALTER TABLE room_messages
  ADD COLUMN moderation_state text CHECK (moderation_state IN ('clean', 'flagged')),
  ADD COLUMN moderation_reason text;
