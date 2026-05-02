# AGENTS.md

Project conventions and pointers for AI coding agents (and humans) working in this repo.

## What this project is

ChainShield Agent: a policy-bound risk gate for onchain treasuries and wallets. The server accepts a transaction intent, evaluates it against deterministic rules plus (eventually) simulation and LLM reflection, and returns one of three verdicts: `ALLOW`, `REQUIRE_HUMAN_CONFIRMATION`, or `BLOCK`. Every decision is appended to an incident timeline.

Built for ETHGlobal OpenAgents 2026 (deadline: Sun May 3 2026 night). Active sponsor integration: KeeperHub (remediation playbooks, real REST against `/api/workflow/:id/execute`). Planned: 0G (storage + inference). Cut for hackathon: Gensyn AXL mesh, Solidity contracts, Rust port.

## Tech stack

The production backend is planned to move to **Rust + a small Solidity layer** post-hackathon. The current ship is **TypeScript end-to-end**: Fastify server in `src/`, Astro frontend in `web/`. Tests cover the engine, policy service, API, KeeperHub runner, notification channels, and the remediation flow.

### Rust (Phase 2+, primary)

- Runtime: stable Rust 1.83+
- HTTP: `axum` + `tower`
- Async: `tokio`
- Serialization: `serde` + `serde_json`
- EVM simulation: `revm`
- Onchain client: `alloy` (preferred) or `ethers-rs`
- HTTP client: `reqwest`
- Errors: `thiserror` (typed) + `anyhow` (boundary)
- Tests: built-in `cargo test`

### Solidity (Phase 2+, small surface)

- Toolchain: Foundry (`forge`, `cast`, `anvil`)
- Compiler: 0.8.24+
- Style: OpenZeppelin imports where available

### TypeScript server (Phase 1 scaffold, Bun-hosted)

- Runtime: Bun 1.3 (single tool for install, run, test, build)
- Language: TypeScript with strict mode
- HTTP: Fastify 5 + `@fastify/cors`
- Validation: Zod
- Onchain: ethers v6
- Tests: `bun:test`
- Containerization: Docker (multi-stage on `oven/bun:1.3-alpine`) — server-only image; the Astro frontend ships separately

The TS server is the conformance test suite for the Rust port: same JSON shapes, same verdict ladder, same UI.

### Frontend (Astro, lives in `web/`)

- Framework: Astro 6 (vanilla TS, no React/Vue)
- Output: static (`astro build` emits HTML+JS to `web/dist`)
- Dev server: Vite-backed, port 4321
- Type checking: `astro check` via `@astrojs/check`
- API access: cross-origin fetch to `http://127.0.0.1:8787` in dev (CORS allowed); same-origin in prod
- Components are presentational (`.astro` files); all interactivity lives in `web/src/lib/*.ts` modules invoked from `web/src/scripts/main.ts`
- Buttons use `data-action="…"` attributes wired up in `main.ts` — no inline `onclick` handlers

## Run, test, build

### Today (TypeScript server + Astro frontend)

```sh
# install both
bun install                # root (server)
bun install --cwd web      # web (Astro)

# develop: starts both processes in parallel
bun run dev                # server on :8787, web on :4321 (open http://127.0.0.1:4321)

# develop one at a time
bun run dev:server         # just the Fastify server
bun run dev:web            # just the Astro frontend

# tests (server only)
bun test                   # 37 specs, ~170ms
bun run test:coverage      # v8 coverage report

# type checks
bun run typecheck          # both: server + web
bun run typecheck:server   # tsc --noEmit
bun run typecheck:web      # cd web && astro check

# production build
bun run build              # both: dist/server.js + web/dist/
bun run start:bundle       # run the bundled server
bun run preview:web        # preview the Astro static output

# cleanup
bun run clean              # remove dist/, coverage/, web/dist/, web/.astro/
```

Docker path:

```sh
docker compose up --build  # builds and runs the server on host port 8787
                            # the Astro frontend ships separately as static files
```

### Rust workspace (planned, Phase 2+)

```sh
cargo build                # debug build
cargo build --release      # production build
cargo run -p risk-gate     # run the server crate
cargo test                 # full workspace test suite
cargo test -p engine       # tests for a single crate
cargo clippy --all-targets -- -D warnings   # lint
cargo fmt --all            # format
```

