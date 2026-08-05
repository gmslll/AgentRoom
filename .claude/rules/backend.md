---
paths:
  - "backend/**"
---

# Backend boundary

- Work only in `backend/` for backend-scoped requests unless a contract change
  is required or the user explicitly requests cross-cutting work.
- Keep backend dependencies, migrations, tests, service configuration, and
  environment examples inside `backend/`.
- Update `shared/contracts/` whenever public HTTP or realtime behavior changes.
- Treat room access, file uploads, path handling, credentials, and agent-issued
  actions as security-sensitive input boundaries.
- Respect the backend runtime boundaries: compose processes in `src/api/`, keep
  business behavior in `src/modules/`, keep downloadable CLI/provider adapters
  in `src/connectors/`, shared runtime DTOs in `src/protocol/`, and migration
  tooling in `src/database/`.
- Mirror source boundaries under `backend/test/`; do not import API composition
  from business modules or connector implementations.
