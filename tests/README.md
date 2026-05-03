# `tests/` — unit + integration coverage

> 112 specs across 13 files. Every external dependency is faked at the trait boundary; live anchor hashes are pinned as test constants so the renderer is exercised against real chain data.

```sh
bun test                      # all 112 specs
bun test tests/engine.test.ts # one file
bun test --watch              # watch mode
bun test --coverage           # coverage report
```

## File index

| File | Domain |
|---|---|
| [`api.test.ts`](./api.test.ts) | Risk-gate Fastify API end-to-end |
| [`apiAnchor.test.ts`](./apiAnchor.test.ts) | Anchor surfacing on policy + decision responses (real `ZeroGStore` + `buildApp`) |
| [`axlGossip.test.ts`](./axlGossip.test.ts) | `AxlGossipTransport` happy path, soft-failure (5xx, network error, HTML body), `NoopGossip` |
| [`clientIsolation.test.ts`](./clientIsolation.test.ts) | Multi-tenant decision isolation by client id |
| [`cors.test.ts`](./cors.test.ts) | CORS allowlist + Cloudflare Pages preview-domain regex + suffix-attack rejection |
| [`engine.test.ts`](./engine.test.ts) | 5-rule decision ladder + `invalidIntentValue` / `invalidApprovalCap` defensive guards |
| [`engineRemediation.test.ts`](./engineRemediation.test.ts) | Playbook trigger, fall-through on failure, notification fan-out, AXL gossip on `BLOCK` |
| [`engineSimulation.test.ts`](./engineSimulation.test.ts) | Simulator integration + revert escalation |
| [`playbooks.test.ts`](./playbooks.test.ts) | `MockRunner`, `KeeperHubRunner`, `WebhookChannel`, `CollectorChannel` |
| [`policyService.test.ts`](./policyService.test.ts) | Policy CRUD + version bumping + Zod schema rejection |
| [`simulator.test.ts`](./simulator.test.ts) | `HeuristicSimulator` calldata decode + balance deltas + typed `approvals[]` |
| [`webFormat.test.ts`](./webFormat.test.ts) | Astro renderer: `shortHash`, `anchorPillHtml`, `escapeHtml` adversarial XSS |
| [`zeroGStore.test.ts`](./zeroGStore.test.ts) | Anchor on write, soft-failure, empty-result handling, single + multi response shapes |
| [`helpers.ts`](./helpers.ts) | Shared fixtures: `TREASURY` / `COLD_VAULT` / `ATTACKER` / `TOKEN` addresses, `makePolicy`, `makeIntent`, `approveCalldata` |

## Patterns to mirror

| Pattern | Where it lives |
|---|---|
| Mock fetcher injected into HTTP-based adapters | `tests/playbooks.test.ts` (KeeperHub), `tests/axlGossip.test.ts` |
| Real adapter against a fake indexer | `tests/zeroGStore.test.ts` (`IndexerLike` injected) |
| Live production hashes pinned as test constants | `tests/webFormat.test.ts` (`FULL_ROOT`, `FULL_TX`) |
| Fresh `InMemoryStore` per spec | every `tests/engine*.ts` and `tests/api*.ts` |
| Deterministic `now()` + `idGen()` injected | `tests/engineRemediation.test.ts`, `tests/engineSimulation.test.ts` |

## CI gates

The same `bun test` runs in CI on every PR to `main` and every push, alongside `tsc --noEmit`, `astro check`, the Astro production build, and a byte-level emoji scan. A red test fails the pipeline; nothing merges without all checks green.

## Pointers

| | |
|---|---|
| Source under test | [`../src/`](../src) |
| Bun test docs | <https://bun.sh/docs/cli/test> |
| Coding conventions | [`../AGENTS.md`](../AGENTS.md) |
