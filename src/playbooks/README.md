# `src/playbooks/` — remediation + notifications

> When a verdict is `BLOCK`, ChainShield does more than say "no" — it fires an automated remediation playbook and pages every configured notification channel. Both layers are pluggable behind small interfaces.

| File | Role |
|---|---|
| [`runner.ts`](./runner.ts) | The `PlaybookRunner` and `NotificationChannel` interfaces, plus `MockRunner` for tests |
| [`keeperhub.ts`](./keeperhub.ts) | `KeeperHubRunner` — fires KeeperHub workflows via `POST /api/workflow/:id/execute` with bearer auth, scrubs HTML error pages |
| [`notifier.ts`](./notifier.ts) | `WebhookChannel` (Discord-shaped embed by default, custom shapes via `contentTemplate`) and `CollectorChannel` (test-only in-memory recorder) |

## Remediation flow

```mermaid
flowchart LR
    Engine[DecisionEngine.handleRemediation] --> R{remediation.onBlock?}
    R -->|empty| N
    R -->|ids[]| RR[KeeperHubRunner.run id 0]
    RR -->|ok| Decision[playbookTriggered set]
    RR -->|throws| Next[try id 1, id 2, ...]
    Next -->|all fail| Decision2[reasons append failure]
    Decision --> N{notifyChannels?}
    Decision2 --> N
    N -->|empty| Done
    N -->|name list| CH[for each registered channel<br/>WebhookChannel.notify]
    CH --> Done[return decision]
```

## Hard rules

- A failing playbook **never** affects the verdict or persistence — failures are pushed into `decision.reasons` (truncated to 256 chars) and the engine continues.
- Notification failures are silently swallowed — paging cannot down-convert a `BLOCK` to anything else.
- `KeeperHubRunner` returns the first response field it finds in priority `runId → id → executionId` and falls back to `"unknown"` so the JSON shape stays stable.
- HTML error bodies (auth-failure pages, 404s) are detected by `summarizeErrorBody` and replaced with `(html error page)` before they reach `decision.reasons` or the UI.

## Tests

| | |
|---|---|
| `MockRunner` invocation tracking + forced failures | [`../../tests/playbooks.test.ts`](../../tests/playbooks.test.ts) |
| `KeeperHubRunner` happy path, response-shape fallback, HTML scrub, body truncation, URL encoding | same file |
| `WebhookChannel` Discord embed shape + custom template + non-2xx error | same file |
| Engine integration: trigger on `BLOCK`, fall-through on failure, notification fan-out | [`../../tests/engineRemediation.test.ts`](../../tests/engineRemediation.test.ts) |

## Pointers

| | |
|---|---|
| Parent | [`../README.md`](../README.md) |
| Wired by | [`../risk-gate/server.ts`](../risk-gate/server.ts) — picks `KeeperHubRunner` when `KEEPERHUB_API_KEY` is set |
| Helper script | [`../../scripts/kh.sh`](../../scripts/kh.sh) — `list / get / run / status / ping` against the live KeeperHub API |
| Sponsor research | [`../../docs/sponsors/keeperhub.md`](../../docs/sponsors/keeperhub.md) |
