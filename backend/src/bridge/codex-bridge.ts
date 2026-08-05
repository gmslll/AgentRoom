#!/usr/bin/env node
import { AgentRoomClient } from "./agentroom-client.js";
import { loadCodexBridgeConfig } from "./config.js";
import { CodexAppServerClient } from "./codex/app-server-client.js";
import { CodexTaskRunner } from "./codex-runner.js";
import { DeliveryWorker } from "./delivery-worker.js";

const config = loadCodexBridgeConfig();
const client = new AgentRoomClient(config);
const appServer = new CodexAppServerClient(
  config.codexCommand,
  config.workspace,
  config.codexRequestTimeoutMs,
  config.codexTurnTimeoutMs,
);
const runner = new CodexTaskRunner(appServer, config.stateFile);
const worker = new DeliveryWorker(client, runner);
const abortController = new AbortController();

function shutdown(): void {
  abortController.abort();
  appServer.close();
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

let recovering: Promise<void> | undefined;
function recoverPending(): Promise<void> {
  if (!recovering) {
    const current = (async () => {
      for (const delivery of await client.listPendingDeliveries()) {
        worker.enqueue(delivery);
      }
    })();
    recovering = current;
    const clearRecovery = () => {
      if (recovering === current) {
        recovering = undefined;
      }
    };
    void current.then(clearRecovery, clearRecovery);
  }
  return recovering;
}

const recoveryTimer = setInterval(() => {
  void recoverPending().catch((error: unknown) => {
    console.error("AgentRoom periodic recovery failed:", error);
  });
}, config.recoveryIntervalMs);

try {
  await client.listen(
    (event) => {
      if (event.type === "delivery.queued") {
        worker.enqueue(event.data);
      }
    },
    abortController.signal,
    recoverPending,
  );
} finally {
  clearInterval(recoveryTimer);
  appServer.close();
  await worker.idle();
}