### Solidity (planned, Phase 2+)

```sh
forge build                # compile contracts
forge test -vvv            # run tests with traces
forge script script/Deploy.s.sol --broadcast --rpc-url galileo
```

## Where things live

### Today (TypeScript server + Astro frontend)

- `src/core/` — types, Zod schemas, policy service, decision engine, EVM selector helpers
- `src/memory/` — `Store` interface and the in-memory implementation
- `src/playbooks/` — `PlaybookRunner` interface + `KeeperHubRunner` + `MockRunner` + notification channels
- `src/risk-gate/` — Fastify app + server entrypoint (CORS-enabled for the Astro origin)
- `tests/` — `bun:test` specs covering engine rules, policy service, API, runners, and remediation flow
- `web/` — Astro project (frontend)
  - `web/src/pages/index.astro` — composes the page, imports `main.ts`
  - `web/src/layouts/Layout.astro` — global shell, fonts, body
  - `web/src/components/` — `Masthead`, `Hero`, `PolicySection`, `EvaluateSection`, `TimelineSection`, `JsonModal`
  - `web/src/styles/global.css` — the entire design system
  - `web/src/lib/` — typed TS modules: `types`, `api`, `format`, `modal`, `policies`, `evaluate`, `timeline`
  - `web/src/scripts/main.ts` — single entry: ticks the clock, wires `data-action` listeners, kicks off initial loads
- `scripts/` — shell helpers: `dev.sh` (parallel dev), `kh.sh` (KeeperHub REST CLI)
- `docs/` — architecture, product story, sponsor research
- `.claude/skills/` — reusable agent skills

### Planned (Rust + Solidity, Phase 2+)

- `crates/core/` — types, policy schema, decision engine
- `crates/engine/` — orchestrator that composes core + simulator + inference + playbooks
- `crates/risk-gate/` — Axum HTTP server (the binary)
- `crates/simulator/` — REVM-based tx simulation
- `crates/memory/` — `Store` trait + adapters (in-memory, 0G via sidecar)
- `crates/inference/` — `InferenceClient` trait + 0G impl
- `crates/playbooks/` — KeeperHub REST client + notification channels
- `crates/mesh/` — Gensyn AXL bridge client
- `contracts/` — Foundry project: `PolicyAnchor.sol`, optional `EmergencyVault.sol`
- `infra/keeperhub-templates/` — JSON workflow definitions for playbooks
- `0g-bridge/` — small Go or TS sidecar process that exposes 0G Storage SDK over HTTP for the Rust crates to call (the 0G SDK has no Rust client)

Empty dirs are not pre-created. Add each when the code arrives.

## Conventions

### TypeScript code style (scaffold)

- Strict TypeScript. `noUncheckedIndexedAccess` is on, so always handle `undefined` from `arr[i]` and `Map.get`.
- ESM only. Imports of local files use the `.js` extension (Node ESM convention; Bun and `tsc` both honor it).
- No default exports for app code.
- Prefer interfaces for public shapes, type aliases for unions and primitives.
- Validate at the boundary (HTTP body, env, untrusted JSON) with Zod, then trust the typed value internally.
- Keep error messages user-facing; the Fastify error handler already formats Zod errors as 400s.

### Rust code style

- `#![deny(warnings)]` is overkill in CI; instead run `cargo clippy --all-targets -- -D warnings` and require it green.
- Use `thiserror` for typed crate-level error enums; `anyhow::Result` only at the binary boundary.
- No `unwrap()` / `expect()` outside tests, examples, or one-off scripts. Prefer `?`.
- One trait per behaviour seam (`Store`, `Simulator`, `InferenceClient`, `PlaybookRunner`); keep concrete clients substitutable.
- `serde::Serialize` / `serde::Deserialize` derives for every wire type. Field names match the JSON the TS scaffold emits, byte-for-byte.
- Integration tests under `crates/<name>/tests/`; unit tests in-module under `#[cfg(test)]`.
- Use `tokio::test` for async tests; do not block on `block_on` inside async code.

### Solidity code style

