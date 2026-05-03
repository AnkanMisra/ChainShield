# `scripts/` — operator helpers

> Small bash scripts used during development. Both honour `.env.local` so credentials never live on the command line.

| File | What it does |
|---|---|
| [`dev.sh`](./dev.sh) | Boots the API on `:8787` (Bun watch mode) and the Astro frontend on `:4321` in parallel. Kills both on Ctrl-C. Wired to `bun run dev` |
| [`kh.sh`](./kh.sh) | Bash wrapper for the KeeperHub REST API — reads `KEEPERHUB_API_KEY` and `KEEPERHUB_API_URL` from `.env.local`. Subcommands: `list`, `get <id>`, `run <id>`, `status <runId>`, `ping` |

## `kh.sh` examples

```sh
./scripts/kh.sh ping                   # auth check
./scripts/kh.sh list                   # workflows in the org
./scripts/kh.sh get 8c12ujo1ax7b93w21updd
./scripts/kh.sh run 8c12ujo1ax7b93w21updd '{"owner":"0xtreasury"}'
./scripts/kh.sh status <runId>
```

The wrapper exists so workflow ids can be discovered and exercised without rerunning the full server, and so the org-key vs user-key distinction is centralised in one place rather than repeated in shell history.

## Conventions

- Every script reads `.env.local` if it exists; never echoes secrets.
- Failures `exit 1` with a one-line reason; success is silent or prints structured output.
- No `set -e` shortcuts that silently mask real failures — explicit checks for empty env vars and HTTP non-2xx.

## Pointers

| | |
|---|---|
| Parent | [`../README.md`](../README.md) |
| KeeperHub adapter | [`../src/playbooks/keeperhub.ts`](../src/playbooks/keeperhub.ts) |
| Sponsor research | [`../docs/sponsors/keeperhub.md`](../docs/sponsors/keeperhub.md) |
| Env template | [`../.env.example`](../.env.example) |
