# Starts the local development infrastructure (Redis + MinIO) via docker.
# Run from the backend/ directory:
#   powershell -ExecutionPolicy Bypass -File scripts/dev-infra.ps1
$ErrorActionPreference = "Stop"
$compose = Join-Path $PSScriptRoot "..\deploy\docker-compose.dev.yml"

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Write-Error "docker is required to run the local development infrastructure."
  exit 1
}

Write-Host "Starting Redis + MinIO for local development..."
docker compose -f $compose up -d

Write-Host "Waiting for services to become healthy..."
docker compose -f $compose wait redis minio

Write-Host ""
Write-Host "Redis:   redis://127.0.0.1:6379"
Write-Host "MinIO:   http://127.0.0.1:9000 (console http://127.0.0.1:9001, agentroom / agentroom-dev-password)"
Write-Host "Stop with: docker compose -f $compose down"
