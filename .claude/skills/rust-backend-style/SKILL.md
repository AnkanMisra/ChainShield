---
name: rust-backend-style
description: Use when writing or reviewing Rust code in this repo. Covers the Cargo workspace layout, error handling, async patterns, serde wire shapes that must match the TypeScript scaffold byte-for-byte, and testing conventions specific to ChainShield.
---

# rust-backend-style

> **Post-hackathon plan.** The May 3 2026 ETHGlobal submission ships TypeScript end-to-end (`src/` for the Fastify server, `web/` for the Astro frontend). This skill describes the planned Rust port that follows the hackathon — the Cargo workspace below is not yet present in the repo.

The production backend (post-hackathon) is a Cargo workspace. The TypeScript code under `src/` is the conformance reference — Rust must produce identical JSON for the same inputs.

## Workspace layout

```
chainshield/
├── Cargo.toml             # workspace root
└── crates/
    ├── core/              # types, schemas, decision engine
    ├── engine/            # orchestrator that composes core + simulator + inference + playbooks
    ├── risk-gate/         # axum HTTP server (the binary)
    ├── simulator/         # revm-based tx simulation
    ├── memory/            # Store trait + adapters
    ├── inference/         # InferenceClient trait + impls
    ├── playbooks/         # KeeperHub REST + NotificationChannel
    └── mesh/              # Gensyn AXL bridge client and three role-binaries
```

`crates/core/` has zero non-trivial dependencies (only `serde`, `serde_json`, `thiserror`, `chrono`). It compiles in isolation. Every other crate depends on `core` either directly or transitively.

## Cargo.toml conventions

Workspace root:

```toml
[workspace]
members = ["crates/*"]
resolver = "2"

[workspace.package]
edition = "2021"
rust-version = "1.83"
license = "MIT"
publish = false

[workspace.dependencies]
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["full"] }
async-trait = "0.1"
thiserror = "1"
anyhow = "1"
reqwest = { version = "0.12", default-features = false, features = ["json", "rustls-tls"] }
axum = "0.7"
tower = "0.5"
tower-http = { version = "0.5", features = ["cors", "trace"] }
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter"] }
alloy = { version = "0.7", features = ["full"] }
revm = "16"
chrono = { version = "0.4", features = ["serde"] }
uuid = { version = "1", features = ["v4", "serde"] }
rmp-serde = "1"     # msgpack for AXL mesh payloads
```

Each crate's `Cargo.toml`:

```toml
[package]
name = "chainshield-core"
version = "0.1.0"
edition.workspace = true
rust-version.workspace = true
license.workspace = true
publish.workspace = true

[dependencies]
serde.workspace = true
serde_json.workspace = true
thiserror.workspace = true
```

## Error handling

- Use `thiserror` for crate-level error enums. Each public error implements `std::error::Error`, `Debug`, and `Display`, and exposes a stable variant name.
- Use `anyhow::Result` only at the binary boundary (`main.rs`, integration tests).
- No `unwrap()` or `expect()` in production code. The single exception is parsing a literal address constant (`Address::from_str("0x...").unwrap()` for a hardcoded canonical address). Comment why.
- No panics behind `?`. Every `Result` either propagates with context or is handled.

```rust
#[derive(Debug, thiserror::Error)]
pub enum DecisionError {
    #[error("policy {0} not found")]
    PolicyNotFound(String),
    #[error("calldata too short for selector decode")]
    CalldataTooShort,
    #[error("store error: {0}")]
    Store(#[from] StoreError),
}
```

## Async

- `tokio` runtime. `axum` server uses `tokio::main`.
- Spawned background tasks must be tracked. Prefer structured concurrency via `tokio::join!`, `tokio::select!`, or `JoinSet`. Detached tasks (`tokio::spawn(...).expect_into_void()`) are forbidden.
- HTTP clients (`reqwest::Client`) are constructed once at startup and shared via `Arc`. Never construct per-request.
- For interior mutability across awaits, use `tokio::sync::Mutex`; never `std::sync::Mutex` across `.await`.

## Wire shapes (serde)

