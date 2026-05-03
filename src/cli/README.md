# `src/cli/` — demo runner

> A four-scene CLI that drives the live API end-to-end. Used for the recording and as a smoke test before submission.

| File | Role |
|---|---|
| [`demo.ts`](./demo.ts) | Boots a fresh policy via `POST /policies`, then runs four `POST /evaluate` calls covering every verdict path. Exits `0` if the verdict and reasons match the expected shape, `1` otherwise. |

## Scenes

| # | Intent | Expected verdict | Rule that fires |
|---|---|---|---|
| 1 | Small transfer to allowlisted vault | `ALLOW` | (all rules pass) |
| 2 | Transfer above the per-tx ETH cap | `BLOCK` | `maxTransferEth` |
| 3 | `approve(spender, MAX_UINT256)` | `BLOCK` | `forbiddenSelectors` (or `approvalCapByToken`) |
| 4 | Transfer to an off-allowlist destination | `REQUIRE_HUMAN_CONFIRMATION` | `allowedDestinations` |

## How to run

```sh
# 1. boot the API (in another terminal)
bun run dev

# 2. drive the four scenes
bun run demo
```

The demo uses `INTERNAL_API_BASE` if set, otherwise defaults to `http://127.0.0.1:8787`. Output prints the verdict, risk score, matched rules, and the `anchor.rootHash` if 0G is wired.

## Pointers

| | |
|---|---|
| Parent | [`../README.md`](../README.md) |
| API surface | [`../risk-gate/app.ts`](../risk-gate/app.ts) |
| Recording walkthrough | [`../../docs/demo-script.md`](../../docs/demo-script.md) |
