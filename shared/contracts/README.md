# Shared contracts

This directory is the boundary between the frontend and backend.

Store language-neutral, source-controlled contracts here, for example:

- OpenAPI specifications
- JSON Schema files
- AsyncAPI or WebSocket event definitions
- generated-client configuration

Do not put application business logic, framework code, secrets, or installed
dependencies here.

## Current contracts

- `http/openapi.yaml`: versioned HTTP control and command API.
- `realtime/event.schema.json`: WebSocket events emitted by the server.

The realtime WebSocket endpoint is `GET /v1/realtime?ticket=...`. Obtain the
short-lived, single-use ticket through the authenticated HTTP API first.

Human clients can register and log in through `/v1/auth/*`. Account sessions
use expiring, revocable `ars_` bearer tokens. Room and bridge capabilities use
room-scoped `art_` tokens. Room operations accept either token when the account
is linked to that room membership; `GET /v1/rooms` lists those linked
memberships. Guest room creation and anonymous invite joins are retained.
Room owners can fetch structured, non-secret CLI metadata through
`GET /v1/rooms/{roomId}/connector`; the invite code remains separate so it is
not exposed in copied shell commands. `connector.command` starts a new local
agent session, while `connector.attachCommand` binds an existing Claude or
Codex conversation.

Normal `text` messages never start an agent. An explicit `agent.task` names one
or more agent member IDs and creates a delivery for each target. Bridges recover
pending deliveries over HTTP and receive `delivery.queued` in realtime.
Authenticated clients discover target IDs through `GET
/v1/rooms/{roomId}/members`; active WebSocket clients also receive
`member.joined` when a new human, terminal, or agent joins.
