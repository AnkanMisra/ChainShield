# Deploy ChainShield Agent for $0/month

Two free hosts, no credit card on either side, indefinite free tier on both. Total elapsed time ≈ 15 minutes.

| Layer | Platform | URL pattern |
|---|---|---|
| API server (Bun + Fastify + 0G SDK) | **Render** Web Service (free) | `https://chainshield-api.onrender.com` |
| Frontend (Astro static) | **Cloudflare Pages** (free) | `https://chainshield.pages.dev` |
| Keep-warm pinger | **UptimeRobot** (free) | (out-of-band) |

Why this combination:

- **Render** is the only $0 / no-CC option whose free tier permits the raw outbound TCP that the 0G storage SDK needs (port 5678 to storage nodes). Cloudflare Workers / Vercel Functions / Netlify Functions are all HTTP-only egress and **break the 0G upload path** — they're disqualified for the API.
- **Cloudflare Pages** is the only static host with truly unlimited bandwidth and unlimited requests on the free tier. Vercel and Netlify both meter at 100 GB/mo.
- **UptimeRobot** keeps Render's free tier from sleeping, mitigating the 30-50s cold-start penalty during a demo.

> Skip deployment entirely if you only need the project running locally — `docker compose up --build` is the path for that. This guide is for putting a public URL in front of the project so anyone (e.g. ETHGlobal judges) can hit it without cloning the repo.

---

## Prereqs

1. The repo is on GitHub at `https://github.com/AnkanMisra/ChainShield`.
2. You have a **funded** 0G testnet wallet — see the `Funding the 0G wallet` section in the README.
3. You have a **KeeperHub API key** (org-level, see https://app.keeperhub.com/settings/api-keys).
4. (Optional) Discord webhook URL for the notification channel.

You will paste those three secrets into the Render dashboard once. They never leave Render and are not committed to the repo.

---

## 1. Deploy the API on Render (≈ 6 min)

Render reads `render.yaml` at the repo root and provisions everything declaratively.

1. Open https://render.com and sign in with GitHub. **No credit card required for the free tier.**
2. Click **New +** → **Blueprint**.
3. Pick the `AnkanMisra/ChainShield` repo. Render reads `render.yaml`, shows you a single service named `chainshield-api`, and lists the env vars.
4. Three env vars are flagged as **needs value** (the `sync: false` ones in the Blueprint):
   - `ZERO_G_PRIVATE_KEY` — paste your funded Galileo testnet key
   - `KEEPERHUB_API_KEY` — paste your KeeperHub org key
   - `NOTIFY_DISCORD_WEBHOOK` — paste a Discord webhook URL, or leave blank to disable
5. Click **Apply**. Render builds the Docker image (≈ 3-4 min for the first build, ≈ 1 min on subsequent pushes via the Bun layer cache) and brings the service up.
6. Note the service URL — something like `https://chainshield-api.onrender.com`. This is your API base.
7. Health check: `curl https://chainshield-api.onrender.com/health` → `{"status":"ok"}`.

Auto-deploy is on by default — every push to `main` triggers a fresh build. Stop a deploy mid-flight from the dashboard if needed.

### What's happening behind the scenes

- Render clones the repo at `main`, reads `Dockerfile`, builds the multi-stage Bun + Alpine image.
- Boots the container with the env vars from the dashboard (the Blueprint ones plus the three secrets).
- Polls `/health` until it returns 200, then flips traffic to the new revision.
- The container listens on `0.0.0.0:8787`; Render's edge fronts it with TLS on port 443.
- The free Web Service tier sleeps after 15 min of zero traffic. The next request takes 30-50s while the container resumes. UptimeRobot (step 3) prevents this during demos.

---

## 2. Deploy the frontend on Cloudflare Pages (≈ 5 min)

1. Open https://dash.cloudflare.com and sign in. **No credit card required for Pages.**
2. **Workers & Pages** → **Create** → **Pages** tab → **Connect to Git**.
3. Authorize the GitHub app for the `AnkanMisra/ChainShield` repo.
4. **Setup builds and deployments**:
   - **Production branch:** `main`
   - **Framework preset:** Astro
   - **Root directory (advanced):** `web`  ← important — Cloudflare `cd`s here before the build runs
   - **Build command:** `bun install && bunx --bun astro build`
   - **Build output directory:** `dist`  ← relative to the root directory, i.e. `web/dist` from the repo root
5. Expand **Environment variables** → **Production** scope. Add **two**:
   - `PUBLIC_API_BASE` = the URL Render gave you, e.g. `https://chainshield-api.onrender.com`
   - `BUN_VERSION` = `1.3.13`  ← Bun is **not** preinstalled on Pages runners; this env var opts in to it and pins the patch
   Repeat both under the **Preview** scope so branch deploys also build with Bun.
6. **Save and Deploy**.

The first build takes ≈ 90 s. The `BUN_VERSION` env var is the trigger for Cloudflare's runner to install and use Bun (without it, the runner falls back to npm and Astro's `astro build` would run under Node 20, which is too old for Astro 6). The `bunx --bun` prefix on the build command additionally forces Astro onto Bun's runtime as a belt-and-braces guarantee.