The Rust types must serialize to the same JSON the TypeScript scaffold produces. Field names use camelCase via `#[serde(rename_all = "camelCase")]` on the struct, OR explicit `#[serde(rename = "...")]` per field.

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Policy {
    pub id: String,
    pub owner: Address,
    pub rules: PolicyRules,
    pub remediation: PolicyRemediation,
    pub version: u32,
    pub updated_at: u64,
}
```

The Rust field `updated_at` becomes JSON `"updatedAt"`. The TypeScript shape expects `"updatedAt"`. Match required.

For optional fields, use `Option<T>` plus `#[serde(skip_serializing_if = "Option::is_none")]` so absent fields are omitted, not emitted as `null`. The TS scaffold also omits absent optionals.

## Trait seams

Every external dependency goes behind a trait. Implementations are interchangeable:

```rust
#[async_trait::async_trait]
pub trait Store: Send + Sync {
    async fn put_policy(&self, policy: &Policy) -> Result<(), StoreError>;
    async fn get_policy(&self, id: &str) -> Result<Option<Policy>, StoreError>;
    async fn append_decision(&self, decision: &Decision) -> Result<(), StoreError>;
    // ...
}
```

Concrete impls: `InMemoryStore` for tests + dev, `ZeroGStore` for prod (talks to the 0G sidecar over loopback HTTP).

## Testing

- Unit tests in-module under `#[cfg(test)] mod tests { ... }`.
- Integration tests under `crates/<name>/tests/<topic>.rs` — one file per concern.
- Use `tokio::test` for async tests. Never `block_on` inside an async test.
- Test helpers (canonical addresses, intent factories, policy factories) live in `crates/core/src/testkit.rs` behind a `pub(crate)` module gated by `#[cfg(any(test, feature = "testkit"))]`.

```rust
#[tokio::test]
async fn decision_engine_blocks_over_cap_transfer() {
    let store = Arc::new(InMemoryStore::default());
    let engine = DecisionEngine::new(store.clone());
    let policy = make_policy(|r| { r.max_transfer_eth = Some(1.0); });
    let intent = make_intent(|i| { i.value = wei("5"); });

    let decision = engine.evaluate(&intent, &policy).await.unwrap();

    assert_eq!(decision.verdict, Verdict::Block);
    assert!(decision.rules_matched.contains(&"maxTransferEth".to_string()));
    assert!(decision.risk_score >= 90);
}
```

Assertion style: assert verdict, matched rules, and risk score together — not just one.

## Lints

CI must run `cargo clippy --all-targets --all-features -- -D warnings`. Local muscle memory:

```sh
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --all -- --check
cargo test --workspace
```

Build the habit of running clippy before committing; `#[allow(...)]` is permitted only with a comment explaining why.

## Module structure inside a crate

```
crates/core/
├── Cargo.toml
└── src/
    ├── lib.rs            # pub use re-exports only
    ├── types.rs          # Policy, Decision, TxIntent, Address newtype
    ├── selectors.rs      # selector helpers (no ABI coder dep)
    ├── engine.rs         # DecisionEngine
    ├── policy_service.rs # PolicyService
    └── testkit.rs        # canonical addresses + factories, behind cfg(any(test, feature="testkit"))
```

`lib.rs` is a thin re-export layer:

```rust
mod engine;
mod policy_service;
mod selectors;
mod types;

pub use engine::{DecisionEngine, DecisionEngineOptions};
pub use policy_service::PolicyService;
pub use selectors::{selector_of, decode_address, decode_uint256, ERC20_APPROVE, ERC20_TRANSFER, ERC20_TRANSFER_FROM};
pub use types::{Address, Decision, Policy, PolicyRules, PolicyRemediation, TxIntent, Verdict};

#[cfg(any(test, feature = "testkit"))]
pub mod testkit;
```

Internal modules are private. The lib crate is the only API surface.

## Commits and PRs

- One crate per commit when feasible. Do not mix `core` changes with `playbooks` changes in the same commit.
- Reference the affected crate(s) in the commit subject: `engine: split simulation from policy evaluation`.
- New trait impls always ship with at least one test that exercises the impl end-to-end.

## Things to avoid

- Re-deriving `Default` for types that should require explicit construction (Policy, Decision).
- `Box<dyn Error>` returns in public APIs. Use the crate's `Result` alias.
- Importing from sibling crates with `use crate::...`. Use the crate's published name (`use chainshield_core::Policy;`).
- Hidden globals. State that crosses tasks lives in `Arc<...>` passed explicitly.
- Feature flags for sponsor-specific code paths. Sponsors plug in via traits, not features.
