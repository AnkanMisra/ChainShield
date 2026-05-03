import { buildApp, defaultEngine } from "./app.js";
import { InMemoryStore } from "../memory/memoryStore.js";
import { ZeroGStore } from "../memory/zeroGStore.js";
import type { Store } from "../memory/store.js";
import { PolicyService } from "../core/policyService.js";
import { KeeperHubRunner } from "../playbooks/keeperhub.js";
import { MockRunner } from "../playbooks/runner.js";
import { CollectorChannel, WebhookChannel } from "../playbooks/notifier.js";
import type { NotificationChannel, PlaybookRunner } from "../playbooks/runner.js";

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "127.0.0.1";

let store: Store;
const zeroGKey = process.env.ZERO_G_PRIVATE_KEY;
if (zeroGKey && zeroGKey.length > 0) {
  const rpcUrl = process.env.ZERO_G_RPC_URL?.trim() || "https://evmrpc-testnet.0g.ai";
  const indexerRpc =
    process.env.ZERO_G_INDEXER_RPC?.trim() || "https://indexer-storage-testnet-turbo.0g.ai";
  store = new ZeroGStore({ rpcUrl, indexerRpc, privateKey: zeroGKey });
  console.log(`[chainshield] store: 0G anchor (rpc=${rpcUrl}, indexer=${indexerRpc})`);
} else {
  store = new InMemoryStore();
  console.log("[chainshield] store: in-memory (set ZERO_G_PRIVATE_KEY to anchor writes on 0G testnet)");
}

let runner: PlaybookRunner;
const apiKey = process.env.KEEPERHUB_API_KEY;
const baseUrl = process.env.KEEPERHUB_API_URL ?? "https://app.keeperhub.com";
if (apiKey && apiKey.length > 0) {
  runner = new KeeperHubRunner({ baseUrl, apiKey });
  console.log(`[chainshield] playbook runner: KeeperHub @ ${baseUrl}`);
} else {
  runner = new MockRunner();
  console.log("[chainshield] playbook runner: mock (set KEEPERHUB_API_KEY to use real workflows)");
}

const channels: Record<string, NotificationChannel> = {
  collector: new CollectorChannel(),
};
if (process.env.NOTIFY_DISCORD_WEBHOOK) {
  channels.discord = new WebhookChannel({ url: process.env.NOTIFY_DISCORD_WEBHOOK });
  console.log("[chainshield] notification channel: discord webhook");
}

console.log("[chainshield] simulator: heuristic (calldata decode + balance projection)");

const engine = defaultEngine(store, {
  playbookRunner: runner,
  notificationChannels: channels,
});
const policyService = new PolicyService(store);

const app = buildApp({ store, engine, policyService });

app.listen({ port, host }).then(() => {
  console.log(`[chainshield] risk-gate listening on http://${host}:${port}`);
});
