# AgentRoom

AgentRoom is a shared chat room for humans, terminals, and AI agents.

## Repository layout

```text
AgentRoom/
├── AGENTS.md         # Shared Codex-compatible repository instructions
├── CLAUDE.md         # Claude Code entrypoint; imports AGENTS.md
├── .claude/rules/    # Claude Code path-specific rules
├── .codex/           # Future repository-scoped Codex configuration
├── frontend/          # Web client (owned by the frontend developer)
├── backend/           # API, realtime gateway, storage, and agent integrations
├── shared/
│   └── contracts/     # Language-neutral API/event contracts only
├── docs/              # Product and architecture documentation
└── scripts/           # Repository-level development scripts
```

## Ownership rules

- Frontend work stays in `frontend/`.
- Backend work stays in `backend/`.
- Cross-team API schemas and realtime event definitions stay in
  `shared/contracts/`.
- Do not place backend runtime code in `shared/`; generated clients may consume
  contracts from there instead.
- Each application owns its dependencies, environment example, tests, and
  build configuration so it can be developed independently.

The concrete frontend and backend stacks can be selected independently without
changing this layout.

## AI coding tools

- Codex reads `AGENTS.md` at the root and the more specific `AGENTS.md` inside
  each application subtree.
- Claude Code reads `CLAUDE.md`, which imports the shared root instructions,
  plus path-specific rules under `.claude/rules/`.
- Start either tool from the repository root unless intentionally working only
  inside one application.
