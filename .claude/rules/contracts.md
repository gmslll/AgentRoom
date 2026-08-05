---
paths:
  - "shared/contracts/**"
---

# Shared contract boundary

- Store only language-neutral, source-controlled protocol definitions here.
- Prefer OpenAPI for HTTP APIs and JSON Schema or AsyncAPI for realtime events.
- Keep identifiers, timestamps, error shapes, compatibility expectations, and
  file metadata explicit.
- Do not add application business logic, framework imports, secrets, generated
  runtime data, or installed dependencies.
- Check the impact on both `frontend/` and `backend/` before making a breaking
  contract change.
