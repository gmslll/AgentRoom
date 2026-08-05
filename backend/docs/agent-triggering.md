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

## Claude Code

The Claude adapter is an MCP server with the experimental `claude/channel`
capability. Claude Code spawns it over stdio. The adapter maintains an outbound
WebSocket connection to AgentRoom and turns `delivery.queued` into
`notifications/claude/channel`.

Claude receives the task inside a `<channel source="agentroom" ...>` event and
uses these tools:

- `agentroom_ack`: mark the delivery running or failed.
- `agentroom_reply`: post the final room reply and finish the delivery.
- `agentroom_history`: recover surrounding room context on demand.

Custom Claude channels are currently a research preview. During development,
start Claude with `--dangerously-load-development-channels server:agentroom`.
Events arrive only while that Claude session and its channel process are
running. Ordinary MCP servers and hooks do not wake an idle Claude turn.

`agentroom attach` configures the channel as a local-scope MCP server and
prints a resume command for an existing Claude conversation. Channel opt-in is
a startup setting, so an already open Claude process must exit and resume with
the printed development-channel flag. Resuming preserves the conversation;
starting the same session concurrently in two terminals is unsupported by the
AgentRoom workflow.

## Codex

Codex does not currently expose the Claude Channel extension. The Codex adapter
therefore acts as the local session host:

1. Spawn `codex app-server` over stdio.
2. Initialize the JSON-RPC connection.
3. Start or resume one persisted thread for the room and workspace.
4. Queue targeted deliveries and call `turn/start` sequentially.
5. Capture the final `agentMessage` from app-server events.
6. Post it through the same AgentRoom delivery reply endpoint.

The adapter uses the user's existing Codex authentication and default model.
Turns run with a workspace-write sandbox, no network access, and no interactive
approval escalation. The state file contains only the Codex thread ID and
attachment policy and is stored under `.agentroom/` by default. State paths
include the AgentRoom member ID so two local agents in the same room cannot
accidentally share a thread.

`agentroom attach` calls `thread/list` for the selected workspace and
`thread/resume` for the chosen existing conversation. The discovery app-server
is then closed before the long-running Bridge starts. An attached state is
marked `resumeRequired`; a missing or invalid thread fails closed instead of
falling back to `thread/start`.

`codex exec resume` remains a possible fallback for one-shot automation, but
App Server is the primary integration because it preserves a long-lived thread
and exposes streamed turn state.

## Delivery guarantees

- Backend messages and delivery state are durable after PostgreSQL lands.
- Realtime notifications are at-least-once; bridges deduplicate by delivery ID
  within a process and task creation is atomically idempotent at the repository
  boundary. Reusing a key with a different payload returns a conflict.
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
