#!/usr/bin/env node
// End-to-end integration verification against a running backend configured
// with real Redis + MinIO (start via scripts/dev-infra.ps1/.sh, then
//   npm run dev  with REDIS_URL/S3_*/FILES_ENABLED set).
// Exits non-zero on the first failed assertion.
const base = process.env.VERIFY_BASE_URL ?? "http://127.0.0.1:8787";

let failures = 0;
function check(name, condition, detail = "") {
  if (condition) {
    console.log(`ok   ${name}`);
  } else {
    failures += 1;
    console.error(`FAIL ${name} ${detail}`);
  }
}

async function api(method, path, { token, body } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: response.status, json, headers: response.headers };
}

async function main() {
  // Auth + room
  const email = `verify-${Date.now()}@example.com`;
  const registered = await api("POST", "/v1/auth/register", {
    body: { email, displayName: "Verify Owner", password: "correct horse battery staple" },
  });
  check("register", registered.status === 201, `got ${registered.status}`);
  const ownerToken = registered.json.accessToken;

  const created = await api("POST", "/v1/rooms", {
    token: ownerToken,
    body: { name: "Integration room" },
  });
  check("create room", created.status === 201, `got ${created.status}`);
  const { room, inviteCode } = created.json;

  // File upload through MinIO
  const bytes = new TextEncoder().encode("integration file payload\n");
  const sha256 = hex(await crypto.subtle.digest("SHA-256", bytes));
  const intent = await api("POST", `/v1/rooms/${room.id}/files/upload-intents`, {
    token: ownerToken,
    body: { name: "note.txt", mediaType: "text/plain", size: bytes.length, sha256 },
  });
  check("upload intent", intent.status === 201, `got ${intent.status}`);
  const fileId = intent.json.fileId;

  const putResponse = await fetch(intent.json.presignedUrl, {
    method: "PUT",
    headers: { "content-type": "text/plain" },
    body: bytes,
  });
  check("presigned PUT", putResponse.ok, `got ${putResponse.status}`);

  const completed = await api("POST", `/v1/rooms/${room.id}/files/${fileId}/complete`, {
    token: ownerToken,
  });
  check("complete upload", completed.status === 200, `got ${completed.status}: ${JSON.stringify(completed.json)}`);
  check("scan clean", completed.json.attachment?.scanState === "clean");

  const withAttachment = await api("POST", `/v1/rooms/${room.id}/messages`, {
    token: ownerToken,
    body: { kind: "text", text: "see attached", attachmentIds: [fileId] },
  });
  check("message with attachment", withAttachment.status === 201, `got ${withAttachment.status}`);
  check(
    "attachmentId echoed",
    JSON.stringify(withAttachment.json.message.attachmentIds) === JSON.stringify([fileId]),
  );

  // Agents + task + relay
  const agentA = await api("POST", `/v1/rooms/${room.id}/members`, {
    body: { inviteCode, displayName: "Claude A", actorType: "agent", agentProvider: "claude" },
  });
  const agentB = await api("POST", `/v1/rooms/${room.id}/members`, {
    body: { inviteCode, displayName: "Codex B", actorType: "agent", agentProvider: "codex" },
  });
  check("agents joined", agentA.status === 201 && agentB.status === 201);

  const task = await api("POST", `/v1/rooms/${room.id}/messages`, {
    token: ownerToken,
    body: {
      kind: "agent.task",
      text: "verify relay",
      targetMemberIds: [agentA.json.member.id],
      idempotencyKey: `task-${Date.now()}`,
    },
  });
  check("task created", task.status === 201, `got ${task.status}`);
  const deliveryId = task.json.deliveries[0].id;

  const reply = await api("POST", `/v1/rooms/${room.id}/deliveries/${deliveryId}/reply`, {
    token: agentA.json.accessToken,
    body: {
      text: "done, handing to Codex",
      relay: {
        targetMemberIds: [agentB.json.member.id],
        idempotencyKey: `relay-${Date.now()}`,
      },
    },
  });
  check("reply with relay", reply.status === 201, `got ${reply.status}`);
  check("relay created", reply.json.relay?.message?.kind === "agent.task", JSON.stringify(reply.json).slice(0, 200));

  const pendingB = await api("GET", `/v1/rooms/${room.id}/deliveries/pending`, {
    token: agentB.json.accessToken,
  });
  check("B has relayed delivery", pendingB.json.items?.length === 1);

  // Moderation
  await api("POST", `/v1/rooms/${room.id}/moderation/rules`, {
    token: ownerToken,
    body: { pattern: "secret sauce", action: "reject" },
  });
  const rejected = await api("POST", `/v1/rooms/${room.id}/messages`, {
    token: ownerToken,
    body: { kind: "text", text: "my secret sauce recipe" },
  });
  check("moderation rejects", rejected.status === 403, `got ${rejected.status}`);

  // Kick
  const kicked = await api("DELETE", `/v1/rooms/${room.id}/members/${agentB.json.member.id}`, {
    token: ownerToken,
  });
  check("kick member", kicked.status === 204, `got ${kicked.status}`);
  const afterKick = await api("GET", `/v1/rooms/${room.id}/messages`, {
    token: agentB.json.accessToken,
  });
  check("kicked token invalid", afterKick.status === 401, `got ${afterKick.status}`);

  // Presence
  const presence = await api("GET", `/v1/rooms/${room.id}/presence`, { token: ownerToken });
  check("presence endpoint", presence.status === 200, `got ${presence.status}`);
  check("presence lists members", presence.json.items?.length >= 2);

  // MCP handshake (Streamable HTTP requires the MCP Accept header)
  const mcpResponse = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${agentA.json.accessToken}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "verify", version: "0.0.1" },
      },
    }),
  });
  const mcpBody = await parseMcpResponse(mcpResponse);
  check(
    "MCP initialize",
    mcpResponse.status === 200 &&
      mcpBody?.result?.serverInfo?.name === "agentroom",
    `got ${mcpResponse.status}: ${JSON.stringify(mcpBody).slice(0, 200)}`,
  );

  console.log(failures === 0 ? "\nALL INTEGRATION CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
}

function hex(bytes) {
  return Buffer.from(bytes).toString("hex");
}

// Streamable HTTP may answer with JSON or a text/event-stream envelope.
async function parseMcpResponse(response) {
  const text = await response.text();
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("text/event-stream")) {
    for (const line of text.split("\n")) {
      if (line.startsWith("data: ")) {
        try {
          return JSON.parse(line.slice(6));
        } catch {
          // Keep scanning for a parseable data frame.
        }
      }
    }
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

await main();
