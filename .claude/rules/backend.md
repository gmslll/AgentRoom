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
