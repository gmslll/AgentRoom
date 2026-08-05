# AgentRoom backend

The backend is a TypeScript modular monolith. It exposes a versioned HTTP API
and WebSocket event stream that can be consumed by the web client, local
terminals, and AI bridges.

The backend defaults to an in-memory repository for zero-setup protocol work.
When `DATABASE_URL` is set it uses the PostgreSQL repository, whose transactions
make message sequences, task idempotency, deliveries, and replies atomic. See
[`../docs/architecture.md`](./docs/architecture.md).

## Requirements

- Node.js 22 or newer
- npm 10 or newer
- PostgreSQL 17 or newer for persistent mode

## Commands

```bash
npm install
cp .env.example .env
npm run dev
```

The server listens on `http://127.0.0.1:8787` by default.

Interactive Swagger documentation is available at `/docs`, with the original
shared OpenAPI contract at `/openapi.yaml`. In production these are exposed as
`https://try-status.online/api/docs` and
`https://try-status.online/api/openapi.yaml`.

Once a production host has been bootstrapped, deploy the committed `HEAD` with
`./deploy/deploy.sh`. See [`docs/deployment.md`](docs/deployment.md) for
prerequisites, overrides, backup behavior, and rollback guarantees.

For persistent mode, create a database, set `DATABASE_URL`, apply migrations,
and then start the service:

```bash
export DATABASE_URL=postgresql://agentroom:password@127.0.0.1:5432/agentroom
npm run db:migrate
npm run dev
```

Migration files are applied once under a PostgreSQL advisory lock and recorded
in `schema_migrations`.

Account sessions expire after 30 days by default. Set
`AUTH_SESSION_TTL_DAYS` to an integer from 1 to 365 to change that window.
Set `PUBLIC_BASE_URL` to the externally reachable backend origin (and optional
path prefix). Room connector responses embed this value in copyable CLI
commands; do not set it to a private container-only address in production. For
the current deployment, use `https://try-status.online/api`.

```bash
npm test
npm run typecheck
npm run build
```

## Current API slice

- `GET /health`
- `POST /v1/auth/register`
- `POST /v1/auth/login`
- `GET /v1/auth/me`
- `POST /v1/auth/logout`
- `GET /v1/rooms` (rooms linked to the logged-in account)
- `POST /v1/rooms`
- `POST /v1/rooms/:roomId/members`
- `GET /v1/rooms/:roomId/members`
- `POST /v1/rooms/:roomId/invite-code/rotate`
- `GET /v1/rooms/:roomId/connector`
- `GET /v1/rooms/:roomId/messages`
- `POST /v1/rooms/:roomId/messages`
- `GET /v1/rooms/:roomId/deliveries/pending`
- `POST /v1/rooms/:roomId/deliveries/:deliveryId/status`
- `POST /v1/rooms/:roomId/deliveries/:deliveryId/reply`
- `POST /v1/rooms/:roomId/realtime-tickets`
- `GET /v1/realtime?ticket=...` (WebSocket upgrade)

Room IDs identify rooms but are not credentials. Creation returns an invite
code and a member access token. WebSocket connections use short-lived,
single-use tickets so long-lived bearer tokens do not appear in URLs.

Account passwords are stored as salted scrypt hashes. Registration and login
return a random `ars_` session token; only its SHA-256 hash is persisted, it
expires, and logout revokes it immediately. A human membership created with an
account session is linked to that account, so a later login can list and access
the room without preserving its one-time `art_` member token. Guest room
creation and anonymous invite joins remain supported for local-first use.
Registration and login have bounded in-process attempt windows; production
multi-instance deployments still need the planned shared Redis limiter.

## Source layout

```text
src/
├── api/                    # Fastify composition, config, and process lifecycle
├── connectors/             # Downloadable CLI and Claude/Codex adapters
│   ├── claude/             # Claude Code Channel/MCP provider
│   └── codex/              # Codex App Server provider and thread state
├── database/               # Migration runner
├── lib/                    # Small cross-module backend utilities
├── protocol/               # Runtime DTOs shared by API modules and connectors
├── modules/
│   ├── health/             # Liveness endpoint
│   ├── auth/               # Accounts, passwords, and revocable sessions
│   ├── rooms/              # Rooms, members, and messages
│   ├── realtime/           # Tickets and WebSocket fan-out
│   └── docs/               # Swagger and OpenAPI routes
test/                       # Mirrors api/, connectors/, and modules/
migrations/                 # Ordered PostgreSQL migrations
scripts/                    # Backend build/release tooling
artifacts/cli/              # Generated direct-download CLI release (ignored)
```

