---
name: sponsor-wiring
description: Use when starting Phase 2 work to add the 0G, KeeperHub, or Gensyn AXL adapter modules. Provides the verbatim entry points, environment variables, and the interface seam to plug into without disturbing the Phase 1 engine.
---

# sponsor-wiring

ChainShield ships Phase 1 with in-process stand-ins. Phase 2 replaces them with real sponsor clients. This skill is the recipe for each integration.

The architectural rule: every external dependency goes behind an interface. The engine should not import sponsor SDKs directly.

## 0G Storage (durable timeline + policies)

### What it replaces

`src/memory/memoryStore.ts` (the `InMemoryStore` class implementing the `Store` interface in `src/memory/store.ts`).

### Add a new file

`src/memory/zeroGStore.ts` exporting `class ZeroGStore implements Store`.

### Environment

```sh
ZERO_G_RPC_URL=https://evmrpc-testnet.0g.ai
ZERO_G_INDEXER_RPC=<from 0G docs>
ZERO_G_PRIVATE_KEY=0x<funded wallet on Galileo>
```

### Verbatim SDK entry points

```ts
import { Indexer, MemData } from "@0gfoundation/0g-ts-sdk";
import { ethers } from "ethers";

const provider = new ethers.JsonRpcProvider(process.env.ZERO_G_RPC_URL!);
const signer = new ethers.Wallet(process.env.ZERO_G_PRIVATE_KEY!, provider);
const indexer = new Indexer(process.env.ZERO_G_INDEXER_RPC!);

// append a Decision
const buf = Buffer.from(JSON.stringify(decision));
const file = new MemData(buf);
const [tx, err] = await indexer.upload(file, process.env.ZERO_G_RPC_URL!, signer);
```

### Strategy notes

- Decisions append-only. Maintain a small index file keyed by `timeline/<owner>/<yyyymmdd>` rewritten per-day to keep retrieval cheap.
- Policies are mutable. Store the latest version as a single file per `policyId`; previous versions can be optionally retained as `policy/<id>/v<n>`.
- Wallet must have testnet 0G to pay storage fees. Use the faucet at `https://faucet.0g.ai` (0.1 0G per wallet per day).
- Wrap every SDK call in a try/catch and fall back to `InMemoryStore` only in development; in production a storage failure should propagate so the timeline is never silently dropped.

## 0G Inference (LLM reflection)

### What it replaces

The currently absent reflection step in the engine. After Phase 1 deterministic rules run, the engine should call an `InferenceClient.reflect(...)` to get a free-text explanation and confirm the verdict.

### Add a new module

`src/inference/inference.ts` (interface) and `src/inference/zeroGInference.ts` (implementation).

### Environment

```sh
ZERO_G_PRIVATE_KEY=0x<reused from above>
ZERO_G_INFERENCE_PROVIDER=0x<provider for qwen-2.5-7b-instruct>
```

### Verbatim SDK entry points

```ts
import { createZGComputeNetworkBroker } from "@0glabs/0g-serving-broker";
import { ethers } from "ethers";

const signer = new ethers.Wallet(process.env.ZERO_G_PRIVATE_KEY!,
  new ethers.JsonRpcProvider(process.env.ZERO_G_RPC_URL!));

const broker = await createZGComputeNetworkBroker(signer);

// one-time setup (idempotent)
await broker.ledger.depositFund(5);
await broker.ledger.transferFund(
  process.env.ZERO_G_INFERENCE_PROVIDER!,
  "inference",
  BigInt(1) * 10n ** 18n,
);

// per-call
const provider = process.env.ZERO_G_INFERENCE_PROVIDER!;
const { endpoint, model } = await broker.inference.getServiceMetadata(provider);
const headers = await broker.inference.getRequestHeaders(provider);

const res = await fetch(`${endpoint}/chat/completions`, {
  method: "POST",
  headers: { "Content-Type": "application/json", ...headers },
  body: JSON.stringify({
    model,
    messages: [
      { role: "system", content: SECURITY_REVIEWER_PROMPT },
      { role: "user", content: JSON.stringify({ policy, intent, simulationDigest }) },
    ],
    response_format: { type: "json_object" },
  }),
});

const data = await res.json();
const chatId = res.headers.get("ZG-Res-Key") ?? data.id;
const teeVerified = await broker.inference.processResponse(provider, chatId);
```

### Strategy notes

- Always call `processResponse` after the inference call. The returned `teeVerified` boolean goes into `Decision.llmReasoning.teeVerified` and is the audit-grade signal.
- Set a short timeout (e.g. 3s). The deterministic verdict is already final; the LLM only enriches the explanation.
- Cache the system prompt as a top-level constant. Do not regenerate it per call.
- Rate limit: 30 requests/min per user. The engine should not call inference for `ALLOW` decisions with score 0; that is wasted budget.

