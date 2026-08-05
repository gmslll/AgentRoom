# Backend agent instructions

- This subtree belongs to the backend application and its owner.
- Do not modify `../frontend/` for backend-only tasks.
- Publish public HTTP and realtime behavior through `../shared/contracts/`.
- Keep dependencies, migrations, service configuration, tests, and
  `.env.example` local to this directory.
- Validate all room IDs, actor identities, file metadata, filenames, and agent
  inputs at trust boundaries.
- Inspect the application manifest before choosing commands. No backend stack
  has been selected yet.
