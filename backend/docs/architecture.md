# Backend architecture

Status: accepted for the MVP.

## Decision

Build a TypeScript modular monolith on Node.js 22 and Fastify 5. Keep platform
integrations outside the domain core and communicate through versioned HTTP and
WebSocket contracts.

Do not begin with microservices. Rooms, membership, messages, files, and the
transactional event log share consistency boundaries and will change together
during product discovery. A modular monolith keeps those transactions simple
while preserving seams that can be extracted later.

## Runtime topology

```text
Web client ───────────────┐
Provider-started MCP ─────┼── Local Bridge ── HTTP + WebSocket ── API process
Manual CLI fallback ──────┘       │
                                  └─ local session-card inbox
                                                       ├─ PostgreSQL
                                                       ├─ Redis
                                                       └─ S3 storage
```

- HTTP is the control and command plane: create/join rooms, history, send
  messages, upload negotiation, and token management.
- WebSocket is the realtime event plane. Events use a versioned envelope and a
  monotonically increasing per-room sequence so clients can resume through the
  HTTP history endpoint after disconnects.
- `join` stores room credentials locally and configures the selected provider.
  Claude starts a room-specific Channel MCP; Codex starts one workspace-aware
  MCP supervisor that discovers private configs beneath the current project's
  `.agentroom/` directory. Users do not manually keep `agentroom run` open in
  the normal flow.
- The provider-started MCP owns the Bridge lifetime. Codex receivers execute
  targeted tasks in separate persisted App Server threads because standard MCP
  cannot inject a new turn into the current Codex TUI. `agentroom run` remains
  an explicit service-manager and troubleshooting fallback.
- Before provider dispatch, the Bridge writes an atomic, credential-free
  session card under the workspace's ignored `.agentroom/` directory. This is
  local recovery/evidence only; it never replaces PostgreSQL as task authority.
- Remote MCP may be added later through Streamable HTTP, but it must call the
  same application services as HTTP and the local Bridge.

## Modules

| Module | Responsibility |
| --- | --- |
| Identity | Users, password credentials, revocable account sessions, actor identity |
| Rooms | Room lifecycle, invite policy, membership, roles |
| Messages | Ordered durable messages, history cursors, idempotency |
| Realtime | Single-use connection tickets, fan-out, presence, resume hints |
| Files | Upload intents, metadata, quota, scan state, signed object URLs |
| Connectors | Claude Channel, Codex App Server, CLI behavior, and installation |

Modules may call each other through explicit application interfaces. They must
not reach into another module's database tables from route handlers.

## Implementation layout

```text
src/
├── api/          # Fastify composition, configuration, and process lifecycle
├── modules/      # Vertical business modules and their persistence adapters
├── connectors/   # Local AgentRoom CLI plus Claude and Codex providers
├── database/     # Migration runner
├── protocol/     # Runtime DTOs shared by server modules and connectors
└── lib/          # Small cross-module primitives
```

Dependencies point toward business modules and protocol DTOs: `api/` wires
modules together and `connectors/` consumes the public room protocol through
`protocol/`. Business modules do not import API composition, process lifecycle
code, or connector implementations. Tests mirror these boundaries under
`test/` so ownership remains obvious to humans and coding agents.

## Persistence and scale

- PostgreSQL is the source of truth for rooms, members, messages, attachments,
  tokens, and an outbox table.
- Redis is disposable infrastructure for multi-instance pub/sub, presence,
  rate limiting, and short-lived tickets. Durable message data never exists
  only in Redis.
- An S3-compatible object store holds file bytes. The API creates short-lived
  signed upload/download URLs and stores metadata in PostgreSQL; file bytes do
  not pass through the API process.
- Publish realtime notifications from a transactional outbox after the message
  transaction commits. Consumers recover missed events from PostgreSQL using
  the room sequence.

The in-memory adapter remains available for tests and zero-setup development.
Setting `DATABASE_URL` selects the PostgreSQL adapter. Ordered sequences,
idempotent task creation, delivery transitions, and agent replies run inside
database transactions. Multi-instance realtime still requires the planned
transactional outbox and Redis fan-out.

## Security model

- A room ID is public routing information, never authentication.
- Joining requires an invite capability or authenticated room policy.
- Account sessions are random, expiring, revocable, and stored only as hashes.
- Member access tokens are random, room-scoped, and stored only as hashes.
  Creation responses reveal raw secrets once; member tokens are revoked on
  removal (owner kick) and stale tokens fail authentication immediately.
- Passwords are never stored directly. The current credential adapter uses a
  per-password random salt and bounded scrypt parameters.
- Browser WebSockets use short-lived, single-use tickets to avoid persistent
  tokens in URLs and proxy logs.
- Validate actor type, message size, filenames, media types, object size, and
  room membership at trust boundaries.
- Files require quotas, checksum verification, malware scanning state, safe
  content disposition, and authorization on every download.
- AI actors are visibly typed. Future action-capable tools need explicit scopes
  separate from the ability to read or send chat messages.

## Delivery phases

1. Room creation, membership, text messages, ordered history, and realtime
   fan-out using in-memory adapters (implemented).
2. PostgreSQL schema, account login/registration, migrations, and idempotency
   keys (implemented); transactional outbox and distributed login rate limits
   (implemented; outbox runs post-commit with an in-process drainer — see
   `modules/realtime/outbox-publisher.ts`).
3. S3-compatible direct file upload/download with attachment messages
   (implemented: presigned URLs, quota, SHA-256 verification, simulated scan
   state; object bytes never flow through the API process).
4. Direct-download cross-platform bundle and checksum-verifying installers
   (implemented); secure OS credential storage (implemented:
   `--credential-store keychain` via @napi-rs/keyring, falls back to the
   mode-0600 config file).
5. Redis fan-out/presence, remote MCP, moderation (implemented); OAuth
   (implemented for Google and GitHub); production operations remain.

## Multi-instance realtime

`RedisEventBus` fans out room events across instances over Redis pub/sub with
per-instance echo suppression. PostgreSQL repositories persist events (with
their audience) to the `outbox` table; `OutboxPublisher` drains it every 500ms
into the event bus using an atomic claim (`FOR UPDATE SKIP LOCKED`), so events
survive process restarts and each batch is delivered once. In-memory
development mode publishes directly.
