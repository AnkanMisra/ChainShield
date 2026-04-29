# ChainShield Agent — Architecture

Concrete design for the ChainShield product idea, mapped onto the three sponsor APIs (0G, KeeperHub, Gensyn AXL).

## Tech Stack

| Layer | Choice | Reason |
|---|---|---|
| Language | TypeScript / Node.js 22 | First-class SDK on both 0G (`@0glabs/0g-serving-broker`, `@0gfoundation/0g-ts-sdk`) and KeeperHub MCP. AXL is HTTP-only, so language-agnostic. |
| Risk gate API | Fastify | Low overhead, schema-first via JSON Schema, easy ESM. |
| Onchain client | `ethers` v6 | Already required by 0G SDKs. |
| Simulation | Tenderly Simulate API or local `viem` `simulateContract` against forked Galileo | Two-tier: cheap local sim first, Tenderly for full trace if needed. |
| Persistence | 0G Storage (KV mode) | Policies, baselines, incident timeline. No separate DB for the demo. |
| LLM | 0G Inference — `qwen-2.5-7b-instruct` on testnet | TEE-verified `processResponse` gives auditability. |
| Mesh transport | Gensyn AXL local node @ `localhost:9002` | Watcher → Critic → Executor over `/send` and `/recv`. |
| Remediation execution | KeeperHub MCP (`https://app.keeperhub.com/mcp`) | Pre-built workflow nodes for revoke/transfer/notify. |

## Module Map

```
chainshield/
├── packages/
│   ├── core/              # Policy schema, decision engine, types
│   ├── risk-gate/         # HTTP API: POST /evaluate, returns ALLOW/CONFIRM/BLOCK
│   ├── simulator/         # Tx simulation + revert/diff analysis
│   ├── memory/            # 0G Storage client wrapper (policies, timeline)
│   ├── inference/         # 0G Compute client (risk reasoning, explainability)
│   ├── playbooks/         # KeeperHub MCP client + playbook templates
│   ├── mesh/              # AXL agent harness (watcher/critic/executor roles)
│   └── ui/                # Next.js dashboard: policy editor + incident timeline
└── infra/
    ├── axl-node/          # Build + run script for the local AXL node
    └── keeperhub-templates/ # JSON workflow definitions (revoke, safe-transfer, pause)
```

## Data Model

### Policy

```ts
type Policy = {
  id: string;
  owner: `0x${string}`;       // wallet/treasury under protection
  rules: {
    maxTransferEth?: number;       // per-tx cap, native units
    maxDailyOutflowEth?: number;   // 24h rolling cap
    allowedDestinations?: `0x${string}`[];
    allowedProtocols?: string[];   // resolved via signature DB / curated list
    forbiddenSelectors?: `0x${string}`[]; // 4-byte selectors
    maxSlippageBps?: number;
    approvalCapByToken?: Record<`0x${string}`, string>; // wei amount as string
  };
  remediation: {
    onBlock?: string[];        // playbook IDs
    onAnomaly?: string[];
    notifyChannels?: string[]; // discord/telegram webhook names
  };
  version: number;
  updatedAt: number;
};
```

### Decision (returned from risk gate)

```ts
type Decision = {
  id: string;                  // uuid, also used as ZG-Res-Key for 0G TEE verify
  txHash?: `0x${string}`;      // if executed
  intent: TxIntent;            // raw call data input
  verdict: "ALLOW" | "REQUIRE_HUMAN_CONFIRMATION" | "BLOCK";
  riskScore: number;           // 0-100
  rulesMatched: string[];      // e.g. ["maxTransferEth", "destNotAllowlisted"]
  simulation: {
    success: boolean;
    revertReason?: string;
    balanceDeltas: Array<{ token: string; account: string; delta: string }>;
  };
  llmReasoning: {
    text: string;
    teeVerified: boolean;      // result of broker.inference.processResponse
    chatId: string;
  };
  playbookTriggered?: { id: string; runId: string };
  timestamp: number;
};
```

### Incident timeline entry — one per Decision, appended to 0G Storage under key `timeline/<owner>/<yyyymmdd>/<decisionId>`.

## HTTP Contract — Risk Gate API

```
POST /evaluate
  body: { intent: TxIntent, policyId: string }
  → Decision

POST /confirm
  body: { decisionId: string, signed: boolean }
  → { executed: boolean, txHash?: string }

GET /timeline?owner=0x...&from=<ts>&to=<ts>
  → Decision[]

POST /policies            # create / update
GET  /policies/:id
```

`TxIntent` mirrors a standard EIP-1559 call: `{ from, to, value, data, chainId, nonce?, gas? }`.

## Decision Engine — order of operations

1. **Static policy match** — fast deny on `forbiddenSelectors`, immediate block.
2. **Quantitative caps** — `value > maxTransferEth`, daily outflow check (read 0G timeline).
3. **Allowlist match** — `to` in `allowedDestinations` short-circuits to ALLOW for low-risk paths.
4. **Simulation** — run the tx in a fork. Detect revert, balance drains > threshold, approvals to non-allowlisted spenders.
5. **LLM reflection** — call 0G Inference with `{policy, intent, simulationDigest}`. Prompt asks for risk score 0-100, list of red flags, plain-English reason. **Always** call `broker.inference.processResponse(provider, chatId)` to get TEE attestation.
6. **Verdict synthesis** — deterministic rules trump LLM. LLM only escalates within the band the rules permit.
7. **Persist** — append Decision to 0G timeline.
8. **Trigger playbook** if `BLOCK` and `policy.remediation.onBlock` is set.

