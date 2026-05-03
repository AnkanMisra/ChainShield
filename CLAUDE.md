# CLAUDE.md

Project context for Claude Code. Read this first.

## What this is

**ChainShield Agent** — a policy-bound risk gate for treasury wallets. Built for ETHGlobal OpenAgents 2026. The server takes a transaction intent, evaluates it against deterministic rules + a heuristic ERC-20 simulator, anchors the resulting decision JSON on 0G Storage, and fires KeeperHub remediation playbooks on `BLOCK`. Three verdicts: `ALLOW`, `REQUIRE_HUMAN_CONFIRMATION`, `BLOCK`.

The submission is shipped: PR #6 merged into `main` on 2026-05-03. 112 specs across 13 files green. Live anchor verified on Galileo testnet.

## Stack (do not assume Rust/Solidity)

This repo is **100% TypeScript on Bun**. No Rust files, no Solidity contracts. The "Rust + Solidity" sections in [`docs/architecture.md`](./docs/architecture.md) describe a post-hackathon roadmap, not anything that ships. Do not write `.rs` or `.sol` files unless the user explicitly asks.

- Runtime: Bun 1.3
- HTTP: Fastify 5 + `@fastify/cors`
- Schema: Zod (boundary only)
- Onchain client: `ethers` v6
- 0G persistence: `@0gfoundation/0g-storage-ts-sdk`
- Frontend: Astro 6 at `web/` (separate Bun workspace with its own `bun.lock`)
- Tests: `bun:test`

## Run, test, build

```sh
bun install                # root deps
(cd web && bun install)    # frontend deps (separate workspace)

bun run dev                # parallel: API on :8787, Astro on :4321
bun run dev:server         # just the Fastify server
bun run dev:web            # just the Astro frontend

bun run typecheck          # both: server + web (must be 0 errors)
bun test                   # 112 specs
bun run demo               # CLI four-scene runner against the live API

bun run build              # bundle server + Astro static output
docker compose up --build  # containerised path
```

## Where things live

- `src/core/` — types, Zod schemas, policy service, 5-rule decision engine, EVM selector helpers
- `src/memory/` — `Store` interface, `InMemoryStore`, `ZeroGStore` (0G anchor adapter)
- `src/simulator/` — `Simulator` interface, `HeuristicSimulator` (ERC-20 calldata decode + balance projection)
- `src/playbooks/` — `PlaybookRunner` interface, `KeeperHubRunner`, notification channels
- `src/risk-gate/` — Fastify `app.ts` and `server.ts` composition root
- `src/cli/demo.ts` — four-canonical-scene CLI
- `tests/` — 112 specs across 13 files
- `web/` — Astro 6 frontend (components, lib, pages, styles)
- `docs/` — `submission.md` (judge one-pager), `demo-script.md`, `architecture.md`, `sponsors/`
- `scripts/` — `kh.sh` (KeeperHub helper), `dev.sh` (parallel dev)
- `.claude/skills/` — local skills. `rust-backend-style/`, `solidity-contracts/`, `sponsor-wiring/` are roadmap-only and do **not** apply to current code.

## Hard constraints

- **No emojis anywhere.** Source, tests, docs, commit messages, PR descriptions, UI text — none. Run a byte-level scan (`\xf0\x9f`, `\xe2\x9c\x85`, `\xe2\x8f\xb3`) before every commit.
- **No Claude / Anthropic references in commits or PRs.** No `Co-Authored-By` trailer.
- **Commit messages**: one line, lowercase first letter, imperative mood (`add`, `fix`, `refactor`), no `added`/`adding`. Group related changes; split unrelated ones.
- **Default base for PRs**: `main`.
- **No `unwrap`-equivalent shortcuts.** Don't bypass safety checks (`--no-verify`, `--force`, etc.) without explicit user approval.
- **No backwards-compatibility shims.** This is a hackathon prototype; rename freely.
- **Never commit secrets.** `.env.local` is gitignored. Don't print env values containing API keys or private keys to the terminal.

## Decision-engine invariants (do not break)

