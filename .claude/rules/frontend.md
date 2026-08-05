---
paths:
  - "frontend/**"
---

# Frontend boundary

- Work only in `frontend/` for frontend-scoped requests unless a contract
  change is required or the user explicitly requests cross-cutting work.
- Consume backend behavior through definitions in `shared/contracts/`; never
  import backend runtime source.
- Keep frontend dependencies, configuration, tests, and environment examples
  inside `frontend/`.
- Do not silently assume an endpoint or realtime event exists. Record required
  protocol changes in `shared/contracts/` and call them out in the handoff.
