#!/usr/bin/env node
import { AgentRoomClient } from "../agentroom-client.js";
import { loadCodexBridgeConfig } from "../config.js";
import { CodexAppServerClient } from "./app-server-client.js";
import { CodexTaskRunner } from "./runner.js";
import { DeliveryWorker } from "../delivery-worker.js";
import { SessionCardStore } from "../session-cards.js";
import { ReceiverStatusReporter } from "../receiver-status.js";

const config = loadCodexBridgeConfig();
const client = new AgentRoomClient(config);
const appServer = new CodexAppServerClient(
  config.codexCommand,
  config.workspace,
  config.codexRequestTimeoutMs,
  config.codexTurnTimeoutMs,
  config.codexAppServerEndpoint,
);
const runner = new CodexTaskRunner(appServer, config.stateFile);
const sessionCards = new SessionCardStore(
  config.sessionCardRoot,
  "codex",
  config.roomId,
);
const worker = new DeliveryWorker(client, runner, sessionCards);
const abortController = new AbortController();
const statusReporter = config.receiverStatusFile
  ? new ReceiverStatusReporter(config.receiverStatusFile, {
      roomId: config.roomId,
      ...(config.memberId ? { memberId: config.memberId } : {}),
    })
  : undefined;

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
  await statusReporter?.report("starting");
  await client.listen(
    (event) => {
      if (event.type === "delivery.queued") {
        worker.enqueue(event.data);
      }
    },
    abortController.signal,
    recoverPending,
    (update) => statusReporter?.report(update.state, update.error),
  );
} finally {
  clearInterval(recoveryTimer);
  await statusReporter?.report("stopped");
  appServer.close();
  await worker.idle();
}
