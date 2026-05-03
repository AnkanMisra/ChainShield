# ChainShield Agent — submission

**Track:** ETHGlobal OpenAgents 2026
**Sponsors used:** 0G (Storage anchor on Galileo testnet) · KeeperHub (auto-remediation playbooks)
**Stack:** TypeScript on Bun · Fastify · Zod · ethers v6 · `@0gfoundation/0g-storage-ts-sdk` · Astro frontend

## Progress

**Done** — Phases 1-6 shipped and merged to `main`. 114 specs across 13 files green, server `tsc --noEmit` and Astro `astro check` both clean, Astro production build succeeds. 0G anchor verified live on Galileo (rootHash + storage tx + block + gas all recorded below).

**Left** — record demo per [`./demo-script.md`](./demo-script.md), submit at the ETHGlobal portal.

**De-scoped** — 0G Compute (stretch), Rust + Solidity port (post-hackathon).

## What it does

ChainShield is a **policy-bound risk gate** that sits in front of any wallet or treasury and intercepts onchain transaction intents before they reach the chain. Every intent gets evaluated against deterministic rules, optionally simulated, and returns one of three verdicts:

- `ALLOW` — let the transaction broadcast
- `REQUIRE_HUMAN_CONFIRMATION` — pause for human sign-off (off-allowlist destinations, simulation reverts)
- `BLOCK` — refuse, fire a remediation playbook (e.g. revoke approvals, evacuate to a cold vault), notify ops

Every decision is appended to a forensic timeline and **anchored on 0G Storage** so the audit trail outlives the server process and survives team handoffs.

## Why it matters

Hot wallets and treasury multisigs lose funds to two recurring patterns: (a) malicious `approve(spender, MAX_UINT256)` calldata signed via deceptive UIs, and (b) over-cap transfers to addresses outside the owner's allowlist. Existing wallets either ask the user to approve everything (Safe, MetaMask) or run opaque ML scoring (Blockaid, Forta). ChainShield gives the **owner** explicit, auditable rules they author once and an autonomous remediation step when those rules are violated.

## What's onchain

Two artifacts land on 0G Galileo (chain id 16602) per evaluation:

1. **Policy JSON** — uploaded the first time a policy is created/updated. Owner, rules, version, timestamp.
2. **Decision JSON** — uploaded for every evaluation. Verdict, risk score, matched rules, reasons, simulation result, KeeperHub run id (if any).

Each upload returns a `rootHash` and `txHash`. Both are surfaced via the API on the policy and decision objects (`anchor.rootHash`, `anchor.txHash`) and rendered as a blue `0G | 0xroot…` pill in the UI timeline column.

If the wallet is unfunded or the testnet is unreachable, the API still serves the response — it just omits the `anchor` field and logs a warning. No request is dropped because storage is offline.

## Sponsor integrations

### 0G Storage (Phase 6, wired and **live-verified end-to-end**)

- `src/memory/zeroGStore.ts` implements the existing `Store` interface
- Each `putPolicy` / `appendDecision` JSON-serializes the object, uploads via `Indexer.upload(new MemData(buf), rpc, signer)` against the public Galileo storage indexer at `https://indexer-storage-testnet-turbo.0g.ai`
- Returned `rootHash` + `txHash` are stored in an in-process anchor map keyed by id and surfaced on the API as a top-level `anchor` field
- Reads serve from the in-memory cache (no testnet round trip on the hot path)
- Upload failures (unfunded wallet, indexer down) are logged and the local write still succeeds — the API never blocks on storage availability

**On-chain proof of one live anchor (recorded during testing):**

| Field | Value |
|---|---|
| Anchor wallet | `0xF838D07667716120Ba7CD52AC3b3b5BDC7110c48` |
| Policy id | `5a461d0e-bbbb-41d7-a810-addcda8bfc3f` |
| 0G storage rootHash | `0x574aaf45e85ddcccac847ab6ebfbbd24c52f99bfa8034d4199d2fab660bd3901` |
| Storage tx hash | `0xac7e0e7331ef99766e9ffc6ebfb5f6da2701fe64087824b2b4f91d04ceb58a17` |
| Block number | 31238985 |
| Gas used | 292,394 |
| Faucet tx | `0x2c8492994d5ea7c6dcd6d64d1930aecf3b8152268f1e3d8097779cfdbd75823d` |

Verify independently:

