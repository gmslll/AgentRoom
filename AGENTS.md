# AgentRoom repository instructions

## Product

AgentRoom is a web-based room where humans, local terminals, and AI agents can
exchange messages and files. A user creates a room in the web client and can
connect terminals or agents to it by room ID.

## Repository map

- `frontend/`: web client, owned by the frontend developer.
- `backend/`: API, realtime transport, persistence, file handling, and agent or
  terminal integrations, owned by the backend developer.
- `shared/contracts/`: language-neutral HTTP and realtime protocol contracts.
- `docs/`: product, architecture, protocol, and operations documentation.
- `scripts/`: scripts that operate on the whole repository. Keep app-specific
  scripts inside their application directory.

## Change boundaries

- Identify whether a task is frontend, backend, contract, or cross-cutting
  before editing files.
- For frontend-only tasks, do not modify `backend/` unless the user explicitly
  requests a coordinated backend change.
- For backend-only tasks, do not modify `frontend/` unless the user explicitly
  requests a coordinated frontend change.
- A protocol change must update `shared/contracts/` in the same change. Keep
  contracts implementation-neutral; do not place framework or business logic
  there.
- Do not add application dependencies or build configuration at the repository
  root. Each application must install, run, test, and build independently.
- Do not commit secrets, local databases, generated uploads, installed
  dependencies, or build output.

## Working approach

- Read the nearest `AGENTS.md` before changing a subtree.
- Treat existing user changes as intentional and avoid unrelated rewrites.
- Do not invent setup, lint, or test commands. Inspect the relevant manifest or
  README first; the technology stacks have not been selected yet.
- Keep public protocol behavior documented and versionable.
- Add or update tests with behavioral changes once a test setup exists.
- Report which application and contract surfaces changed when handing work off.

## Code review rules

- Flag changes that couple frontend code to backend runtime internals.
- Flag API or realtime event changes that do not update shared contracts.
- Flag committed credentials, tokens, local data, or uploaded user files.
- Flag root-level dependencies that belong to only one application.
