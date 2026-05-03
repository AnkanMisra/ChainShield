# ChainShield demo recording — step-by-step script

Target length: **3-4 minutes**. Recording tool: any screen recorder. Resolution: at least 1280x720.

## Pre-flight (do these before hitting record)

1. Fund the demo wallet at https://faucet.0g.ai (paste the address derived from `ZERO_G_PRIVATE_KEY`)
2. Confirm `.env.local` has both `KEEPERHUB_API_KEY` and a funded `ZERO_G_PRIVATE_KEY`
3. Reset the audit timeline: kill any running server (state lives in memory and on 0G; restarting clears the local cache so the demo starts clean)
4. Open two terminals side-by-side and a browser at `http://127.0.0.1:8787`
5. Set terminal font size big enough to be readable on 720p

## Recording (read each beat, hit it in 15-30 seconds)

### Beat 1: the problem (20s)

> "Hot wallets and treasury multisigs lose funds to two patterns: malicious approve-everything signatures, and over-cap transfers to addresses the owner never authorized. Existing wallets either approve everything or run opaque ML scoring. ChainShield gives the **owner** explicit, auditable rules and an autonomous remediation step when those rules are violated."

### Beat 2: spin it up (15s)

Terminal 1:
```sh
bun install
bun run dev
```

Show the server logs:
```
[chainshield] store: 0G anchor (rpc=https://evmrpc-testnet.0g.ai, indexer=https://indexer-storage-testnet-turbo.0g.ai)
[chainshield] playbook runner: KeeperHub @ https://app.keeperhub.com
[chainshield] simulator: heuristic (calldata decode + balance projection)
[chainshield] risk-gate listening on http://127.0.0.1:8787
```

> "The server boots with a 0G storage adapter, a KeeperHub remediation runner, and a heuristic ERC-20 simulator. All three are behind interfaces — swap any of them out without touching the engine."

### Beat 3: create a policy (30s)

Browser: click **Quick demo** in the Policies section. Show the policy card render with the rules summary and the **blue `0G | 0xroot…` pill**.

> "Quick demo creates a sample policy: 1 ETH per-tx cap, 3 ETH daily outflow cap, allowlist with one cold vault, and the ERC-20 approve selector on the forbidden list. The policy got JSON-serialized and uploaded to 0G Storage. That blue pill is the live merkle root anchored on the testnet."

Hover the pill to show the full rootHash and txHash in the tooltip.

### Beat 4: four scenes through the gate (90s)

Terminal 2:
```sh
bun run demo
```

The CLI walks through four scenarios and prints color-coded results:

```
Safe transfer to allowlisted vault (0.5 ETH)
  expect:    ALLOW
  verdict:   ALLOW  risk 0/100  [ok]

Over-cap transfer (5 ETH > 1 ETH per-tx cap)
  expect:    BLOCK
  verdict:   BLOCK  risk 90/100  [ok]
  rules:     maxTransferEth

Forbidden infinite approve(attacker, MAX_UINT256)
  expect:    BLOCK
  verdict:   BLOCK  risk 95/100  [ok]
  rules:     forbiddenSelectors

Off-allowlist destination (0.1 ETH to attacker)
  expect:    REQUIRE_HUMAN_CONFIRMATION
  verdict:   REQUIRE_HUMAN_CONFIRMATION  risk 60/100  [ok]
  rules:     allowedDestinations
```

> "Four canonical scenes, four expected verdicts, four matches. The verdict ladder is monotonic: rules only escalate."

### Beat 5: timeline + 0G anchors (20s)

Switch to the browser. Scroll to **Incident timeline**. Each row has its own blue `0G | 0xroot…` pill. Click "view JSON" on the most recent row.

> "Every decision was anchored on 0G Storage as a separate JSON object. Click any row to see the full record — verdict, risk score, matched rules, simulation result, the rootHash and txHash that prove this exact decision was committed to 0G."

### Beat 6: KeeperHub remediation (30s)

In the policy form, paste a real KeeperHub workflow id into "On block playbooks". Submit. Then re-run the over-cap scene from the Evaluate form.

Browser shows: `playbook fired: 8c12ujo1ax7b93w21updd (run <runId>)` as a green badge in the result.

> "When a verdict is BLOCK and the policy has remediation playbooks, ChainShield fires them automatically through KeeperHub. This is a real workflow execution against the live KeeperHub API. The run id and workflow id show up in the decision record alongside the 0G anchor."

### Beat 7: close (15s)

> "ChainShield is policy-bound, deterministic, simulated, anchored on 0G, and remediated through KeeperHub. The owner writes the rules. The agent enforces them."

## Filming tips

- **Don't talk over the screen recording.** Record audio separately or read from script while the screen is captured.
- **Keep cursor visible.** Use a cursor highlighter (macOS: enable "Shake mouse pointer to locate" in Accessibility, or use Cursor Pro).
- **Show real network calls.** The 0G testnet round-trip takes ~5-15 seconds. Either edit out the wait or narrate over it ("anchoring to 0G…").
- **Don't show secrets.** Make sure no `.env.local` window or terminal scrollback exposes the private key or KeeperHub API key.

## Post-production

- Export at 1080p if the screen recorder allows
- Trim dead air at start and end
- Add a 3-second title card with the project name and team handle
- Total upload < 100 MB (most submission portals cap at 100 MB)
