#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { resolve } from "node:path";
import { localCliInvocation } from "../session-attach.js";
import { CodexMcpSupervisor } from "./mcp-supervisor.js";

const workspace = resolve(
  process.env.AGENTROOM_DISCOVERY_WORKSPACE ?? process.cwd(),
);
const supervisor = new CodexMcpSupervisor({
  workspace,
  cli: localCliInvocation(),
});
const mcp = new Server(
  { name: "agentroom-receiver", version: "0.6.1" },
  {
    capabilities: { tools: {} },
    instructions:
      "This MCP automatically starts AgentRoom Codex receivers configured under the current workspace's private .agentroom directory. " +
      "When the session was started through AgentRoom, targeted room tasks execute in the same Remote TUI thread and appear in the visible Codex CLI. " +
      "Use agentroom_receiver_status to diagnose room connectivity; realtimeStatus=connected is authoritative, while processStatus only describes the local process. " +
      "Use agentroom_history to read ordinary room chat and agentroom_send to proactively post an ordinary text message. " +
      "History and targeted tasks include attachment IDs only; they never download file bytes. Use agentroom_attachment_info or agentroom_attachment_download for one attachment only when needed. " +
      "Use file_paths on send or dispatch to upload files and images from the configured workspace. " +
      "Use agentroom_dispatch only when an Agent owner-approved collaboration allows this Agent to target another Agent. " +
      "Normal room chat messages never start an agent task. Never read private .agentroom bridge configs or expose member tokens.",
  },
);

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "agentroom_receiver_status",
      description:
        "List AgentRoom Codex receivers discovered in this workspace without exposing member tokens",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
    },
    {
      name: "agentroom_receiver_rescan",
      description:
        "Rescan this workspace for newly joined AgentRoom Codex bridge configs",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
    },
    {
      name: "agentroom_history",
      description:
        "Read messages and attachment references without downloading file bytes",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          room_id: { type: "string", minLength: 1 },
          member_id: { type: "string", minLength: 1 },
          after_sequence: { type: "integer", minimum: 0 },
          limit: { type: "integer", minimum: 1, maximum: 200 },
        },
        required: ["room_id", "member_id"],
      },
    },
    {
      name: "agentroom_attachment_info",
      description:
        "Get metadata for one referenced attachment without downloading its bytes",
      inputSchema: attachmentInputSchema(),
    },
    {
      name: "agentroom_attachment_download",
      description:
        "Download one referenced attachment on demand into the private configured workspace directory",
      inputSchema: attachmentInputSchema(),
    },
    {
      name: "agentroom_send",
      description:
        "Post an ordinary text message as one configured AgentRoom membership without exposing its token",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          room_id: { type: "string", minLength: 1 },
          member_id: { type: "string", minLength: 1 },
          text: { type: "string", minLength: 1, maxLength: 8_000 },
          file_paths: filePathsSchema(),
        },
        required: ["room_id", "member_id", "text"],
      },
    },
    {
      name: "agentroom_dispatch",
      description:
        "Dispatch a targeted Agent task; the server requires an owner-approved collaboration for Agent-to-Agent use",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          room_id: { type: "string", minLength: 1 },
          member_id: { type: "string", minLength: 1 },
          text: { type: "string", minLength: 1, maxLength: 8_000 },
          target_member_ids: {
            type: "array",
            minItems: 1,
            maxItems: 10,
            items: { type: "string", minLength: 1 },
          },
          idempotency_key: { type: "string", minLength: 8, maxLength: 100 },
          file_paths: filePathsSchema(),
        },
        required: [
          "room_id",
          "member_id",
          "text",
          "target_member_ids",
          "idempotency_key",
        ],
      },
    },
  ],
}));

