# ChainShield web

Astro 6 frontend for ChainShield Agent. Vanilla TypeScript, no React or Vue.

This package is a separate Bun workspace from the root: it has its own `package.json`, `bun.lock`, `tsconfig.json`, and `node_modules`.

## Run

All commands are issued with **Bun**. Do not use npm or yarn — the lockfile is `bun.lock`.

| Command                          | What it does                                                  |
| :------------------------------- | :------------------------------------------------------------ |
| `bun install`                    | Install dependencies for the frontend (run once after clone). |
| `bunx --bun astro dev`           | Start the dev server at `http://127.0.0.1:4321`.              |
| `bunx --bun astro build`         | Build the production static site to `web/dist/`.              |
| `bunx --bun astro preview`       | Preview the production build locally.                         |
| `bunx --bun astro check`         | Run `astro check` — the project's type-check for `.astro` files. |
| `bunx --bun astro -- --help`     | Astro CLI help.                                               |

`bunx --bun` forces Astro to run on Bun's runtime instead of the system Node, which keeps the toolchain consistent and matches the version pinned in the repo's `.bun-version` (`1.3.13`).

The same scripts are exposed at the repo root with `:web` suffixes (`bun run dev:web`, `bun run build:web`, `bun run typecheck:web`, `bun run preview:web`).

## Layout

```text
web/
├── public/                      # static assets (favicon, etc.)
├── src/
│   ├── components/              # .astro components
│   ├── layouts/Layout.astro     # page chrome
│   ├── lib/                     # typed TS modules (api, evaluate, format, modal, policies, timeline, types)
│   ├── pages/index.astro        # the only page
│   ├── scripts/main.ts          # entry point, wires data-action handlers
│   └── styles/global.css        # global stylesheet
├── astro.config.mjs
├── package.json
└── tsconfig.json                # extends astro/tsconfigs/strict
```

Astro routes pages under `src/pages/` based on file name. Components live in `src/components/`. All client-side interactivity lives in `src/lib/*.ts` modules invoked from `src/scripts/main.ts` — no inline `onclick` handlers; buttons use `data-action="..."` attributes wired up at load.

## API

The frontend talks to the Fastify risk-gate API at `http://127.0.0.1:8787` in dev. CORS for the Astro origin is registered in `src/risk-gate/app.ts` (root) and pinned via the `WEB_ORIGIN` env variable.
