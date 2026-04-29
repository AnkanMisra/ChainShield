import { buildApp } from "./app.js";
import { DecisionEngine } from "../core/engine.js";
import { InMemoryStore } from "../memory/memoryStore.js";
import { PolicyService } from "../core/policyService.js";
import { KeeperHubRunner } from "../playbooks/keeperhub.js";
import { MockRunner } from "../playbooks/runner.js";
import { CollectorChannel, WebhookChannel } from "../playbooks/notifier.js";
import type { NotificationChannel, PlaybookRunner } from "../playbooks/runner.js";

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "127.0.0.1";

const store = new InMemoryStore();

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

const engine = new DecisionEngine({ store, playbookRunner: runner, notificationChannels: channels });
const policyService = new PolicyService(store);

const app = buildApp({ store, engine, policyService });

app.listen({ port, host }).then(() => {
  console.log(`[chainshield] risk-gate listening on http://${host}:${port}`);
});