## Sponsor Integration — verbatim entry points

### 0G Storage (memory)

```ts
import { Indexer, ZgFile, MemData } from "@0gfoundation/0g-ts-sdk";
import { ethers } from "ethers";

const provider = new ethers.JsonRpcProvider("https://evmrpc-testnet.0g.ai");
const signer = new ethers.Wallet(process.env.PRIVATE_KEY!, provider);
const indexer = new Indexer(process.env.INDEXER_RPC!);

// Append a Decision to the timeline
const buf = Buffer.from(JSON.stringify(decision));
const file = new MemData(buf);
const [tx, err] = await indexer.upload(file, "https://evmrpc-testnet.0g.ai", signer);
```

Key strategy for retrieval: store rootHash → `timeline/<owner>` index in a small KV file rewritten on each append (acceptable for demo volume; for production switch to a per-day shard).

### 0G Inference (reasoning)

```ts
import { createZGComputeNetworkBroker } from "@0glabs/0g-serving-broker";

const broker = await createZGComputeNetworkBroker(signer);
await broker.ledger.depositFund(5);   // one-time setup
const provider = "<provider-address-for-qwen-2.5-7b>";
await broker.ledger.transferFund(provider, "inference", BigInt(1) * 10n ** 18n);

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

### KeeperHub MCP (remediation)

We invoke MCP tools from the agent process (not from Claude Desktop). Two paths:

**A. Direct REST** (preferred for server-side automation):
```ts
await fetch("https://app.keeperhub.com/api/workflows/<id>/execute", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${process.env.KEEPERHUB_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ inputs: { tokenAddress, spender, owner } }),
});
```

**B. MCP HTTP/SSE** (qualifies us for "MCP integration" prize criterion):
```
GET  https://app.keeperhub.com/mcp/sse
POST https://app.keeperhub.com/mcp/message
Authorization: Bearer <MCP_API_KEY>
```

Tools we'll call: `execute_check_and_execute` (for conditional remediations), `execute_contract_call` (for `revoke` on token approvals), `ai_generate_workflow` (demo: NL → workflow creation live on stage).

**Pre-built playbooks (JSON workflows we ship):**
| ID | Trigger | Actions |
|---|---|---|
| `revoke-all-approvals` | manual via API | for-each-spender: ERC20.approve(spender, 0) → notify Discord |
| `safe-vault-evac` | manual via API | transfer N% of treasury to allowlisted cold vault → notify |
| `pause-automation` | manual via API | call `Pausable.pause()` on registered automation contracts |
| `dangerous-approval-watch` | event trigger on `Approval` | filter > threshold → call risk gate → conditionally trigger revoke |

### Gensyn AXL (mesh)

Three role-bearing processes, each with its own AXL config:

```
watcher.ts   — listens to mempool / pending txs, posts intents to /send → critic
critic.ts    — runs decision engine; on BLOCK posts to /send → executor
executor.ts  — invokes KeeperHub playbook + writes Decision to 0G Storage
```

Bootstrap (per docs):
```bash
git clone https://github.com/gensyn-ai/axl.git && cd axl
go build -o node ./cmd/node/
openssl genpkey -algorithm ed25519 -out private.pem
echo '{"PrivateKeyPath":"private.pem","Peers":[]}' > node-config.json
./node -config node-config.json
```

App-side wire format (msgpack body, peer pubkey in header):
```ts
await fetch("http://127.0.0.1:9002/send", {
  method: "POST",
  headers: { "X-Destination-Peer-Id": criticPubKey },
  body: msgpack.encode({ kind: "INTENT", intent, policyId }),
});
```

## Demo Data Setup

- Fund 3 testnet wallets via `https://faucet.0g.ai` (treasury, attacker, cold-vault).
- Deploy 1 test ERC-20 + 1 mock automation contract with `pause()` to Galileo.
- Pre-create policy with `maxTransferEth=1`, allowlist=[cold-vault], `forbiddenSelectors=[0x095ea7b3]` (deliberately included for Scene 3 to fire on `approve`).
- Pre-create the 4 KeeperHub playbooks above; record their workflow IDs.

## What Earns Each Sponsor Prize

| Sponsor | Hook |
|---|---|
| **0G** | Storage = forensic timeline; Inference = TEE-attested reasoning. Both are *load-bearing*, not bolted on. |
| **KeeperHub** | Hits both focus areas: (1) novel security framework on top of KeeperHub workflows, (2) integration via MCP server invocation from an agent (qualifies for "agent framework plugin" criterion if we ship the security primitives as a reusable package). |
| **Gensyn AXL** | Watcher/critic/executor mesh is the canonical AXL pattern — gives a real distributed demo, not a single-process simulation. |

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| 0G testnet faucet limit (0.1 0G/wallet/day) | Request bump in Discord on Day 0; pre-fund wallets. |
| LLM latency vs demo flow | Cache common reasoning + pre-warm a second-opinion endpoint; deterministic rules already block before LLM finishes. |
| KeeperHub workflow auth in demo | Use a single sandbox API key; do not expose in repo. |
| AXL public-key bootstrap on stage | Run all three nodes on the demo laptop with `Peers: []` and exchange keys via local script at startup. |
| Tx simulation accuracy on Galileo fork | Fall back to Tenderly's hosted simulator if local fork can't decode protocol-specific calls. |

## Out of Scope for MVP

- Multi-chain support beyond Galileo (mention as roadmap)
- Hardware wallet signing — mock with `ethers.Wallet` for demo
- Production policy DSL — JSON only, no expression language
- iNFT-portable agent profile — stretch goal only
