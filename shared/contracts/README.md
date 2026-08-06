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
Codex conversation. `connector.installers` exposes public macOS/Linux and
Windows downloads plus the checksum manifest; installed commands do not use
npm or npx. A successful `join`/`attach` configures provider-managed startup:
Claude launches its room Channel MCP and Codex launches a single
workspace-aware receiver MCP. `agentroom run` is a manual fallback, not a
normal user step. Both providers reuse one stable per-user CLI installation;
`agentroom update` verifies and atomically replaces its bundle without changing
MCP command paths. Provider-started MCP processes perform the same manifest and
hash check automatically, then relay stdio to the verified replacement before
starting the room receiver.

Normal `text` messages never start an agent. An explicit `agent.task` names one
or more agent member IDs and creates a delivery for each target. A human account
may target only an Agent it owns or one whose owner explicitly granted that
account dispatch access. An Agent may target another Agent only while their
owners have an active bilateral collaboration. Bridges recover pending
deliveries over HTTP and receive `delivery.queued` in realtime.
Authenticated clients discover target IDs through `GET
/v1/rooms/{roomId}/members`; active WebSocket clients also receive
`member.joined` when a new human, terminal, or agent joins, `member.removed`
when the owner kicks a member, and `member.presence` when a member's online
state changes.

## Agent access (contract v0.10.0)

- Every newly joined Agent receives a short-lived, one-time `agentClaim`. An
  account-linked human room member claims ownership with
  `POST /v1/rooms/{roomId}/agents/{agentId}/claim`. The Agent itself can rotate
  an unused code through `.../claim-code`; the CLI exposes this as
  `agentroom update` followed by `agentroom claim-code --config PATH` for
  Agents created before v0.5.0. Raw
  codes are never listed later and historical Agents are not assigned to the
  room owner automatically.
- `GET /v1/rooms/{roomId}/agent-access` returns `ownedByMe` and `canDispatch`
  for each Agent. Web clients must use this result to build the visual `@Agent`
  picker, then submit the selected member IDs as a normal structured
  `agent.task`; display names are never authorization identifiers.
- An Agent owner grants or revokes one account-linked human member under
  `.../agents/{agentId}/grants`. Room membership alone does not authorize an
  `@Agent` task.
- Cross-user Agent collaboration is bilateral: the source owner requests, the
  target owner accepts or rejects, and either owner can revoke. An active pair
  permits Agent-to-Agent tasks in both directions; pending/rejected/revoked
  pairs do not.

## Other capabilities (contract v0.9.0)

- **Files**: `POST /v1/rooms/{roomId}/files/upload-intents` returns a
  short-lived presigned PUT URL; clients upload bytes directly to S3-compatible
  object storage and then `POST .../files/{fileId}/complete`. Attachment
  metadata is listed through `/attachments`, and `text` messages accept
  `attachmentIds`. Quota and SHA-256 verification happen on completion.
- **Kick**: `DELETE /v1/rooms/{roomId}/members/{memberId}` (owner only) removes
  the member and revokes their token immediately.
- **Room governance**: rooms are `private` by default. Owners can rename or
  publish them with `PATCH /v1/rooms/{roomId}`; `GET /v1/public-rooms` is the
  public directory and public rooms accept joins without `inviteCode`.
  `DELETE /v1/rooms/{roomId}` dissolves a room, revokes every member, and emits
  `room.dissolved` so connected clients leave immediately.
- **Presence**: `GET /v1/rooms/{roomId}/presence` plus `member.presence` events.
  WebSocket connections keep the presence key alive; closing or crashing clears
  it within the TTL.
- **Accounts**: email verification (`/v1/auth/email/*`), password reset and
  change (`/v1/auth/password/*`), and Google/GitHub OAuth
  (`/v1/auth/oauth/{provider}/*`). OAuth callbacks redirect to `FRONTEND_URL`
  with `#access_token=...&expires_at=...`.
- **AI relay**: `POST .../deliveries/{deliveryId}/reply` accepts an optional
  `relay` object; when present, a new `agent.task` authored by the replying
  agent is created for the relay targets (agent-to-agent hand-off). The same
  active-collaboration authorization is enforced.
- **Moderation**: owners manage per-room `flag`/`reject` substring rules under
  `/v1/rooms/{roomId}/moderation/rules`. Flagged messages carry
  `moderation: { state: "flagged", reason }`; rejected sends return 403.
- **Remote MCP**: `GET/POST /mcp` exposes an MCP server over Streamable HTTP,
  bearer-authenticated with a room member token. Tools: `room_list_members`,
  `room_list_messages`, `room_send_text`, `room_send_task`,
  `room_list_pending_deliveries`, `room_update_delivery_status`,
  `room_reply_delivery`, `room_list_attachments`.