After the build completes you get a URL like `https://chainshield.pages.dev`. **Open it. Click Quick demo. Click any preset on the Evaluate form.** You should see the working state, the elapsed timer, then the verdict + the lime `0G` anchor pill.

### Preview deploys

Every push to a non-`main` branch gets its own preview URL like `https://abc123.chainshield.pages.dev`. The Render API allows these because `WEB_ORIGIN` in `render.yaml` includes a regex that matches the full `*.chainshield.pages.dev` family.

---

## 3. Keep the API warm with cron-job.org (≈ 2 min, optional but recommended for demos)

Render's free tier sleeps after 15 min idle. A free cron-job.org ping every 14 min (just under the sleep threshold) keeps the container live during judging.

1. Sign up at https://cron-job.org (free, no card).
2. **Create cronjob**:
   - **Title:** `chainshield-api keepalive`
   - **URL:** `https://chainshield-api.onrender.com/health`
   - **Schedule:** Every 14 minutes (custom expression: `*/14 * * * *`)
   - **Notifications:** email on failure (optional)
3. Save.

Why 14 minutes specifically: it's just below Render's 15-min idle threshold so the service never sleeps, and Render's free tier gives 750 instance-hours/month which is enough for a single always-on Web Service (24h × 31d = 744h). More frequent pings don't help — once the container is up it stays up until the next idle window.

**UptimeRobot** is the equivalent fallback if you prefer their dashboard. Free tier: 50 monitors, 5-min minimum interval. Either works.

Render explicitly permits health-check pings from monitoring services. There's no TOS clause forbidding synthetic uptime monitoring — multiple Render-published guides describe this exact pattern.

---

## 4. Sanity test the live deploy

```sh
# 1. health
curl https://chainshield-api.onrender.com/health
# {"status":"ok"}

# 2. create a real anchored policy
curl -s -X POST https://chainshield-api.onrender.com/policies \
  -H 'Content-Type: application/json' \
  -d '{
    "owner": "0x1111111111111111111111111111111111111111",
    "rules": {
      "maxTransferEth": 1,
      "allowedDestinations": ["0x2222222222222222222222222222222222222222"],
      "forbiddenSelectors": ["0x095ea7b3"]
    }
  }' | python3 -m json.tool

# expect an `anchor` block in the response with rootHash + txHash
```

Open `https://chainshield.pages.dev` in a browser and run through the four canonical scenes. Click any anchor pill — it opens chainscan-galileo.0g.ai with the storage tx.

---

## Cost when you outgrow the free tier

| Tier | Cost | Adds |
|---|---|---|
| Render Starter | $7/mo | No sleep, 0.5 vCPU, dedicated workers |
| Render Standard | $25/mo | 2 GB RAM, 1 vCPU |
| Cloudflare Pages | (still free) | No upgrade needed unless you hit 500 builds/mo |

Cloudflare Pages stays free indefinitely for this project's traffic profile. The natural first paid step is `Render Starter` for $7/mo when you want the cold-start gone.

---

## Common gotchas

- **First request after 15 min idle is slow.** That's the Render free-tier sleep. Pre-warm with `curl https://chainshield-api.onrender.com/health` 60 s before judging starts. Or rely on the UptimeRobot pinger.
- **`anchor` field missing on a fresh policy create.** The Render container booted but the wallet isn't funded. Top up at https://faucet.0g.ai or https://cloud.google.com/application/web3/faucet/0g/galileo, then redeploy or wait for the next request — the in-memory cache holds prior policies.
- **CORS error in the browser console.** The Pages URL doesn't match `WEB_ORIGIN` on the API. Check the regex in `render.yaml` matches your Pages project's domain pattern, redeploy.
- **Dockerfile build fails with `frozen-lockfile` mismatch.** The committed `bun.lock` is out of sync with `package.json`. Run `bun install` locally, commit the regenerated lockfile, push.
- **Cloudflare Pages build fails on `bunx --bun`.** Cloudflare's runner detects Bun from `bun.lock`, but very old Pages projects sometimes default to Node. Re-create the project from scratch — preserves the URL and forces Bun detection.

---

## What this does NOT include

- Custom domain (CNAME `*.chainshield.pages.dev` to your domain via Cloudflare DNS — free, 5 min)
- HTTPS for the API on a custom domain (Render Pro tier $7/mo unlocks this; on free tier the `*.onrender.com` subdomain is the only option)
- Static analysis / RUM / metrics dashboards (out of scope for a hackathon)
- Multi-region failover (free tier is single-region only)

For a hackathon submission and a demo URL judges can click for the next 30 days, the setup above is enough.
