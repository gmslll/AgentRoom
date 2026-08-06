# Agent triggering

AgentRoom separates chat delivery from agent execution. A normal message is
visible to room members but never starts an AI turn. Only an explicit
`agent.task` addressed to concrete agent member IDs creates executable
deliveries.

## Shared lifecycle

```text
agent.task committed
        |
        +-- delivery.queued (target member only)
                |
                +-- received
                        |
                        +-- running
                              |-- replied
                              `-- failed
```

Each task requires an idempotency key scoped to the sender and room. One
delivery is created per target agent. Terminal states cannot be reopened. In
the MVP, only the room owner may create an `agent.task`; joining a room does not
grant permission to control another person's terminal.

Bridges recover non-terminal deliveries from the HTTP API after reconnecting.
Realtime delivery is an optimization, not the durable queue.
Every successful WebSocket connection performs this recovery before relying on
new realtime events.

## Local session cards

Each bridge persists a provider-addressed session card before acknowledging or
dispatching a task. Cards live under:

```text
<workspace>/.agentroom/session-cards/<provider>/<room-id>/<delivery-id>/
├── card.json
├── server_received.json
├── dispatch_started.json
├── host_delivered.json
├── agent_acknowledged.json
├── completed.json
└── failed.json
```

`card.json` contains the immutable delivery identity, task message, attachment
IDs, and sender metadata, but never the member access token. It is published
only after a complete mode-`0600` temporary file has been flushed; the room and
delivery directories are mode `0700`. Evidence files are immutable and
idempotent, so a reconnect cannot move local evidence backward or rewrite a
different task under an existing delivery ID.

PostgreSQL remains the source of truth. The local card is a crash-recovery
inbox and diagnostic record, not a second task authority. WebSocket and HTTP
recovery still decide which deliveries are pending.

## Claude Code

The Claude adapter is an MCP server with the experimental `claude/channel`
capability. Claude Code spawns it over stdio. The adapter maintains an outbound
WebSocket connection to AgentRoom and turns `delivery.queued` into
`notifications/claude/channel`.

Claude receives the task inside a `<channel source="agentroom" ...>` event;
the channel metadata includes its local session-card path. Claude uses these
tools:

- `agentroom_ack`: mark the delivery running or failed.
- `agentroom_reply`: post the final room reply and finish the delivery.
- `agentroom_history`: recover surrounding room context on demand.

Custom Claude channels are currently a research preview. During development,
start Claude with `--dangerously-load-development-channels server:agentroom`.
Events arrive only while that Claude session and its channel process are
running. Ordinary MCP servers and hooks do not wake an idle Claude turn.

`agentroom join` and `agentroom attach` configure the channel as a local-scope
MCP server, so Claude starts the CLI receiver itself. `join` prints a fresh
Claude startup command and `attach` prints a resume command for an existing
conversation. Channel opt-in is a startup setting, so an already open Claude
process must exit and resume with the printed development-channel flag.
Resuming preserves the conversation; starting the same session concurrently in
two terminals is unsupported by the AgentRoom workflow.

## Codex

Codex does not currently expose the Claude Channel extension. The Codex adapter
therefore acts as the local session host:

1. `join`/`attach` configures one user-level `agentroom_receiver` stdio MCP.
2. Codex starts that MCP in its current workspace; it scans only direct JSON
   files under that workspace's private `.agentroom/` directory.
3. The MCP supervises one process-locked Bridge per Codex room config.
4. On the first targeted task, the Bridge spawns `codex app-server`, initializes
   JSON-RPC, and starts or resumes one persisted thread.
5. Persist a local session card, queue targeted deliveries, and call
   `turn/start` sequentially.
6. Capture the final `agentMessage` from app-server events.
7. Post it through the same AgentRoom delivery reply endpoint.

The MCP exposes `agentroom_receiver_status` and
`agentroom_receiver_rescan` for local diagnostics. These tools never reveal
the member token. Multiple Codex sessions in one workspace are safe: the
member-config lock selects one receiver, and another MCP takes over after the
owner exits. Closing Codex closes its MCP children; a still-open sibling Codex
session discovers the released config on its next scan.

The App Server `turn/start` response records `host_delivered` and
`agent_acknowledged`; merely putting the delivery in the local worker queue
records only `dispatch_started`.

The adapter uses the user's existing Codex authentication and default model.
Turns run with a workspace-write sandbox, no network access, and no interactive
approval escalation. The state file contains only the Codex thread ID and
attachment policy and is stored under `.agentroom/` by default. State paths
include the AgentRoom member ID so two local agents in the same room cannot
accidentally share a thread.

`agentroom attach` calls `thread/list` for the selected workspace and
`thread/resume` for the chosen existing conversation. The discovery app-server
is then closed before the provider-started MCP owns the long-running Bridge.
An attached state is marked `resumeRequired`; a missing or invalid thread fails
closed instead of falling back to `thread/start`.

`codex exec resume` remains a possible fallback for one-shot automation, but
App Server is the primary integration because it preserves a long-lived thread
and exposes streamed turn state.

## Delivery guarantees

- Backend messages and delivery state are durable after PostgreSQL lands.
- Realtime notifications are at-least-once; bridges deduplicate by delivery ID
  within a process and task creation is atomically idempotent at the repository
  boundary. Reusing a key with a different payload returns a conflict.
- Local session cards are also at-least-once and idempotent. A reused delivery
  ID with different immutable task content fails closed instead of overwriting
  the original card.
- A process crash after a tool or command runs but before reply can repeat work
  during recovery. Destructive agent actions therefore need their own
  idempotency key or human approval.
- Claude Channel notifications do not provide a processed acknowledgment.
  `received` means the bridge wrote the event; `running` is explicit agent
  acknowledgment.
- Agent replies are passive and never create another delivery. Agent-to-agent
  work must be a new, explicitly targeted task.
- Bridge HTTP and Codex protocol calls have bounded timeouts. Oversized final
  replies and failure details are truncated to the public HTTP contract limits.

## Security boundaries

- Authenticate the sender and target member independently of the room ID.
- Never treat room membership as permission to trigger an agent.
- Treat task text, links, and files as untrusted prompt input.
- Do not automatically execute uploaded files.
- Keep raw member tokens in a local secret store or environment variable and
  never put them in command arguments, source control, or logs.
- Use the least sandbox and network permissions required by the local agent.

## Upstream references

- [Claude Code Channels](https://code.claude.com/docs/en/channels)
- [Claude Code Channels protocol](https://code.claude.com/docs/en/channels-reference)
- [Codex App Server](https://learn.chatgpt.com/docs/app-server)
- [Codex non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode)
