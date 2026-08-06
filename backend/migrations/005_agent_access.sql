-- Account ownership, delegated dispatch, and bilateral agent collaboration.

ALTER TABLE room_members
  ADD CONSTRAINT room_members_room_member_key UNIQUE (room_id, id);

CREATE TABLE agent_ownerships (
  room_id text NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  agent_member_id text PRIMARY KEY,
  owner_user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  claimed_at timestamptz NOT NULL,
  FOREIGN KEY (room_id, agent_member_id)
    REFERENCES room_members(room_id, id) ON DELETE CASCADE,
  UNIQUE (room_id, agent_member_id)
);

CREATE INDEX agent_ownerships_owner_room_idx
  ON agent_ownerships (owner_user_id, room_id, agent_member_id);

-- Existing Agents are deliberately not assigned to the room owner. Agent
-- ownership is an independent security boundary and must be proved using the
-- Agent's own room credential and a freshly issued one-time claim code.

CREATE TABLE agent_claim_codes (
  id text PRIMARY KEY,
  room_id text NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  agent_member_id text NOT NULL,
  code_hash char(64) NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL,
  FOREIGN KEY (room_id, agent_member_id)
    REFERENCES room_members(room_id, id) ON DELETE CASCADE,
  CHECK (expires_at > created_at)
);

CREATE INDEX agent_claim_codes_agent_idx
  ON agent_claim_codes (room_id, agent_member_id, created_at DESC);

CREATE TABLE agent_user_grants (
  id text PRIMARY KEY,
  room_id text NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  agent_member_id text NOT NULL,
  grantee_user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL,
  FOREIGN KEY (room_id, agent_member_id)
    REFERENCES agent_ownerships(room_id, agent_member_id) ON DELETE CASCADE,
  UNIQUE (room_id, agent_member_id, grantee_user_id)
);

CREATE INDEX agent_user_grants_grantee_idx
  ON agent_user_grants (grantee_user_id, room_id, agent_member_id);

CREATE TABLE agent_collaborations (
  id text PRIMARY KEY,
  room_id text NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  requester_agent_member_id text NOT NULL,
  target_agent_member_id text NOT NULL,
  pair_agent_a_member_id text NOT NULL,
  pair_agent_b_member_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'active', 'rejected', 'revoked')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  FOREIGN KEY (room_id, requester_agent_member_id)
    REFERENCES agent_ownerships(room_id, agent_member_id) ON DELETE CASCADE,
  FOREIGN KEY (room_id, target_agent_member_id)
    REFERENCES agent_ownerships(room_id, agent_member_id) ON DELETE CASCADE,
  FOREIGN KEY (room_id, pair_agent_a_member_id)
    REFERENCES room_members(room_id, id) ON DELETE CASCADE,
  FOREIGN KEY (room_id, pair_agent_b_member_id)
    REFERENCES room_members(room_id, id) ON DELETE CASCADE,
  CHECK (requester_agent_member_id <> target_agent_member_id),
  CHECK (pair_agent_a_member_id < pair_agent_b_member_id)
);

CREATE UNIQUE INDEX agent_collaborations_open_pair_idx
  ON agent_collaborations (room_id, pair_agent_a_member_id, pair_agent_b_member_id)
  WHERE status IN ('pending', 'active');

CREATE INDEX agent_collaborations_room_updated_idx
  ON agent_collaborations (room_id, updated_at DESC, id);