Dependency direction is inward: `api/` composes modules, modules own business
behavior and persistence ports, and `connectors/` acts as an external client of
the public room protocol through `protocol/`. Modules never import `api/` or
connector runtime code.

The canonical external contracts live in `../shared/contracts/`.
Frontend integration steps and request examples are documented in
[`../docs/frontend-backend-integration.md`](../docs/frontend-backend-integration.md).
Single-host production deployment is documented in
[`docs/deployment.md`](./docs/deployment.md).

## Triggering local agents

Room responses contain direct installer URLs plus copyable `agentroom join` and
`agentroom attach` commands. The server builds one Node.js 22 bundle that runs
on macOS, Linux, and Windows and publishes two native installer scripts.

macOS/Linux:

```bash
curl -fL -o agentroom-install.sh \
  https://try-status.online/api/downloads/cli/install.sh
sh agentroom-install.sh
~/.local/bin/agentroom --help
```

Windows PowerShell:

```powershell
Invoke-WebRequest https://try-status.online/api/downloads/cli/install.ps1 `
  -OutFile agentroom-install.ps1
powershell -ExecutionPolicy Bypass -File .\agentroom-install.ps1
& "$env:LOCALAPPDATA\AgentRoom\bin\agentroom.cmd" --help
```

Both installers verify the bundle SHA-256 from the generated release before
installing it into a user-local binary directory. Windows adds that directory
to the user PATH for new terminals; macOS/Linux prints the required PATH
command when needed.
They never require administrator access, npm, or npx. In a source checkout,
build the backend and run the same CLI directly:

```bash
node dist/connectors/cli.js join room_replace_me \
  --invite ari_replace_me \
  --provider codex \
  --name Codex \
  --workspace /absolute/path/to/project
```

The CLI exchanges the invite for a member token and writes that token to a
mode-`0600` JSON file under the workspace's ignored `.agentroom/` directory.
It never prints the member token. Start a saved bridge with:

```bash
node dist/connectors/cli.js run --config /absolute/path/to/private-config.json
```

To bind an existing Claude or Codex conversation instead of creating a fresh
agent conversation, run:

```bash
agentroom attach room_replace_me \
  --base-url https://try-status.online/api \
  --session last
```

For Codex, `attach` lists saved interactive threads in the current workspace,
strictly resumes the selected thread through App Server, and stores its thread
ID in a member-scoped `.agentroom/` state file. The target Codex session must
not still be running. For Claude, `attach` adds a local-scope MCP entry and
prints a `claude --continue` or `claude --resume` command that reloads the same
conversation with the AgentRoom development channel. Exit the original Claude
process before running that command.

Build the backend and obtain an agent membership token by joining the room with
`actorType: "agent"` and `agentProvider: "claude"` or `"codex"`. Copy
`bridge.env.example` values into a private environment file or secret store.

For a local Claude Channel during the research preview, add the built file to
the project's `.mcp.json`:

```json
{
  "mcpServers": {
    "agentroom": {
      "command": "node",
      "args": ["/absolute/path/to/backend/dist/connectors/claude/channel.js"],
      "env": {
        "AGENTROOM_BASE_URL": "http://127.0.0.1:8787",
        "AGENTROOM_ROOM_ID": "room_replace_me",
        "AGENTROOM_ACCESS_TOKEN": "art_replace_me"
      }
    }
  }
}
```

Then start Claude Code with:

```bash
claude --dangerously-load-development-channels server:agentroom
```

For Codex, keep the bridge process running in the target workspace:

```bash
AGENTROOM_ROOM_ID=room_replace_me \
AGENTROOM_ACCESS_TOKEN=art_replace_me \
AGENTROOM_WORKSPACE=/absolute/path/to/project \
npm run bridge:codex
```

The Codex bridge starts `codex app-server`, preserves its member-scoped thread
ID under `.agentroom/`, processes tasks sequentially, and posts final agent
replies. Attached threads are strict: if the selected thread can no longer be
resumed, the bridge fails instead of silently replacing it with a fresh thread.
See [`docs/agent-triggering.md`](./docs/agent-triggering.md) for guarantees and
security constraints.
