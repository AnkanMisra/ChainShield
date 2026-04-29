---
name: sponsor-wiring
description: Use when starting Phase 2 work to add the 0G, KeeperHub, or Gensyn AXL adapter modules. Provides the verbatim entry points, environment variables, and the trait seam to plug into without disturbing the Phase 1 engine. Backend is Rust; sponsor calls go through traits with one impl per provider.
---

# sponsor-wiring

ChainShield ships Phase 1 as a TypeScript scaffold. Phase 2 ports the engine to Rust and wires up real sponsor clients. This skill is the recipe for each integration.

The architectural rule: every external dependency goes behind a trait. The engine never imports a sponsor SDK or HTTP URL directly.

## Adoption order

1. **KeeperHub runner** — lowest blast radius, plain REST, no SDK lock-in. Unlocks the auto-remediation demo immediately.
2. **0G Storage (via sidecar)** — replaces the in-memory store so the timeline survives restarts; required for the "persistent memory" judging point.
3. **0G Inference** — adds TEE-attested explanation. Useful but not gating.
4. **Gensyn AXL mesh** — highest setup cost (Go build, key exchange) and only needed for the multi-agent demo.

Each step ships behind its trait, so the engine code does not change between steps.

## KeeperHub (remediation playbooks)

### What it replaces

Currently `policy.remediation.onBlock` is declared in the schema but no runner is wired up. Phase 2 adds the runner.

### Crate

`crates/playbooks/`

### Trait + impl sketch

```rust
// crates/playbooks/src/lib.rs
#[async_trait::async_trait]
pub trait PlaybookRunner: Send + Sync {
    async fn run(&self, playbook_id: &str, decision: &Decision, policy: &Policy)
        -> Result<PlaybookRun, PlaybookError>;
}

pub struct KeeperHubRunner {
    base_url: String,
    api_key: String,
    http: reqwest::Client,
}

#[async_trait::async_trait]
impl PlaybookRunner for KeeperHubRunner {
    async fn run(&self, playbook_id: &str, decision: &Decision, policy: &Policy)
        -> Result<PlaybookRun, PlaybookError>
    {
        let res = self.http
            .post(format!("{}/api/workflows/{}/execute", self.base_url, playbook_id))
            .bearer_auth(&self.api_key)
            .json(&serde_json::json!({
                "inputs": {
                    "owner": policy.owner,
                    "decisionId": decision.id,
                    "intent": decision.intent,
                    "rulesMatched": decision.rules_matched,
                    "riskScore": decision.risk_score,
                }
            }))
            .send().await?
            .error_for_status()?;
        let body: KeeperHubExecuteResponse = res.json().await?;
        Ok(PlaybookRun { id: playbook_id.into(), run_id: body.run_id })
    }
}
```

### Environment

```sh
KEEPERHUB_API_URL=https://app.keeperhub.com
KEEPERHUB_API_KEY=<from app.keeperhub.com>
```

### Pre-built playbooks (ship as JSON in `infra/keeperhub-templates/`)

| Id | Trigger | Actions |
|---|---|---|
| `revoke-all-approvals` | Manual via API | For each known spender: `IERC20.approve(spender, 0)`, then notify channel. |
| `safe-vault-evac` | Manual via API | Transfer N% of treasury to allowlisted cold vault, then notify. |
| `pause-automation` | Manual via API | Call `Pausable.pause()` on every registered automation contract. |

### Strategy notes

- Playbook ids referenced in `policy.remediation.onBlock` MUST exist in KeeperHub before the policy is created. The engine fails open (logs and continues); a missing playbook is a real outage.
- A `NotificationChannel` trait keeps Discord/Telegram/email pluggable. Default Phase 2 implementation is `WebhookChannel` plus an in-process `CollectorChannel` for tests.

## 0G Storage (durable timeline + policies)

### Constraint

The 0G SDK is **Go and TypeScript only**. There is no first-party Rust client. Two options:

1. **Sidecar (recommended)** — run a tiny Go or TS process that wraps the SDK and exposes HTTP for the Rust crates to call. This is the path the architecture doc describes.
2. **Direct EVM + custom storage** — interact with 0G's chain via `alloy` and reimplement the storage protocol. Significantly more work; not recommended for a hackathon.

### What it replaces