## KeeperHub (remediation playbooks)

### What it replaces

Currently, `policy.remediation.onBlock` is declared in the schema but no runner is wired up. Phase 2 adds the runner.

### Add a new module

`src/playbooks/runner.ts` (interface `PlaybookRunner` and `NotificationChannel`) and `src/playbooks/keeperhub.ts` (implementation).

### Environment

```sh
KEEPERHUB_API_URL=https://app.keeperhub.com
KEEPERHUB_API_KEY=<from app.keeperhub.com>
```

### REST entry point

```ts
async run(playbookId: string, decision: Decision, policy: Policy): Promise<PlaybookRun> {
  const res = await fetch(`${this.cfg.baseUrl}/api/workflows/${playbookId}/execute`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${this.cfg.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      inputs: {
        owner: policy.owner,
        decisionId: decision.id,
        intent: decision.intent,
        rulesMatched: decision.rulesMatched,
        riskScore: decision.riskScore,
      },
    }),
  });
  if (!res.ok) throw new Error(`KeeperHub run failed (${res.status}): ${await res.text()}`);
  const data = await res.json();
  return { id: playbookId, runId: data.runId ?? data.id ?? "unknown" };
}
```

### Pre-built playbooks (ship as JSON in `infra/keeperhub-templates/`)

| Id | Trigger | Actions |
|---|---|---|
| `revoke-all-approvals` | Manual via API | For each known spender: `IERC20.approve(spender, 0)`, then notify channel. |
| `safe-vault-evac` | Manual via API | Transfer N% of treasury to allowlisted cold vault, then notify. |
| `pause-automation` | Manual via API | Call `Pausable.pause()` on every registered automation contract. |

### Strategy notes

- Playbook IDs in `policy.remediation.onBlock` MUST exist in KeeperHub before the policy is created. The engine fails open (logs and continues); a missing playbook is a real outage.
- Notification side-channel: a `NotificationChannel` interface keeps Discord/Telegram/email pluggable. Default Phase 2 implementation is `WebhookChannel` plus an in-process `CollectorChannel` for tests.

## Gensyn AXL (multi-agent mesh)

### What it replaces

Nothing in Phase 1. Phase 2 splits the single risk-gate process into three role-bearing processes that communicate via the local AXL bridge.

### Add new modules

`src/mesh/watcher.ts`, `src/mesh/critic.ts`, `src/mesh/executor.ts`, plus `src/mesh/axlClient.ts` for the HTTP bridge.

### Environment

```sh
AXL_BASE_URL=http://127.0.0.1:9002
```

### Verbatim bootstrap

```bash
git clone https://github.com/gensyn-ai/axl.git && cd axl
go build -o node ./cmd/node/
openssl genpkey -algorithm ed25519 -out private.pem
echo '{"PrivateKeyPath":"private.pem","Peers":[]}' > node-config.json
./node -config node-config.json
```

The node prints its 64-character public key on startup.

### Bridge endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/topology` | GET | returns `{ our_public_key, our_ipv6 }` |
| `/send` | POST | header `X-Destination-Peer-Id: <peer pubkey>`, body is the message |
| `/recv` | GET | response body is the message; header `X-From-Peer-Id` identifies sender |

### Wire format

Use msgpack for the payload (`Bun.write`-friendly, language-agnostic):

```ts
{ kind: "INTENT" | "VERDICT" | "REMEDIATION", payload: { /* type-specific */ } }
```

### Strategy notes

- For the demo, run all three nodes on the same laptop with `Peers: []` and exchange keys via a local startup script.
- Do not put policy data on the wire; only intent ids and decision ids. The shared state lives in 0G Storage, accessible by every role.
- AXL transport is encrypted (TLS direct + Yggdrasil end-to-end), so payloads are confidential between named peers; not a substitute for app-level auth, however.

## Adoption order in Phase 2

1. KeeperHub runner first. It has the lowest blast radius (playbooks are isolated by KeeperHub-side keys) and unlocks the auto-remediation demo immediately.
2. 0G Storage second. Replaces the `InMemoryStore` so the timeline survives restarts; required for the "persistent memory" judging point.
3. 0G Inference third. Adds the TEE-attested explanation. Useful but not gating.
4. Gensyn AXL last. Highest setup cost (Go build, key exchange) and only needed for the multi-agent mesh demo.

Each step ships behind its interface, so the engine code does not change between steps.
