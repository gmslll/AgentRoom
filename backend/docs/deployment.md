# Production deployment

The current single-host deployment runs the Node.js API under systemd, keeps
PostgreSQL in a dedicated Docker container with a named volume, and terminates
TLS/WebSockets in Nginx.

## Topology

```text
Internet -> Nginx :443 /api/* -> AgentRoom :18787 -> PostgreSQL :15432
                 / (frontend)            systemd       Docker + named volume
```

Only Nginx is public. Bind both the API and database to loopback. Configure:

```dotenv
HOST=127.0.0.1
PORT=18787
LOG_LEVEL=info
CORS_ORIGIN=https://try-status.online
PUBLIC_BASE_URL=https://try-status.online/api
DATABASE_URL=postgresql://agentroom:replace_me@127.0.0.1:15432/agentroom
AUTH_SESSION_TTL_DAYS=30
```

Store the real file at `/etc/agentroom/backend.env`, owned by root with mode
`0600`. Store PostgreSQL initialization variables in a separate root-only env
file. Do not commit either file.

The systemd unit runs compiled migrations before every application start.
Migrations are checksum-verified, transactional, and protected by a PostgreSQL
advisory lock.

## Release layout

```text
/opt/agentroom/
├── current -> releases/<git-commit>
└── releases/
    └── <git-commit>/
```

Build each release in its immutable commit directory, switch `current`
atomically, then restart `agentroom.service`. Keep the previous release and
database backup until the new health check and WebSocket handshake pass.

Install the checked-in unit and Nginx configuration from `backend/deploy/`, run
`systemctl daemon-reload`, validate with `nginx -t`, and reload rather than
restarting Nginx. The production Nginx rule strips the external `/api/` prefix
before proxying to the backend, whose internal routes remain `/health` and
`/v1/*`. The root path is reserved for the frontend.

## Verification

Verify all layers after deployment:

```bash
systemctl is-active agentroom
curl --fail http://127.0.0.1:18787/health
curl --fail https://try-status.online/api/health
journalctl -u agentroom --since "10 minutes ago"
```

Also register a disposable account, create a room, request a realtime ticket,
and complete one WebSocket handshake. Delete or retain that smoke-test account
according to the environment's data policy.