mcp.setRequestHandler(CallToolRequestSchema, async (request) => {
  const args = asObject(request.params.arguments);
  if (request.params.name === "agentroom_history") {
    const history = await supervisor.listMessages({
      roomId: requiredString(args, "room_id"),
      memberId: requiredString(args, "member_id"),
      afterSequence: boundedInteger(args, "after_sequence", 0, 0, undefined),
      limit: boundedInteger(args, "limit", 50, 1, 200),
    });
    return toolJson(history);
  }
  if (request.params.name === "agentroom_send") {
    const text = requiredString(args, "text");
    if (text.length > 8_000) {
      throw new Error("text must be at most 8000 characters");
    }
    const message = await supervisor.sendTextMessage({
      roomId: requiredString(args, "room_id"),
      memberId: requiredString(args, "member_id"),
      text,
      filePaths: optionalStringArray(args, "file_paths", 10),
    });
    return toolJson({ message });
  }
  if (request.params.name === "agentroom_dispatch") {
    const text = requiredString(args, "text");
    if (text.length > 8_000) {
      throw new Error("text must be at most 8000 characters");
    }
    const result = await supervisor.sendAgentTask({
      roomId: requiredString(args, "room_id"),
      memberId: requiredString(args, "member_id"),
      text,
      targetMemberIds: requiredStringArray(args, "target_member_ids", 10),
      idempotencyKey: requiredString(args, "idempotency_key"),
      filePaths: optionalStringArray(args, "file_paths", 10),
    });
    return toolJson(result);
  }
  if (request.params.name === "agentroom_attachment_info") {
    const result = await supervisor.getAttachment({
      roomId: requiredString(args, "room_id"),
      memberId: requiredString(args, "member_id"),
      attachmentId: requiredString(args, "attachment_id"),
    });
    return toolJson(result);
  }
  if (request.params.name === "agentroom_attachment_download") {
    const result = await supervisor.downloadAttachment({
      roomId: requiredString(args, "room_id"),
      memberId: requiredString(args, "member_id"),
      attachmentId: requiredString(args, "attachment_id"),
    });
    return toolJson({
      attachment: result.attachment,
      local_path: result.path,
    });
  }
  if (request.params.name === "agentroom_receiver_rescan") {
    await supervisor.scan();
  } else if (request.params.name !== "agentroom_receiver_status") {
    throw new Error(`Unknown tool: ${request.params.name}`);
  }

  return toolJson({ workspace, receivers: await supervisor.statuses() });
});

let closing: Promise<void> | undefined;
function close(): Promise<void> {
  if (!closing) {
    closing = supervisor.close();
  }
  return closing;
}

function shutdown(): void {
  void close()
    .then(() => mcp.close())
    .catch((error: unknown) => {
      console.error("Could not stop the AgentRoom MCP receiver:", error);
    });
}

mcp.onclose = () => {
  void close();
};
process.stdin.once("end", shutdown);
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

await mcp.connect(new StdioServerTransport());
await supervisor.start();

function asObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function requiredString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${key} must be a non-empty string`);
  }
  return value;
}

function boundedInteger(
  args: Record<string, unknown>,
  key: string,
  fallback: number,
  minimum: number,
  maximum: number | undefined,
): number {
  const value = args[key] ?? fallback;
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < minimum ||
    (maximum !== undefined && (value as number) > maximum)
  ) {
    throw new Error(
      `${key} must be an integer between ${minimum} and ${maximum ?? "the safe integer limit"}`,
    );
  }
  return value as number;
}

function requiredStringArray(
  args: Record<string, unknown>,
  key: string,
  maximum: number,
): string[] {
  const value = args[key];
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > maximum ||
    value.some((item) => typeof item !== "string" || !item.trim())
  ) {
    throw new Error(`${key} must contain between 1 and ${maximum} strings`);
  }
  return [...new Set(value as string[])];
}

function optionalStringArray(
  args: Record<string, unknown>,
  key: string,
  maximum: number,
): string[] {
  const value = args[key];
  if (value === undefined) {
    return [];
  }
  if (
    !Array.isArray(value) ||
    value.length > maximum ||
    value.some((item) => typeof item !== "string" || !item.trim())
  ) {
    throw new Error(`${key} must contain at most ${maximum} non-empty strings`);
  }
  return [...new Set(value as string[])];
}

function filePathsSchema() {
  return {
    type: "array",
    maxItems: 10,
    items: { type: "string", minLength: 1 },
    description:
      "Workspace-local file paths to upload; files outside the configured workspace are rejected",
  };
}

function attachmentInputSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      room_id: { type: "string", minLength: 1 },
      member_id: { type: "string", minLength: 1 },
      attachment_id: { type: "string", minLength: 8, maxLength: 80 },
    },
    required: ["room_id", "member_id", "attachment_id"],
  };
}

function toolJson(value: unknown) {
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(value, null, 2) },
    ],
  };
}
