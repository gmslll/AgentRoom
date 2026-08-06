#!/usr/bin/env bash

set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPOSITORY_ROOT=$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)

DEPLOY_HOST=${AGENTROOM_DEPLOY_HOST:-root@159.75.105.5}
DEPLOY_REF=${AGENTROOM_DEPLOY_REF:-HEAD}
DEPLOY_ROOT=${AGENTROOM_DEPLOY_ROOT:-/opt/agentroom}
PUBLIC_BASE_URL=${AGENTROOM_PUBLIC_BASE_URL:-https://try-status.online/api}
FRONTEND_PUBLIC_URL=${AGENTROOM_FRONTEND_PUBLIC_URL:-https://try-status.online}
POSTGRES_CONTAINER=${AGENTROOM_POSTGRES_CONTAINER:-agentroom-postgres}
POSTGRES_USER=${AGENTROOM_POSTGRES_USER:-agentroom}
POSTGRES_DATABASE=${AGENTROOM_POSTGRES_DATABASE:-agentroom}
SSH_IDENTITY_FILE=${AGENTROOM_SSH_IDENTITY_FILE:-}
SSH_KNOWN_HOSTS_FILE=${AGENTROOM_SSH_KNOWN_HOSTS_FILE:-}
BACKUP_DATABASE=1
DRY_RUN=0

SSH_OPTIONS=(
  -o BatchMode=yes
  -o StrictHostKeyChecking=yes
  -o ConnectTimeout=10
  -o ServerAliveInterval=15
  -o ServerAliveCountMax=3
)

usage() {
  cat <<'EOF'
Deploy the committed AgentRoom frontend and backend release to production.

Usage:
  backend/deploy/deploy.sh [options]

Options:
  --host <user@host>       SSH destination (default: root@159.75.105.5)
  --ref <git-ref>          Commit or ref to deploy (default: HEAD)
  --public-url <url>       Public backend base URL
  --frontend-url <url>     Public frontend URL
  --skip-db-backup         Skip the pre-deployment PostgreSQL dump
  --dry-run                Validate and print the resolved deployment only
  -h, --help               Show this help

Environment overrides:
  AGENTROOM_DEPLOY_HOST
  AGENTROOM_DEPLOY_REF
  AGENTROOM_DEPLOY_ROOT
  AGENTROOM_PUBLIC_BASE_URL
  AGENTROOM_FRONTEND_PUBLIC_URL
  AGENTROOM_POSTGRES_CONTAINER
  AGENTROOM_POSTGRES_USER
  AGENTROOM_POSTGRES_DATABASE
  AGENTROOM_SSH_IDENTITY_FILE
  AGENTROOM_SSH_KNOWN_HOSTS_FILE
EOF
}

log() {
  printf '[agentroom-deploy] %s\n' "$*"
}

fail() {
  printf '[agentroom-deploy] ERROR: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command not found: $1"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host)
      [[ $# -ge 2 ]] || fail "--host requires a value"
      DEPLOY_HOST=$2
      shift 2
      ;;
    --ref)
      [[ $# -ge 2 ]] || fail "--ref requires a value"
      DEPLOY_REF=$2
      shift 2
      ;;
    --public-url)
      [[ $# -ge 2 ]] || fail "--public-url requires a value"
      PUBLIC_BASE_URL=$2
      shift 2
      ;;
    --frontend-url)
      [[ $# -ge 2 ]] || fail "--frontend-url requires a value"
      FRONTEND_PUBLIC_URL=$2
      shift 2
      ;;
    --skip-db-backup)
      BACKUP_DATABASE=0
      shift
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail "Unknown option: $1"
      ;;
  esac
done

require_command git
require_command ssh
require_command tar
require_command curl

if [[ -n "$SSH_IDENTITY_FILE" ]]; then
  [[ -f "$SSH_IDENTITY_FILE" && -r "$SSH_IDENTITY_FILE" ]] ||
    fail "AGENTROOM_SSH_IDENTITY_FILE must be a readable regular file"
  SSH_OPTIONS+=(
    -i "$SSH_IDENTITY_FILE"
    -o IdentitiesOnly=yes
  )
fi

if [[ -n "$SSH_KNOWN_HOSTS_FILE" ]]; then
  [[ -f "$SSH_KNOWN_HOSTS_FILE" && -r "$SSH_KNOWN_HOSTS_FILE" ]] ||
    fail "AGENTROOM_SSH_KNOWN_HOSTS_FILE must be a readable regular file"
  SSH_OPTIONS+=(
    -o "UserKnownHostsFile=$SSH_KNOWN_HOSTS_FILE"
  )
fi

[[ "$DEPLOY_HOST" =~ ^[A-Za-z0-9][A-Za-z0-9._:@-]*$ ]] ||
  fail "Unsafe SSH destination: $DEPLOY_HOST"
DEPLOY_ROOT=${DEPLOY_ROOT%/}
[[ "$DEPLOY_ROOT" =~ ^/[A-Za-z0-9_-][A-Za-z0-9._-]*(/[A-Za-z0-9_-][A-Za-z0-9._-]*)*$ ]] ||
  fail "DEPLOY_ROOT must be a simple absolute path without dot segments"
[[ "$DEPLOY_ROOT" != "/" ]] ||
  fail "Unsafe DEPLOY_ROOT: $DEPLOY_ROOT"
[[ "$PUBLIC_BASE_URL" =~ ^https?://[A-Za-z0-9.-]+(:[0-9]+)?(/[A-Za-z0-9._~/%-]*)?/?$ ]] ||
  fail "PUBLIC_BASE_URL must be an HTTP(S) URL without query, hash, or credentials"
[[ "$FRONTEND_PUBLIC_URL" =~ ^https?://[A-Za-z0-9.-]+(:[0-9]+)?/?$ ]] ||
  fail "FRONTEND_PUBLIC_URL must be an HTTP(S) origin without a path, query, hash, or credentials"
[[ "$POSTGRES_CONTAINER" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ ]] ||
  fail "Unsafe PostgreSQL container name"
[[ "$POSTGRES_USER" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]*$ ]] ||
  fail "Unsafe PostgreSQL user"
[[ "$POSTGRES_DATABASE" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]*$ ]] ||
  fail "Unsafe PostgreSQL database"

PUBLIC_BASE_URL=${PUBLIC_BASE_URL%/}
FRONTEND_PUBLIC_URL=${FRONTEND_PUBLIC_URL%/}

cd "$REPOSITORY_ROOT"

if [[ -n $(git status --porcelain) ]]; then
  fail "Worktree is dirty. Commit or stash changes before deploying."
fi

DEPLOY_COMMIT=$(git rev-parse --verify "${DEPLOY_REF}^{commit}")
[[ "$DEPLOY_COMMIT" =~ ^[0-9a-f]{40}$ ]] || fail "Could not resolve a full Git commit"

RELEASE_DIR="$DEPLOY_ROOT/releases/$DEPLOY_COMMIT"
STAGING_DIR="$DEPLOY_ROOT/releases/.staging-$DEPLOY_COMMIT-$$"
LOCK_DIR=/var/lock/agentroom-deploy.lock
REMOTE_LOCK_ACQUIRED=0

log "Host: $DEPLOY_HOST"
log "Commit: $DEPLOY_COMMIT"
log "Public URL: $PUBLIC_BASE_URL"
log "Frontend URL: $FRONTEND_PUBLIC_URL"

if [[ "$DRY_RUN" -eq 1 ]]; then
  log "Dry run complete; no remote changes were made."
  exit 0
fi

cleanup() {
  local status=$?
  trap - EXIT INT TERM
  if [[ "$REMOTE_LOCK_ACQUIRED" -eq 1 ]]; then
    set +e
    ssh "${SSH_OPTIONS[@]}" "$DEPLOY_HOST" bash -s -- \
      "$DEPLOY_ROOT" "$STAGING_DIR" "$LOCK_DIR" <<'REMOTE_CLEANUP'
set -u
deploy_root=$1
staging_dir=$2
lock_dir=$3
case "$staging_dir" in
  "$deploy_root"/releases/.staging-*) rm -rf -- "$staging_dir" ;;
esac
rmdir "$lock_dir" 2>/dev/null || true
REMOTE_CLEANUP
    set -e
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

log "Checking the server and acquiring the deployment lock..."
RELEASE_STATE=$(ssh "${SSH_OPTIONS[@]}" "$DEPLOY_HOST" bash -s -- \
  "$DEPLOY_ROOT" "$RELEASE_DIR" "$STAGING_DIR" "$LOCK_DIR" \
  "$DEPLOY_COMMIT" "$PUBLIC_BASE_URL" "$POSTGRES_CONTAINER" <<'REMOTE_PREFLIGHT'
set -Eeuo pipefail
deploy_root=$1
release_dir=$2
staging_dir=$3
lock_dir=$4
deploy_commit=$5
public_base_url=$6
postgres_container=$7
lock_ok=0

release_lock_on_failure() {
  if [[ "$lock_ok" -eq 1 ]]; then
    rmdir "$lock_dir" 2>/dev/null || true
  fi
}
trap release_lock_on_failure EXIT

[[ $(id -u) -eq 0 ]] || { echo "Deployment SSH user must be root" >&2; exit 1; }
for command_name in docker sudo systemctl curl tar nginx; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "Missing server command: $command_name" >&2
    exit 1
  }
done
[[ -x /usr/local/bin/node ]] || { echo "/usr/local/bin/node is missing" >&2; exit 1; }
[[ -x /usr/local/bin/npm ]] || { echo "/usr/local/bin/npm is missing" >&2; exit 1; }
id agentroom >/dev/null 2>&1 || { echo "System user agentroom is missing" >&2; exit 1; }
[[ -r /etc/agentroom/backend.env ]] || { echo "/etc/agentroom/backend.env is missing" >&2; exit 1; }
[[ -L /etc/nginx/sites-enabled/try-status.online ]] || {
  echo "The try-status.online Nginx site is not enabled" >&2
  exit 1
}
[[ $(readlink -f /etc/nginx/sites-enabled/try-status.online) == \
    /etc/nginx/sites-available/try-status.online ]] || {
  echo "The enabled try-status.online Nginx site points to an unexpected file" >&2
  exit 1
}
nginx -t >/dev/null

configured_public_url=$(sed -n 's/^PUBLIC_BASE_URL=//p' /etc/agentroom/backend.env)
[[ "$configured_public_url" == "$public_base_url" ]] || {
  echo "PUBLIC_BASE_URL in /etc/agentroom/backend.env does not match $public_base_url" >&2
  exit 1
}

container_state=$(docker inspect --format '{{.State.Status}}' "$postgres_container" 2>/dev/null || true)
container_health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$postgres_container" 2>/dev/null || true)
[[ "$container_state" == "running" ]] || { echo "PostgreSQL container is not running" >&2; exit 1; }
[[ "$container_health" == "healthy" || "$container_health" == "none" ]] || {
  echo "PostgreSQL container is not healthy" >&2
  exit 1
}

install -d -m 0755 "$deploy_root" "$deploy_root/releases"
install -d -m 0700 "$deploy_root/backups"
mkdir "$lock_dir" 2>/dev/null || {
  echo "Another AgentRoom deployment holds $lock_dir" >&2
  exit 75
}
lock_ok=1

if [[ -e "$release_dir" ]]; then
  [[ -f "$release_dir/.agentroom-release" ]] || {
    echo "Existing release is incomplete: $release_dir" >&2
    exit 1
  }
  [[ $(cat "$release_dir/.agentroom-release") == "$deploy_commit" ]] || {
    echo "Existing release marker does not match its directory" >&2
    exit 1
  }
  [[ -f "$release_dir/backend/dist/api/server.js" ]] || {
    echo "Existing release has no compiled server" >&2
    exit 1
  }
  [[ -f "$release_dir/backend/artifacts/cli/manifest.json" ]] || {
    echo "Existing release has no packaged CLI" >&2
    exit 1
  }
  [[ -f "$release_dir/frontend/dist/index.html" ]] || {
    echo "Existing release has no compiled frontend" >&2
    exit 1
  }
  [[ -f "$release_dir/backend/deploy/nginx/try-status.online.conf" ]] || {
    echo "Existing release has no Nginx site configuration" >&2
    exit 1
  }
  printf 'reuse\n'
else
  install -d -m 0755 -o agentroom -g agentroom "$staging_dir"
  printf 'build\n'
fi

lock_ok=0
REMOTE_PREFLIGHT
)
REMOTE_LOCK_ACQUIRED=1

if [[ "$RELEASE_STATE" == "build" ]]; then
  log "Uploading the committed source archive..."
  git archive "$DEPLOY_COMMIT" |
    ssh "${SSH_OPTIONS[@]}" "$DEPLOY_HOST" \
      "tar -xf - -C '$STAGING_DIR'"

  log "Installing dependencies and building on the server..."
  ssh "${SSH_OPTIONS[@]}" "$DEPLOY_HOST" bash -s -- \
    "$STAGING_DIR" "$RELEASE_DIR" "$DEPLOY_COMMIT" \
    "$PUBLIC_BASE_URL" <<'REMOTE_BUILD'
set -Eeuo pipefail
staging_dir=$1
release_dir=$2
deploy_commit=$3
public_base_url=$4

chown -R agentroom:agentroom "$staging_dir"
sudo -u agentroom /usr/local/bin/npm --prefix "$staging_dir/backend" ci
sudo -u agentroom env \
  AGENTROOM_CLI_DOWNLOAD_BASE="$public_base_url/downloads/cli" \
  /usr/local/bin/npm --prefix "$staging_dir/backend" run build
sudo -u agentroom /usr/local/bin/npm --prefix "$staging_dir/backend" prune --omit=dev
sudo -u agentroom /usr/local/bin/npm --prefix "$staging_dir/frontend" ci
sudo -u agentroom env \
  VITE_API_BASE_URL="$public_base_url" \
  /usr/local/bin/npm --prefix "$staging_dir/frontend" run build
sudo -u agentroom /usr/local/bin/npm --prefix "$staging_dir/frontend" prune --omit=dev

[[ -f "$staging_dir/backend/dist/api/server.js" ]]
[[ -f "$staging_dir/backend/dist/database/migrate.js" ]]
[[ -f "$staging_dir/backend/dist/modules/docs/routes.js" ]]
[[ -f "$staging_dir/backend/artifacts/cli/manifest.json" ]]
[[ -f "$staging_dir/backend/artifacts/cli/install.sh" ]]
[[ -f "$staging_dir/backend/artifacts/cli/install.ps1" ]]
cli_bundle=$(/usr/local/bin/node -e \
  'const manifest=require(process.argv[1]); process.stdout.write(manifest.files.bundle.name)' \
  "$staging_dir/backend/artifacts/cli/manifest.json")
[[ "$cli_bundle" =~ ^[A-Za-z0-9._-]+$ ]]
[[ -f "$staging_dir/backend/artifacts/cli/$cli_bundle" ]]
[[ -f "$staging_dir/shared/contracts/http/openapi.yaml" ]]
[[ -f "$staging_dir/frontend/dist/index.html" ]]
compgen -G "$staging_dir/frontend/dist/assets/*.js" >/dev/null
grep -R -Fq "$public_base_url" "$staging_dir/frontend/dist"
[[ -f "$staging_dir/backend/deploy/nginx/try-status.online.conf" ]]

printf '%s\n' "$deploy_commit" >"$staging_dir/.agentroom-release"
chmod 0444 "$staging_dir/.agentroom-release"
mv "$staging_dir" "$release_dir"
REMOTE_BUILD
elif [[ "$RELEASE_STATE" == "reuse" ]]; then
  log "Release already exists and passed integrity checks; reusing it."
else
  fail "Unexpected server release state: $RELEASE_STATE"
fi

if [[ "$BACKUP_DATABASE" -eq 1 ]]; then
  log "Creating a PostgreSQL backup before migrations..."
  DATABASE_BACKUP=$(ssh "${SSH_OPTIONS[@]}" "$DEPLOY_HOST" bash -s -- \
    "$DEPLOY_ROOT" "$DEPLOY_COMMIT" "$POSTGRES_CONTAINER" \
    "$POSTGRES_USER" "$POSTGRES_DATABASE" <<'REMOTE_BACKUP'
set -Eeuo pipefail
deploy_root=$1
deploy_commit=$2
postgres_container=$3
postgres_user=$4
postgres_database=$5
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
backup_path="$deploy_root/backups/postgres-$timestamp-${deploy_commit:0:12}-$$.dump"
temporary_path="$backup_path.tmp"
trap 'rm -f -- "$temporary_path"' EXIT
docker exec "$postgres_container" pg_dump \
  -U "$postgres_user" -d "$postgres_database" -Fc >"$temporary_path"
[[ -s "$temporary_path" ]]
chmod 0600 "$temporary_path"
mv "$temporary_path" "$backup_path"
trap - EXIT
printf '%s\n' "$backup_path"
REMOTE_BACKUP
  )
  log "Database backup: $DATABASE_BACKUP"
else
  DATABASE_BACKUP=skipped
  log "Database backup skipped by explicit request."
fi

log "Switching the frontend and backend and running health checks..."
ssh "${SSH_OPTIONS[@]}" "$DEPLOY_HOST" bash -s -- \
  "$DEPLOY_ROOT" "$RELEASE_DIR" "$DEPLOY_COMMIT" \
  "$PUBLIC_BASE_URL" "$FRONTEND_PUBLIC_URL" <<'REMOTE_SWITCH'
set -Eeuo pipefail
deploy_root=$1
release_dir=$2
deploy_commit=$3
public_base_url=$4
frontend_public_url=$5
service_name=agentroom.service
nginx_service=nginx.service
unit_path=/etc/systemd/system/agentroom.service
nginx_site_path=/etc/nginx/sites-available/try-status.online
old_release=$(readlink -f "$deploy_root/current" 2>/dev/null || true)
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
unit_backup="$deploy_root/backups/systemd-$timestamp-${deploy_commit:0:12}.service"
nginx_site_backup="$deploy_root/backups/nginx-$timestamp-${deploy_commit:0:12}.conf"
had_unit=0
had_nginx_site=0

if [[ -f "$unit_path" ]]; then
  cp -a "$unit_path" "$unit_backup"
  had_unit=1
fi
if [[ -f "$nginx_site_path" ]]; then
  cp -a "$nginx_site_path" "$nginx_site_backup"
  had_nginx_site=1
fi

rollback() {
  local reason=$1
  echo "Deployment check failed: $reason" >&2
  journalctl -u "$service_name" -n 60 --no-pager >&2 || true
  journalctl -u "$nginx_service" -n 30 --no-pager >&2 || true
  if [[ -n "$old_release" ]]; then
    rollback_link="$deploy_root/.current-rollback-$$"
    ln -s "$old_release" "$rollback_link"
    mv -Tf "$rollback_link" "$deploy_root/current"
  else
    rm -f -- "$deploy_root/current"
  fi
  if [[ "$had_unit" -eq 1 ]]; then
    cp -a "$unit_backup" "$unit_path"
  else
    rm -f -- "$unit_path"
  fi
  if [[ "$had_nginx_site" -eq 1 ]]; then
    cp -a "$nginx_site_backup" "$nginx_site_path"
  else
    rm -f -- "$nginx_site_path"
  fi
  systemctl daemon-reload
  if [[ -n "$old_release" ]]; then
    systemctl restart "$service_name" || true
  else
    systemctl stop "$service_name" || true
  fi
  if nginx -t; then
    systemctl reload "$nginx_service" || true
  fi
  exit 1
}

install -m 0644 "$release_dir/backend/deploy/systemd/agentroom.service" "$unit_path"
install -m 0644 \
  "$release_dir/backend/deploy/nginx/try-status.online.conf" \
  "$nginx_site_path"
nginx -t || rollback "nginx configuration"
next_link="$deploy_root/.current-$deploy_commit-$$"
ln -s "$release_dir" "$next_link"
mv -Tf "$next_link" "$deploy_root/current"
systemctl daemon-reload
systemctl enable "$service_name" >/dev/null
systemctl restart "$service_name" || rollback "systemd restart"
systemctl reload "$nginx_service" || rollback "nginx reload"

healthy=0
attempt=1
while [[ "$attempt" -le 30 ]]; do
  if curl --max-time 5 --silent --fail \
    http://127.0.0.1:18787/health >/dev/null; then
    healthy=1
    break
  fi
  sleep 1
  attempt=$((attempt + 1))
done
[[ "$healthy" -eq 1 ]] || rollback "loopback health endpoint"

public_healthy=0
attempt=1
while [[ "$attempt" -le 10 ]]; do
  if curl --max-time 8 --silent --fail \
      "$public_base_url/health" >/dev/null &&
    curl --max-time 8 --silent --fail \
      "$public_base_url/openapi.yaml" | grep -Fq "url: $public_base_url"; then
    if curl --max-time 8 --silent --fail \
        "$public_base_url/downloads/cli/manifest.json" |
      grep -Fq '"schemaVersion":1'; then
      public_healthy=1
      break
    fi
  fi
  sleep 1
  attempt=$((attempt + 1))
done
[[ "$public_healthy" -eq 1 ]] || rollback "public API, OpenAPI, or CLI download endpoint"

frontend_healthy=0
attempt=1
while [[ "$attempt" -le 10 ]]; do
  frontend_html=$(curl --max-time 8 --silent --fail \
    "$frontend_public_url/" 2>/dev/null || true)
  deep_link_html=$(curl --max-time 8 --silent --fail \
    "$frontend_public_url/rooms" 2>/dev/null || true)
  asset_path=$(printf '%s' "$frontend_html" |
    sed -n 's/.*src="\([^"]*\.js\)".*/\1/p' | head -n 1)
  if printf '%s' "$frontend_html" | grep -Fq '<div id="root"></div>' &&
    printf '%s' "$deep_link_html" | grep -Fq '<div id="root"></div>' &&
    [[ "$asset_path" =~ ^/assets/[A-Za-z0-9._-]+\.js$ ]] &&
    curl --max-time 8 --silent --fail \
      "$frontend_public_url$asset_path" >/dev/null; then
    frontend_healthy=1
    break
  fi
  sleep 1
  attempt=$((attempt + 1))
done
[[ "$frontend_healthy" -eq 1 ]] || rollback "frontend root, deep link, or JavaScript asset"

if [[ -n "$old_release" && "$old_release" != "$release_dir" ]]; then
  previous_link="$deploy_root/.previous-$deploy_commit-$$"
  ln -s "$old_release" "$previous_link"
  mv -Tf "$previous_link" "$deploy_root/previous"
fi

systemctl is-active --quiet "$service_name" || rollback "final service state"
systemctl is-active --quiet "$nginx_service" || rollback "final nginx state"
actual_previous=$(readlink -f "$deploy_root/previous" 2>/dev/null || true)
printf 'release=%s\n' "$release_dir"
printf 'previous=%s\n' "${actual_previous:-none}"
REMOTE_SWITCH

log "Deployment complete."
log "Release: $RELEASE_DIR"
log "Previous release remains available for rollback."
log "Database backup: $DATABASE_BACKUP"