1. Verdict ladder is monotonic: `BLOCK > REQUIRE_HUMAN_CONFIRMATION > ALLOW`. A rule may only escalate, never de-escalate.
2. `forbiddenSelectors` is checked before any other rule and short-circuits to `BLOCK` with risk 95.
3. `maxTransferEth` and `approvalCapByToken` produce `BLOCK` with risk ≥ 90.
4. `maxDailyOutflowEth` reads the timeline; only non-blocked decisions count toward the rolling sum.
5. `allowedDestinations` downgrades `ALLOW` to `REQUIRE_HUMAN_CONFIRMATION` (risk 60). It does not promote to `BLOCK` on its own.
6. Defensive guards (`invalidIntentValue`, `invalidApprovalCap`) escalate to `REQUIRE_HUMAN_CONFIRMATION` (risk 70) instead of throwing.
7. Every decision is persisted via `Store.appendDecision` exactly once.
8. `reasons[]` is human-readable English; `rulesMatched[]` is machine-readable rule keys. Keep them in sync.

## Sponsor adapters (env-gated, fall back gracefully)

- `ZERO_G_PRIVATE_KEY` set → `ZeroGStore` anchors policies and decisions on Galileo. Unset → `InMemoryStore`. Upload failures are logged and the local write still succeeds, so the API never blocks on chain availability.
- `KEEPERHUB_API_KEY` set → `KeeperHubRunner` fires real workflows on `BLOCK`. Unset → `MockRunner`.
- `NOTIFY_DISCORD_WEBHOOK` set → adds a `discord` notification channel.
- See `.env.example` for the full list with defaults.

## Common gotchas

- **`web/` is a separate Bun workspace.** It has its own `bun.lock`, its own `tsconfig.json` (extends `astro/tsconfigs/strict`), and its own dev server on `:4321`. The root `bun.lock` does not cover frontend deps. Run `(cd web && bun install)` after pulling.
- **CORS is required for the Astro UI.** `src/risk-gate/app.ts` registers `@fastify/cors` with `WEB_ORIGIN` env (defaults to `http://127.0.0.1:4321,http://localhost:4321`).
- **`ESM with .js` import suffix.** TypeScript imports of local files use `.js` even though the source is `.ts` — Node ESM convention; Bun and `tsc` both honor it.
- **`noUncheckedIndexedAccess` is on.** Always handle `undefined` from `arr[i]` and `Map.get`.
- **There is no `public/index.html`.** The legacy single-file UI was removed in PR #6. Astro at `web/` is the only frontend.
- **0G testnet wallet must be funded** before live anchor testing. Faucets: <https://faucet.0g.ai> and <https://cloud.google.com/application/web3/faucet/0g/galileo>. ~0.1 0G/wallet/day. Costs ~0.001 0G per anchor.

## CI

Every PR to `main` and every push to `main` runs [`.github/workflows/ci.yml`](./.github/workflows/ci.yml). The pipeline:

1. Installs root deps with `bun install --frozen-lockfile`
2. Installs web deps with `bun install --frozen-lockfile`
3. `bun run typecheck:server` — `tsc --noEmit`
4. `bun run typecheck:web` — `astro check`
5. `bun test` — 112 specs
6. `bun run build:web` — Astro production build
7. Emoji scan — fails the build if any banned emoji byte sequence appears in tracked files

If you change `package.json` or `web/package.json`, run `bun install` (no flag) locally first and commit the regenerated `bun.lock` / `web/bun.lock`. CI runs with the frozen lockfile.

The Bun version is pinned in `.bun-version` (currently `1.3.13`) and read by `setup-bun@v2` so CI and local match.

## Pointers

- [`AGENTS.md`](./AGENTS.md) — extended project conventions for AI agents
- [`README.md`](./README.md) — project overview, run instructions, sponsor integrations
- [`docs/submission.md`](./docs/submission.md) — judge one-pager with on-chain proof
- [`docs/demo-script.md`](./docs/demo-script.md) — 7-beat recording walkthrough
- [`docs/architecture.md`](./docs/architecture.md) — system design + post-hackathon Rust roadmap
- [`docs/sponsors/`](./docs/sponsors) — sponsor research notes (0G, KeeperHub, Gensyn AXL)
