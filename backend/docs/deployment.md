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

## Automatic deployment from a release tag

The repository workflow
[`../../.github/workflows/deploy-release.yml`](../../.github/workflows/deploy-release.yml)
runs only when a semantic tag matching `release-v*` is pushed. It accepts tags
such as `release-v0.8.1` or `release-v0.8.1-rc.1`, rejects other names, and
requires the tagged commit to be an ancestor of `origin/main`.

The workflow has two jobs:

1. `verify` installs the locked backend dependencies under Node.js 22, then
   type-checks, tests, and builds the API and downloadable CLI. It has no
   production environment and cannot read deployment secrets.
2. `deploy` enters the GitHub `production` environment, configures a temporary
   SSH identity with strict host-key checking, and calls the same
   `backend/deploy/deploy.sh` used for manual releases. The script still owns
   the deployment lock, PostgreSQL backup, immutable release, rollback, and
   health checks.

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
