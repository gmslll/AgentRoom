# Frontend agent instructions

- This subtree belongs to the frontend application and its owner.
- Do not modify `../backend/` for frontend-only tasks.
- Use `../shared/contracts/` as the source of truth for HTTP and realtime
  behavior; do not import backend runtime code.
- Keep dependencies, configuration, assets, tests, and `.env.example` local to
  this directory.
- Inspect the application manifest before choosing commands. No frontend stack
  has been selected yet.