The in-memory store. The Rust `Store` trait stays the same; only the impl changes.

### Trait

```rust
// crates/memory/src/lib.rs
#[async_trait::async_trait]
pub trait Store: Send + Sync {
    async fn put_policy(&self, policy: &Policy) -> Result<(), StoreError>;
    async fn get_policy(&self, id: &str) -> Result<Option<Policy>, StoreError>;
    async fn list_policies(&self, owner: Option<Address>) -> Result<Vec<Policy>, StoreError>;
    async fn append_decision(&self, decision: &Decision) -> Result<(), StoreError>;
    async fn list_decisions(&self, filter: TimelineFilter) -> Result<Vec<Decision>, StoreError>;
}
```

### Sidecar contract

```
POST /storage/upload      body: bytes        -> { "rootHash": "0x..." }
GET  /storage/{rootHash}                     -> bytes
GET  /storage/index/{owner}/{day}            -> [ "rootHash", ... ]
POST /storage/index/{owner}/{day}            body: [ "rootHash", ... ]
```

The sidecar uses `@0gfoundation/0g-ts-sdk` and is the only place that reads `ZERO_G_PRIVATE_KEY`.

### Sidecar TS skeleton (for reference)

```ts
import { Indexer, MemData } from "@0gfoundation/0g-ts-sdk";
import { ethers } from "ethers";
import Fastify from "fastify";

const provider = new ethers.JsonRpcProvider(process.env.ZERO_G_RPC_URL!);
const signer   = new ethers.Wallet(process.env.ZERO_G_PRIVATE_KEY!, provider);
const indexer  = new Indexer(process.env.ZERO_G_INDEXER_RPC!);

const app = Fastify();
app.post("/storage/upload", async (req, reply) => {
  const file = new MemData(Buffer.from(req.body as ArrayBuffer));
  const [, err] = await indexer.upload(file, process.env.ZERO_G_RPC_URL!, signer);
  if (err) return reply.status(500).send({ error: String(err) });
  // ... return rootHash
});
app.listen({ port: 9100 });
```

### Environment (sidecar process)

```sh
ZERO_G_RPC_URL=https://evmrpc-testnet.0g.ai
ZERO_G_INDEXER_RPC=<from 0G docs>
ZERO_G_PRIVATE_KEY=0x<funded wallet on Galileo>
ZERO_G_BRIDGE_URL=http://127.0.0.1:9100   # what the Rust crate talks to
```

### Strategy notes

- Decisions are append-only. Maintain a small index file keyed by `timeline/<owner>/<yyyymmdd>` rewritten per-day to keep retrieval cheap.
- Policies are mutable. Store the latest version per `policyId`; previous versions can be retained as `policy/<id>/v<n>`.
- Wallet must hold testnet 0G to pay storage fees. Faucet: `https://faucet.0g.ai` (0.1 0G per wallet per day).
- The sidecar is private (loopback only). Do not expose its port outside the host.

## 0G Inference (LLM reflection)

### What it replaces

The currently absent reflection step in the engine. After Phase 1 deterministic rules run, the engine should call an `InferenceClient::reflect(...)` to get a free-text explanation and TEE attestation.

### Crate

`crates/inference/`

### Trait

```rust
#[async_trait::async_trait]
pub trait InferenceClient: Send + Sync {
    async fn reflect(&self, input: ReflectionInput<'_>)
        -> Result<LlmReasoning, InferenceError>;
}
```

### Why no SDK is needed

The 0G inference endpoint is OpenAI-compatible (`POST /chat/completions`). The broker steps (`depositFund`, `transferFund`, `getServiceMetadata`, `getRequestHeaders`, `processResponse`) are all simple onchain or HTTP calls we wrap with `alloy` + `reqwest`.

### Verbatim flow

