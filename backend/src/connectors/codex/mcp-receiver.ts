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
  { name: "agentroom-receiver", version: "0.2.2" },
  {
    capabilities: { tools: {} },
    instructions:
      "This MCP automatically starts AgentRoom Codex receivers configured under the current workspace's private .agentroom directory. " +
      "Targeted room tasks execute in a separate persisted Codex App Server thread; they do not interrupt the current interactive turn. " +
      "Use agentroom_receiver_status to diagnose room connectivity. Normal room chat messages never start an agent task.",
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
  ],
}));

mcp.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "agentroom_receiver_rescan") {
    await supervisor.scan();
  } else if (request.params.name !== "agentroom_receiver_status") {
    throw new Error(`Unknown tool: ${request.params.name}`);
  }

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            workspace,
            receivers: supervisor.statuses(),
          },
          null,
          2,
        ),
      },
    ],
  };
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