- Storage record by rootHash: <https://storagescan-galileo.0g.ai/tx/0x574aaf45e85ddcccac847ab6ebfbbd24c52f99bfa8034d4199d2fab660bd3901>
- Storage tx on Galileo explorer: <https://chainscan-galileo.0g.ai/tx/0xac7e0e7331ef99766e9ffc6ebfb5f6da2701fe64087824b2b4f91d04ceb58a17>
- Wallet activity: <https://chainscan-galileo.0g.ai/address/0xF838D07667716120Ba7CD52AC3b3b5BDC7110c48>

### KeeperHub (Phase 2, wired)

- `src/playbooks/keeperhub.ts` — `KeeperHubRunner` posts to `POST /api/workflow/{id}/execute` with bearer auth
- HTML 404 pages and other non-JSON error bodies are scrubbed out of error messages so they never leak into the UI
- Helper script `scripts/kh.sh` provides `list/get/run/status/ping` subcommands for testing

### Gensyn AXL (wired)

- `src/transport/axlGossip.ts` publishes every `BLOCK` decision to the configured AXL bridge
- `src/risk-gate/server.ts` uses `AxlGossipTransport` when `AXL_BASE_URL` is set and `NoopGossip` otherwise
- Soft failures are logged and never block the verdict response

### Optional integrations

- **Discord** notifications: `WebhookChannel` posts an embed to a Discord webhook on every `BLOCK`. Set `NOTIFY_DISCORD_WEBHOOK` to enable.

### Stretch / not shipped

- **0G Compute (Inference)** — env stub present; `ZERO_G_INFERENCE_PROVIDER` is discovered at runtime, not yet wired

## How the decision engine works

The engine is **monotonic**: rules can only escalate the verdict, never downgrade. Order of operations:

1. **Forbidden selectors** (e.g. `0x095ea7b3` `approve`) → `BLOCK` risk 95, short-circuits remaining rules
2. **Per-tx ETH cap** (`maxTransferEth`) → `BLOCK` risk 90
3. **24h rolling outflow cap** (`maxDailyOutflowEth`) → `BLOCK` risk 88
4. **Approval cap by token** → `BLOCK` risk 92
5. **Allowlist destinations** → downgrade `ALLOW` to `REQUIRE_HUMAN_CONFIRMATION` risk 60
6. **Simulation** (heuristic ERC-20 calldata + balance projection) → escalate to `REQUIRE_HUMAN_CONFIRMATION` risk 70 on revert
7. **Persist** to Store (anchored on 0G if configured)
8. **Trigger playbook** if `BLOCK` and `policy.remediation.onBlock` is non-empty

## How to run

```sh
bun install
cp .env.example .env.local        # paste your KeeperHub key + funded 0G key
bun run dev                       # http://127.0.0.1:8787
bun run demo                      # CLI runs four canonical scenes against the live API
```

For the Astro frontend specifically:

```sh
./scripts/dev.sh                  # parallel: API on :8787, Astro on :4321
```

## Test coverage

```
114 specs across 13 files

tests/api.test.ts                  Risk-Gate API end-to-end
tests/apiAnchor.test.ts            Anchor surfacing on policy + decision responses
                                   (incl. real ZeroGStore + buildApp e2e)
tests/axlGossip.test.ts            AXL gossip transport + no-op fallback
tests/clientIsolation.test.ts      Per-browser isolation + invalid client-id rejection
tests/cors.test.ts                 WEB_ORIGIN allowlist + preview regex
tests/engine.test.ts               5-rule decision ladder + invalidIntentValue / invalidApprovalCap guards
tests/engineRemediation.test.ts    Playbook trigger + notification fan-out
tests/engineSimulation.test.ts     Simulator integration + revert escalation
tests/playbooks.test.ts            KeeperHub runner + mock runner + notifier channels
tests/policyService.test.ts        Policy CRUD + version bumping + schema rejection
tests/simulator.test.ts            HeuristicSimulator: ERC-20 decode + balance deltas + typed approvals[]
tests/zeroGStore.test.ts           ZeroGStore: anchor on write, soft-failure, empty-result handling
tests/webFormat.test.ts            Astro shortHash + anchorPillHtml + escapeHtml edge cases
```

## Demo flow (3 minutes)

See [`./demo-script.md`](./demo-script.md) for the verbatim screen-recording walkthrough.

## Repo

`https://github.com/AnkanMisra/ChainShield` — branch `main`.
