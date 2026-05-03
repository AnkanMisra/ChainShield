# `docs/sponsors/` — sponsor research notes

> Per-sponsor research and integration notes captured during planning. Each file is the working spec the adapter was built against, kept after the build so the integration story is reproducible.

| File | Sponsor | What it covers | Adapter |
|---|---|---|---|
| [`0g.md`](./0g.md) | 0G Labs | Storage SDK shape, Galileo testnet config, Indexer.upload semantics, faucet path, mainnet vs testnet contracts | [`../../src/memory/zeroGStore.ts`](../../src/memory/zeroGStore.ts) |
| [`keeperhub.md`](./keeperhub.md) | KeeperHub | API key types, workflow execute endpoint, response shape variance, auth patterns | [`../../src/playbooks/keeperhub.ts`](../../src/playbooks/keeperhub.ts) |
| [`gensyn-axl.md`](./gensyn-axl.md) | Gensyn | AXL local HTTP bridge model, MCP / A2A support, NAT-friendly mesh, bootstrap-node requirements | [`../../src/transport/axlGossip.ts`](../../src/transport/axlGossip.ts) |

## Prize matrix

| Sponsor | Prize pool | Status |
|---|---|---|
| 0G | `$15,000` | Adapter shipped, live anchor verified on Galileo testnet |
| KeeperHub | `$5,000` | Adapter shipped, real workflow fired against live API |
| Gensyn AXL | `$5,000` | Adapter shipped (decision gossip transport), MCP-style publish endpoint |
| **Total addressable** | **`$25,000`** | All three adapters real, tested, env-gated, soft-failure |

## How to add a new sponsor

1. Add a research note `<sponsor>.md` in this folder — what it does, what its API looks like, what shape it expects.
2. Pick the right trait seam: `Store`, `Simulator`, `PlaybookRunner`, `NotificationChannel`, or `GossipTransport`.
3. Implement the real adapter in `src/<area>/`, mirroring an existing one (`KeeperHubRunner` for HTTP-based, `ZeroGStore` for SDK-based).
4. Wire it into [`../../src/risk-gate/server.ts`](../../src/risk-gate/server.ts), env-gated so a missing key falls back to the in-memory or no-op impl.
5. Add tests under `../../tests/<adapter>.test.ts` — happy path + soft-failure + adversarial bodies.
6. Update [`../../README.md`](../../README.md) sponsor section + this index.

## Pointers

| | |
|---|---|
| Parent | [`../README.md`](../README.md) |
| Project root | [`../../README.md`](../../README.md) |
| Wiring conventions | [`../../.claude/skills/sponsor-wiring/SKILL.md`](../../.claude/skills/sponsor-wiring/SKILL.md) |
