-- Public/private discovery and recoverable room dissolution.

ALTER TABLE rooms
  ADD COLUMN visibility text NOT NULL DEFAULT 'private'
    CHECK (visibility IN ('private', 'public')),
  ADD COLUMN dissolved_at timestamptz;

CREATE INDEX rooms_public_created_idx
  ON rooms (created_at DESC, id)
  WHERE visibility = 'public' AND dissolved_at IS NULL;

CREATE INDEX rooms_owner_active_created_idx
  ON rooms (owner_user_id, created_at DESC)
  WHERE owner_user_id IS NOT NULL AND dissolved_at IS NULL;
