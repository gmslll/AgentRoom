# Production deployment

The current single-host deployment serves the Vite frontend from Nginx, runs
the Node.js API under systemd, keeps PostgreSQL and MinIO in dedicated Docker
containers with named volumes, and terminates TLS/WebSockets in Nginx.

## Topology

```text
Internet -> Nginx :443 /        -> current/frontend/dist
                      /api/*   -> AgentRoom :18787 -> PostgreSQL :15432
                      /agentroom-files/* -> MinIO :19000
                                   systemd       Docker + named volumes
```

Only Nginx is public. Bind the API, database, and MinIO ports to loopback.
Configure:

```dotenv
HOST=127.0.0.1
PORT=18787
LOG_LEVEL=info
CORS_ORIGIN=https://try-status.online
PUBLIC_BASE_URL=https://try-status.online/api
DATABASE_URL=postgresql://agentroom:replace_me@127.0.0.1:15432/agentroom
AUTH_SESSION_TTL_DAYS=30
FILES_ENABLED=true
FILES_MAX_SIZE_BYTES=104857600
FILES_ROOM_QUOTA_BYTES=1073741824
FILES_SCAN_RESULT=clean
FILES_UPLOAD_URL_TTL_SECONDS=300
S3_ENDPOINT=https://try-status.online
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=agentroom
S3_SECRET_ACCESS_KEY=replace_with_a_random_secret
S3_BUCKET=agentroom-files
S3_FORCE_PATH_STYLE=true
```

Store the real file at `/etc/agentroom/backend.env`, owned by root with mode
`0600`. Store PostgreSQL initialization variables in a separate root-only env
file. Do not commit either file.

Run MinIO as `agentroom-minio`, bind its API only to
`127.0.0.1:19000:9000`, and persist `/data` in the named volume
`agentroom-minio-data`. Put `MINIO_ROOT_USER` and `MINIO_ROOT_PASSWORD` in a
separate root-owned mode-`0600` env file; they must match the S3 credentials
above. Use a pinned MinIO image digest and `--restart unless-stopped`. Nginx
publishes only the private `agentroom-files` bucket path over the existing TLS
origin. Presigned requests preserve the public host and full bucket path; all
unsigned object requests remain denied by MinIO.

When `FILES_ENABLED=true`, application startup creates the bucket if needed
and fails closed if any S3 setting is missing or the storage service is
unreachable. This prevents a production deployment from silently returning
unusable `memory://` upload URLs.

The systemd unit runs compiled migrations before every application start.
Migrations are checksum-verified, transactional, and protected by a PostgreSQL
advisory lock.

## Release layout

```text
/opt/agentroom/
├── current -> releases/<git-commit>
└── releases/
    └── <git-commit>/
        ├── backend/
        └── frontend/dist/
```

Build the backend, CLI, and frontend in the same immutable commit directory,
then switch `current` atomically. The systemd service and Nginx static root both
follow that symlink, so the frontend and backend always represent one commit.
Keep the previous release and database backup until the API, frontend root,
frontend deep link, and JavaScript asset checks pass. The build also creates
`backend/artifacts/cli/`: a single cross-platform CLI bundle, macOS/Linux and
Windows installers, and their SHA-256 manifest. Generated frontend and CLI
files remain inside the immutable release and are not committed.

## One-command release

After the one-time server bootstrap is complete, deploy the current committed
revision from the repository root with:

```bash
./backend/deploy/deploy.sh
```

The script defaults to `root@159.75.105.5`, deploys `HEAD`, builds the frontend
with `VITE_API_BASE_URL=https://try-status.online/api`, and verifies both
`https://try-status.online` and the API. Override these values when needed:

```bash
./backend/deploy/deploy.sh \
  --host root@example.com \
  --ref main \
  --public-url https://example.com/api \
  --frontend-url https://example.com
```

The worktree must be clean because only committed files are packaged. The
script acquires a server-side deployment lock, uploads a `git archive`, builds
an immutable full-stack release, creates a PostgreSQL custom-format dump,
installs the checked-in systemd and Nginx configurations, switches the shared
release symlink, and checks the loopback API, public API, frontend SPA deep
link, and compiled JavaScript. A failed service, Nginx validation, or health
check restores the previous release symlink and both service configurations.
Database migrations are forward-only and are not automatically reversed; the
backup path is printed for manual recovery.

Use `--dry-run` to validate local inputs without connecting, or
`--skip-db-backup` only when an operator has explicitly accepted that risk.
Existing releases and database backups are deliberately not deleted by this
script.

