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
The build also creates `backend/artifacts/cli/`: a single cross-platform CLI
bundle, macOS/Linux and Windows installers, and their SHA-256 manifest. These
generated files remain inside the immutable release and are not committed.

## One-command release

After the one-time server bootstrap is complete, deploy the current committed
revision from the repository root with:

```bash
./backend/deploy/deploy.sh
```

The script defaults to `root@159.75.105.5`, deploys `HEAD`, and verifies
`https://try-status.online/api`. Override these values when needed:

```bash
./backend/deploy/deploy.sh \
  --host root@example.com \
  --ref main \
  --public-url https://example.com/api
```

The worktree must be clean because only committed files are packaged. The
script acquires a server-side deployment lock, uploads a `git archive`, builds
an immutable commit release, creates a PostgreSQL custom-format dump, switches
the systemd symlink, and checks both loopback and public health endpoints. A
failed service or health check restores the previous code symlink and systemd
unit. Database migrations are forward-only and are not automatically reversed;
the backup path is printed for manual recovery.

Use `--dry-run` to validate local inputs without connecting, or
`--skip-db-backup` only when an operator has explicitly accepted that risk.
Existing releases and database backups are deliberately not deleted by this
script.

The release script does not overwrite Nginx on routine backend deployments.
This prevents backend releases from replacing the frontend-owned `/` route.
Install or update `backend/deploy/nginx/try-status.online.conf` manually during
the initial bootstrap or an intentional gateway change, then run `nginx -t`
before reloading Nginx.

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
curl --fail https://try-status.online/api/openapi.yaml
curl --fail https://try-status.online/api/downloads/cli/manifest.json
journalctl -u agentroom --since "10 minutes ago"
```

Also register a disposable account, create a room, request a realtime ticket,
and complete one WebSocket handshake. Delete or retain that smoke-test account
according to the environment's data policy.
