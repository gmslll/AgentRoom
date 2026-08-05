#!/usr/bin/env sh
# Starts the local development infrastructure (Redis + MinIO) via docker.
# Run from the backend/ directory:
#   sh scripts/dev-infra.sh
set -eu

compose="$(dirname "$0")/../deploy/docker-compose.dev.yml"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required to run the local development infrastructure." >&2
  exit 1
fi

echo "Starting Redis + MinIO for local development..."
docker compose -f "$compose" up -d

echo "Waiting for services to become healthy..."
docker compose -f "$compose" wait redis minio

echo ""
echo "Redis:   redis://127.0.0.1:6379"
echo "MinIO:   http://127.0.0.1:9000 (console http://127.0.0.1:9001, agentroom / agentroom-dev-password)"
echo "Stop with: docker compose -f $compose down"
