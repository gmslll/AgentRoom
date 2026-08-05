CREATE TABLE IF NOT EXISTS rooms (
  id text PRIMARY KEY,
  name text NOT NULL,
  invite_code_hash char(64) NOT NULL,
  next_sequence bigint NOT NULL DEFAULT 1 CHECK (next_sequence > 0),
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS room_members (
  id text PRIMARY KEY,
  room_id text NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  actor_type text NOT NULL CHECK (actor_type IN ('human', 'agent', 'terminal')),
  agent_provider text CHECK (agent_provider IN ('claude', 'codex', 'other')),
  role text NOT NULL CHECK (role IN ('owner', 'member')),
  token_hash char(64) NOT NULL,
  joined_at timestamptz NOT NULL,
  UNIQUE (room_id, token_hash),
  CHECK (
    (actor_type = 'agent' AND agent_provider IS NOT NULL) OR
    (actor_type <> 'agent' AND agent_provider IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS room_members_room_joined_idx
  ON room_members (room_id, joined_at, id);

CREATE TABLE IF NOT EXISTS room_messages (
  id text PRIMARY KEY,
  room_id text NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  sequence bigint NOT NULL CHECK (sequence > 0),
  kind text NOT NULL CHECK (kind IN ('text', 'agent.task', 'agent.reply')),
  text text NOT NULL,
  attachment_ids text[] NOT NULL DEFAULT '{}',
  target_member_ids text[] NOT NULL DEFAULT '{}',
  in_reply_to_message_id text REFERENCES room_messages(id),
  idempotency_key text,
  author_member_id text NOT NULL REFERENCES room_members(id),
  author_display_name text NOT NULL,
  author_actor_type text NOT NULL CHECK (author_actor_type IN ('human', 'agent', 'terminal')),
  author_agent_provider text CHECK (author_agent_provider IN ('claude', 'codex', 'other')),
  created_at timestamptz NOT NULL,
  UNIQUE (room_id, sequence)
);

CREATE UNIQUE INDEX IF NOT EXISTS room_messages_idempotency_idx
  ON room_messages (room_id, author_member_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS agent_deliveries (
  id text PRIMARY KEY,
  room_id text NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  task_message_id text NOT NULL REFERENCES room_messages(id) ON DELETE CASCADE,
  target_member_id text NOT NULL REFERENCES room_members(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('queued', 'received', 'running', 'replied', 'failed')),
  error text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (task_message_id, target_member_id)
);

CREATE INDEX IF NOT EXISTS agent_deliveries_pending_idx
  ON agent_deliveries (room_id, target_member_id, status, created_at)
  WHERE status IN ('queued', 'received', 'running');
