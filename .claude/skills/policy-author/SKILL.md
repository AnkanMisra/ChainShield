---
name: policy-author
description: Use when designing a new ChainShield Policy for a wallet, treasury, or protocol multisig. Walks through risk profile, rule selection, default values, and remediation hookup so the resulting policy enforces real protection without blocking routine ops.
---

# policy-author

A `Policy` is the contract between the user's intent and the risk gate. A bad policy either blocks legitimate work (loud, annoying, gets disabled) or allows the attack it was supposed to stop (silent, dangerous). This skill produces a policy that is right-sized for its owner.

## Inputs to gather first

1. Owner address (the wallet under protection).
2. Class of owner: hot wallet, treasury multisig, agent-operated wallet, contract treasury.
3. Typical outflow per day in ETH-equivalent terms.
4. Largest legitimate single transfer the owner ever needs to make.
5. List of known-good destinations (cold vault, payroll splitter, audited DEX router, bridge, custody address).
6. List of known-good interaction protocols (Aave, Lido, Uniswap routers, Compound, etc.) with their main entry-point addresses.
7. Whether the owner ever needs to sign infinite approvals (rarely yes; usually no).
8. Available remediation playbooks in KeeperHub (revoke-approvals, safe-vault-evac, pause-automation).
9. Active notification channels (Discord webhook, Telegram bot, email).

## Default values by owner class

### Hot operations wallet (low balance, frequent activity)

```json
{
  "rules": {
    "maxTransferEth": 0.5,
    "maxDailyOutflowEth": 2,
    "allowedDestinations": ["<known-good-1>", "<known-good-2>"],
    "forbiddenSelectors": ["0xa22cb465", "0xf2fde38b", "0x715018a6"]
  },
  "remediation": {
    "onBlock": ["revoke-all-approvals"],
    "notifyChannels": ["discord-ops"]
  }
}
```

Rationale: caps are tight relative to use; allowlist keeps daily ops smooth; admin-takeover selectors are blanket-forbidden.

### Treasury multisig (high balance, infrequent activity)

```json
{
  "rules": {
    "maxTransferEth": 50,
    "maxDailyOutflowEth": 100,
    "allowedDestinations": ["<cold-vault>", "<payroll-splitter>"],
    "forbiddenSelectors": ["0xa22cb465", "0xf2fde38b", "0x715018a6", "0x095ea7b3"],
    "approvalCapByToken": {
      "<usdc-address>": "1000000000000"
    }
  },
  "remediation": {
    "onBlock": ["safe-vault-evac", "revoke-all-approvals"],
    "notifyChannels": ["telegram-security", "discord-ops"]
  }
}
```

Rationale: per-tx cap reflects the largest legit operation; daily cap is 2x that to allow paired moves; raw `approve` is forbidden in favor of explicit per-token caps; remediation moves funds and revokes approvals on any block.

### Agent-operated wallet (autonomous, narrow purpose)

```json
{
  "rules": {
    "maxTransferEth": 0.1,
    "maxDailyOutflowEth": 1,
    "allowedDestinations": ["<single-target-protocol>"],
    "forbiddenSelectors": ["0xa22cb465", "0xf2fde38b", "0x715018a6", "0x095ea7b3"]
  },
  "remediation": {
    "onBlock": ["pause-automation", "safe-vault-evac"],
    "notifyChannels": ["discord-ops"]
  }
}
```

Rationale: the agent has one job; deviation from that job is suspicious and should pause the agent itself.

## Authoring procedure

1. Start from the matching default above.
2. Replace `maxTransferEth` with the answer to "largest legit single transfer". Round up by ~20% to avoid false positives.
3. Replace `maxDailyOutflowEth` with `2 * maxTransferEth` for treasuries, or actual measured throughput for hot wallets.
4. Fill `allowedDestinations` with the answers from inputs 5 and 6. Address-checksum is not required; the engine compares case-insensitively.
5. Always include the three admin-takeover selectors in `forbiddenSelectors`. Add `0x095ea7b3` (approve) only if you ALSO add an `approvalCapByToken` entry for any token the owner needs to interact with; otherwise the owner cannot grant any allowance at all.
6. Fill `remediation.onBlock` with playbook ids that already exist in KeeperHub. The engine attempts each in order until one succeeds.
7. Fill `remediation.notifyChannels` with channel keys registered in the running engine (`engineOptions.notificationChannels`). Unregistered keys are silently dropped.
8. Submit the policy via `POST /policies`. The response includes a UUID; reference it from `/evaluate` calls.

## Validation

Before deploying, run these check intents through `POST /evaluate`:

| Intent | Expected verdict |
|---|---|
| Safe transfer to allowlisted destination, value <= cap | ALLOW |
| Same call, value just above cap | BLOCK |
| Calldata starting with `0x095ea7b3` (approve) to a non-allowlisted token | BLOCK if approve is forbidden, else CONFIRM |
| Transfer to an unknown destination, value within cap | REQUIRE_HUMAN_CONFIRMATION |

If any check disagrees, fix the policy before going live.

## Common mistakes

- Setting `maxTransferEth = maxDailyOutflowEth`. The first legitimate tx exhausts the daily budget. Aim for at least 2x.
- Empty `allowedDestinations` "to be permissive". Empty disables the rule entirely; it does not allow everything subject to other rules. Be explicit.
- Forgetting `forbiddenSelectors`. The policy is only as strong as the rules that fire; admin-takeover selectors should never be on the path for routine ops.
- Putting playbook ids in `onBlock` that do not exist in KeeperHub. The engine logs the failure but the block still stands.
- Hardcoding addresses in lowercase from a checksummed source. The engine normalizes for you, but be consistent in the policy itself for diff readability.