```rust
// One-time, idempotent
broker_signer.deposit_fund(5_000_000_000_000_000_000u128).await?;     // 5 0G
broker_signer.transfer_fund(provider_addr, "inference",
    1_000_000_000_000_000_000u128).await?;                            // 1 0G

// Per-call
let meta = broker_signer.get_service_metadata(provider_addr).await?;
let headers = broker_signer.get_request_headers(provider_addr).await?;

let res = http.post(format!("{}/chat/completions", meta.endpoint))
    .headers(headers)
    .json(&serde_json::json!({
        "model": meta.model,
        "messages": [
            { "role": "system", "content": SECURITY_REVIEWER_PROMPT },
            { "role": "user",   "content": serde_json::to_string(&input)? },
        ],
        "response_format": { "type": "json_object" },
    }))
    .send().await?
    .error_for_status()?;

let chat_id = res.headers().get("ZG-Res-Key")
    .and_then(|v| v.to_str().ok()).unwrap_or_default().to_string();
let body: serde_json::Value = res.json().await?;
let tee_verified = broker_signer.process_response(provider_addr, &chat_id).await?;
```

### Environment

```sh
ZERO_G_PRIVATE_KEY=0x<reused>
ZERO_G_INFERENCE_PROVIDER=0x<provider for qwen-2.5-7b-instruct>
```

### Strategy notes

- Always call `process_response` after the inference call. The returned bool goes into `Decision.llmReasoning.teeVerified` and is the audit-grade signal.
- Set a 3-second timeout. The deterministic verdict is already final; the LLM only enriches the explanation.
- Cache `SECURITY_REVIEWER_PROMPT` as a top-level `&'static str`. Do not regenerate per call.
- Rate limit: 30 requests/min per user. Skip inference for `ALLOW` decisions with score 0; that is wasted budget.

## Gensyn AXL (multi-agent mesh)

### What it replaces

Nothing in Phase 1. Phase 2 splits the single risk-gate process into three role-bearing Rust binaries that communicate via the local AXL HTTP bridge.

### Crate

`crates/mesh/`

### Bootstrap (unchanged from Phase 1; the AXL node itself is a Go binary)

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

### Rust client sketch

```rust
pub struct AxlClient { base_url: String, http: reqwest::Client }

impl AxlClient {
    pub async fn topology(&self) -> Result<Topology, AxlError> {
        Ok(self.http.get(format!("{}/topology", self.base_url))
            .send().await?.error_for_status()?.json().await?)
    }
    pub async fn send(&self, dest: &PeerId, body: &[u8]) -> Result<(), AxlError> {
        self.http.post(format!("{}/send", self.base_url))
            .header("X-Destination-Peer-Id", dest.as_str())
            .body(body.to_vec()).send().await?.error_for_status()?;
        Ok(())
    }
    pub async fn recv(&self) -> Result<Option<(PeerId, Vec<u8>)>, AxlError> {
        let res = self.http.get(format!("{}/recv", self.base_url)).send().await?;
        if res.status() == 204 { return Ok(None); }
        let from = res.headers().get("X-From-Peer-Id")
            .and_then(|v| v.to_str().ok()).map(PeerId::from_str)
            .transpose()?.ok_or(AxlError::MissingFromHeader)?;
        Ok(Some((from, res.bytes().await?.to_vec())))
    }
}
```

### Wire format

Use `rmp-serde` (msgpack) for payloads — compact and language-agnostic:

```rust
#[derive(Serialize, Deserialize)]
#[serde(tag = "kind")]
enum MeshMessage {
    Intent { intent: TxIntent, policy_id: String },
    Verdict { decision: Decision },
    Remediation { decision_id: String, playbook: String },
}
```

### Three roles, three binaries

- `crates/mesh/src/bin/watcher.rs` — listens to mempool/pending txs, posts intents to /send -> critic.
- `crates/mesh/src/bin/critic.rs` — runs the decision engine; on BLOCK posts to /send -> executor.
- `crates/mesh/src/bin/executor.rs` — invokes KeeperHub playbook + writes Decision to 0G via the storage sidecar.

### Strategy notes

- For the demo, run all three nodes on the same laptop with `Peers: []` and exchange keys via a local startup script.
- Do not put policy data on the wire; only intent ids and decision ids. Shared state lives in 0G Storage, accessible by every role.
- AXL transport is encrypted (TLS direct + Yggdrasil end-to-end); not a substitute for app-level auth, however.

## Onchain anchor (Solidity)

Not a sponsor integration per se, but referenced by the playbook flow. See `.claude/skills/solidity-contracts/SKILL.md` for the `PolicyAnchor.sol` and optional `EmergencyVault.sol` patterns. The risk-gate writes the anchor at policy create/update time using `alloy::providers::Provider::send_transaction(...)`.
