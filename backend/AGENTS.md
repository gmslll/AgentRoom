# Backend agent instructions

- This subtree belongs to the backend application and its owner.
- Do not modify `../frontend/` for backend-only tasks.
- Publish public HTTP and realtime behavior through `../shared/contracts/`.
- Keep dependencies, migrations, service configuration, tests, and
  `.env.example` local to this directory.
- Validate all room IDs, actor identities, file metadata, filenames, and agent
  inputs at trust boundaries.
- Inspect the application manifest before choosing commands. The backend uses
  TypeScript on Node.js 22 with Fastify, Vitest, and PostgreSQL adapters.

## Source boundaries

- `src/api/` is the composition and process boundary. Keep business rules out
  of route bootstrapping and configuration parsing.
- `src/modules/` contains vertical business modules. A module may depend on
  another module only through explicit service, repository, or exported type
  interfaces; modules must never import `src/api/`.
- `src/connectors/` contains the downloadable AgentRoom CLI and provider
  adapters. Treat it as an external client of the HTTP/realtime protocol; do
  not couple it to API composition or persistence implementations.
- `src/protocol/` contains runtime-only TypeScript DTOs shared by modules and
  connectors. Keep the canonical language-neutral contract in
  `../shared/contracts/` and update both when public behavior changes.
- `src/database/` owns migration tooling, while ordered SQL remains in
  `migrations/`.
- `scripts/` owns backend build/release tooling. `artifacts/cli/` is generated,
  ignored output and must be rebuilt instead of edited or committed.
- `src/lib/` is only for small genuinely cross-module primitives. Do not use it
  as a dumping ground for business logic.
- Keep `test/` paths aligned with the corresponding `src/` boundary.