- Solidity 0.8.24+, `pragma solidity ^0.8.24;` exact at the top.
- Use OpenZeppelin (`@openzeppelin/contracts`) for `Ownable`, `Pausable`, `ReentrancyGuard`.
- Custom errors instead of `require(_, "string")`; saves gas and keeps revert reasons typed.
- Foundry tests in `contracts/test/<Name>.t.sol`. Run with `-vvv` when debugging.
- Use `forge fmt` to format; do not hand-format.
- Only ever target Galileo testnet (chain id 16602) for the demo. Mainnet deploys are out of scope.

### Tests

- Co-located test data in `tests/helpers.ts` (canonical addresses, intent and policy factories).
- One feature per `it()`. Assertions on the verdict, the matched rules, and the risk score together; do not assert just one of them.
- Inject `now()` and `idGen()` into `DecisionEngine` and `PolicyService` for deterministic timestamps and ids.
- Do not mock the in-memory store; use a fresh `InMemoryStore` per test.

### Commits

- One-line subjects when possible. Imperative mood (`add`, `fix`, `refactor`, never `added`/`adding`).
- Lowercase first letter unless it is a proper noun.
- Group related changes into a single commit; split unrelated work.
- Never amend a pushed commit unless the user asks for it.

### Branches

- Feature branches: `feature/<short-name>`.
- Default base for PRs: `sponsor-features`.

## Decision-engine contract (do not break)

The engine is the heart of the product. Keep these invariants when changing it:

1. The verdict ladder is `BLOCK > REQUIRE_HUMAN_CONFIRMATION > ALLOW`. A rule may only escalate, never de-escalate.
2. `forbiddenSelectors` is checked before any other rule and short-circuits to `BLOCK` with risk 95.
3. `maxTransferEth` and `approvalCapByToken` produce `BLOCK` with risk >= 90.
4. `maxDailyOutflowEth` reads the timeline; only non-blocked decisions count toward the rolling sum.
5. `allowedDestinations` downgrades `ALLOW` to `REQUIRE_HUMAN_CONFIRMATION` (risk 60). It does not upgrade to `BLOCK` on its own.
6. Every decision is persisted via `Store.appendDecision` exactly once.
7. `reasons[]` is human-readable English; `rulesMatched[]` is machine-readable rule keys. Keep them in sync.

## Things to avoid

- Do not add a new sponsor adapter without an interface in front of it. The `Store` interface is the template: keep concrete clients (e.g. `ZeroGStore`, `KeeperHubRunner`) substitutable.
- Do not bake API keys or RPC URLs into source. Read them from `process.env` (see `.env.example`).
- Do not add backwards-compatibility shims. The repo is pre-release; rename freely.
- Do not write to disk from the server process. State belongs in the `Store` (today in-memory, tomorrow 0G).
- Do not introduce a UI build step. The browser UI is a single static HTML file served by Fastify; keep it that way until a real framework is justified.
- Do not use emojis anywhere in source, tests, docs, commit messages, PR descriptions, or UI text.

## Skills available

Project-local Claude Code skills live in `.claude/skills/`. Invoke them via the `Skill` tool when a task matches their description.

- `selector-decode`: when you see a 4-byte calldata selector (`0x` + 8 hex) and need to know which function it identifies, or you need to author a forbidden-selector list.
- `policy-author`: when you are designing a new `Policy` for a wallet or treasury and need a structured approach.
- `erc20-attack-patterns`: when reasoning about token approvals, transfers, or related ERC-20 attack vectors.
- `sponsor-wiring`: when starting Phase 2 and adding the 0G, KeeperHub, or Gensyn AXL adapter modules.
- `rust-backend-style`: when writing or reviewing Rust code in this repo. Crate layout, error handling, async, serde shapes, testing patterns.
- `solidity-contracts`: when authoring or reviewing the onchain layer. Patterns for `PolicyAnchor`, `EmergencyVault`, custom errors, Foundry tests.

Read the corresponding `SKILL.md` before acting.

## Environment

`.env.example` lists every variable the project may read, grouped by phase. Phase 1 needs none; Phase 2 needs the 0G and KeeperHub credentials.

## Out of scope

- Production deployment, CI/CD, multi-tenant auth, observability stack. This is a hackathon prototype.
- Any chain other than 0G Galileo (testnet, chain id 16602) for the demo. The schema accepts any chain id, but routing logic is single-chain for now.