The release script manages
`/etc/nginx/sites-available/try-status.online` from the checked-in configuration.
It validates with `nginx -t` before switching, reloads rather than restarts
Nginx, and restores the previous file on failure. `/api/` remains the backend
proxy; `/` serves `current/frontend/dist`, immutable Vite assets receive a
long-lived cache policy, and React Router deep links fall back to `index.html`.
`/agentroom-files/` is reserved for presigned MinIO PUT/GET requests, permits
up to 100MB bodies, disables proxy buffering, and is never handled by the SPA.

## Automatic deployment from a release tag

The repository workflow
[`../../.github/workflows/deploy-release.yml`](../../.github/workflows/deploy-release.yml)
runs only when a semantic tag matching `release-v*` is pushed. It accepts tags
such as `release-v0.8.1` or `release-v0.8.1-rc.1`, rejects other names, and
requires the tagged commit to be an ancestor of `origin/main`.

The workflow has two jobs:

1. `verify` installs the locked frontend and backend dependencies under Node.js
   22, then lints/type-checks/tests the applications and builds the frontend,
   API, and downloadable CLI. It has no production environment and cannot read
   deployment secrets.
2. `deploy` enters the GitHub `production` environment, configures a temporary
   SSH identity with strict host-key checking, and calls the same
   `backend/deploy/deploy.sh` used for manual releases. The script still owns
   the deployment lock, PostgreSQL backup, immutable full-stack release,
   Nginx/systemd rollback, and health checks.

### One-time GitHub configuration

In the repository, open **Settings -> Environments**, create an environment
named `production`, and add these environment secrets:

| Secret | Value |
| --- | --- |
| `DEPLOY_HOST` | `root@159.75.105.5` |
| `DEPLOY_SSH_PRIVATE_KEY` | A dedicated unencrypted Ed25519 private key used only by this workflow |
| `DEPLOY_KNOWN_HOSTS` | The verified `known_hosts` line for `159.75.105.5` |

The server bootstrap currently requires a root SSH user. Generate a dedicated
key on an administrator machine and install only its public half on the server:

```bash
ssh-keygen -t ed25519 -C agentroom-github-actions \
  -f ./agentroom-github-actions -N ''
ssh-copy-id -i ./agentroom-github-actions.pub root@159.75.105.5
```

Before creating `DEPLOY_KNOWN_HOSTS`, obtain and verify the host fingerprint.
The fingerprint reported by a trusted server console must match the scan:

```bash
# Run on the server through a trusted console.
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub

# Run on the administrator machine, then compare the fingerprint above.
ssh-keyscan -H -t ed25519 159.75.105.5 >agentroom-known-hosts
ssh-keygen -lf agentroom-known-hosts
```

Copy the full contents of `agentroom-known-hosts` into
`DEPLOY_KNOWN_HOSTS`. Copy the full private key file, including its BEGIN/END
lines, into `DEPLOY_SSH_PRIVATE_KEY`. Never commit either file. The workflow
validates both files before it opens an SSH connection and the deploy script
uses `StrictHostKeyChecking=yes` for both CI and manual deployments.

Configure `production` required reviewers if the repository plan supports it,
and restrict deployments to tags matching `release-v*`. Protect the same tag
pattern in repository rules so an existing release tag cannot be moved.

### Publishing a production release

Push the release commit to `main`, then create a new annotated tag. Never move
or reuse a published tag; increment the version for a retry:

```bash
git switch main
git pull --ff-only
git tag -a release-v0.8.1 -m "AgentRoom release v0.8.1"
git push origin release-v0.8.1
```

The tag push starts **Deploy production release** in the Actions tab. If the
environment has required reviewers, approve the `deploy` job after `verify`
passes. A GitHub Release page is optional; deployment is triggered by the tag
push itself. Do not push the first release tag until all three environment
secrets are configured.

During initial bootstrap, enable the checked-in Nginx site at
`/etc/nginx/sites-enabled/try-status.online`. Routine releases update its
`sites-available` target automatically. The production rule strips the external
`/api/` prefix before proxying to the backend, whose internal routes remain
`/health` and `/v1/*`.

## Verification

Verify all layers after deployment:

```bash
systemctl is-active agentroom
systemctl is-active nginx
curl --fail http://127.0.0.1:18787/health
curl --fail https://try-status.online/
curl --fail https://try-status.online/rooms
curl --fail https://try-status.online/api/health
curl --fail https://try-status.online/api/openapi.yaml
curl --fail https://try-status.online/api/downloads/cli/manifest.json
journalctl -u agentroom --since "10 minutes ago"
```

Also register a disposable account, create a room, request a realtime ticket,
and complete one WebSocket handshake. Delete or retain that smoke-test account
according to the environment's data policy.
