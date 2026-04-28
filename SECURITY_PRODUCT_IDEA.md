# ChainShield Agent

Autonomous treasury and wallet protection for onchain teams.

## One-Liner

`ChainShield Agent` is a policy-bound security agent that simulates, scores, and intercepts risky onchain actions before funds are lost, then auto-runs emergency playbooks when threats are detected.

## Why This Matters

### Problem

Most teams discover risk too late:

- suspicious approvals are signed without context
- abnormal transfers are only noticed after execution
- humans receive alerts but respond too slowly during active attacks

Existing tools are strong at monitoring, but many workflows still depend on manual intervention at the worst possible time.

### Our Opportunity

Build an always-on security agent that can:

1. evaluate intent before execution
2. enforce policy guardrails
3. trigger pre-approved incident response actions in seconds

## Product Vision

### What We Are Building

A programmable "security co-pilot" for wallets/treasuries that sits between planned execution and chain submission.

It answers 3 questions for every action:

- **Should this transaction be allowed?**
- **If risky, what immediate mitigation should happen?**
- **How do we prove to humans why that decision was taken?**

### Core User

- DAO treasury operators
- protocol multisig signers
- AI-agent treasury managers
- high-value wallets needing automated protection

## Core Features (MVP)

### 1) Policy Guardrail Engine

User defines policy rules such as:

- max transfer amount per tx/day
- allowlist of destination addresses and protocols
- forbidden function selectors
- max slippage
- unusual approval thresholds

### 2) Pre-Execution Risk Gate

Before execution, agent runs checks:

- transaction simulation
- recipient and contract risk checks
- deviation from normal behavior profile

Decision output:

- `ALLOW`
- `REQUIRE_HUMAN_CONFIRMATION`
- `BLOCK`

### 3) Auto-Remediation Playbooks

When a high-risk event is detected, agent can trigger pre-approved actions:

- revoke dangerous token approvals
- pause non-critical automation flows
- move part of treasury to a safe vault
- notify incident channels (Telegram/Discord/Webhook)

### 4) Explainable Security Timeline

A clear incident trail:

- detected signal
- policy violated
- action taken
- transaction hash/result

This is critical for trust, audits, and judge clarity.

## Sponsor-Aligned Architecture

### 0G

- **Storage**: persistent memory for policy state, risk events, incident history
- **Inference/Compute**: risk scoring and "second opinion" reflection step

### KeeperHub

- execution reliability for automated remediation actions
- retries, tx handling, and notifications

### Gensyn AXL (optional stretch)

- decentralized multi-agent security mesh:
  - watcher agent
  - critic agent
  - executor agent

## 72-Hour Build Plan

## Day 1 (Foundation)

- connect wallet/treasury profile
- create policy schema and policy editor
- build risk gate API (input tx intent -> policy decision)
- persist events in memory store

## Day 2 (Actionability)

- integrate tx simulation checks
- add threat scoring
- wire KeeperHub automation workflows for playbooks
- add notification integrations

## Day 3 (Demo Readiness)

- build incident timeline UI
- add explainability fields to every decision
- run attack simulations and record success metrics
- polish 3-5 minute live demo flow

## What Makes This Different

- not just "alerts"; this is **policy-enforced autonomous prevention**
- includes **automated response playbooks**, not only detection
- provides **human-readable forensic trace** for every action
- designed for **both human teams and AI-operated treasuries**

## Judge Demo Play (Story + Script)

Use this exact flow in your presentation.

### Demo Setup

- wallet with test funds
- policy enabled:
  - max transfer = 1 ETH
  - only allowlisted protocols
  - block approvals above set threshold

### Scene 1: Normal Operation (30-45s)

1. Submit a safe transfer intent under policy threshold.
2. Agent evaluates and marks `ALLOW`.
3. Transaction executes successfully.
4. Timeline logs "safe action approved."

**Judge takeaway:** system is usable in daily operations, not only emergencies.

### Scene 2: Risky Transaction Attempt (60-90s)

1. Submit suspicious transaction (high amount or unknown destination).
2. Agent simulation + policy checks run.
3. Decision becomes `BLOCK` with reason:
  - "Violates transfer cap"
  - "Destination not allowlisted"
4. Transaction is not sent onchain.

**Judge takeaway:** prevention happens before loss, not after.

### Scene 3: Incident Playbook Trigger (60-90s)

1. Trigger mock threat event (e.g., dangerous approval pattern).
2. Agent auto-runs remediation:
  - revoke approvals
  - pause automation
  - notify security channel
3. Show tx hashes and notification logs.

**Judge takeaway:** autonomous response under pressure.

### Scene 4: Explainability and Trust (45-60s)

1. Open incident timeline.
2. Show:
  - signal detected
  - rule matched
  - risk score
  - action executed
3. Show persistent memory survives restart.

**Judge takeaway:** transparent, auditable, production-minded agent behavior.

## 30-Second Pitch for Judges

"We built ChainShield Agent, an autonomous onchain security layer for wallets and treasuries. Instead of only alerting after danger appears, it simulates and evaluates every action against policy before execution, blocks risky transactions, and can auto-run emergency playbooks like approval revokes and treasury protection. Every decision is explainable in a forensic timeline, giving teams real-time prevention with audit-grade trust."

## Success Metrics to Show in Demo

- risky txs blocked before submission: `X/Y`
- mean detection-to-action time: `< N seconds`
- successful auto-remediation runs: `X`
- false-positive rate in scripted scenarios: `Y%`

## Stretch Goals (If Time Remains)

- multi-agent consensus mode (watcher + critic + executor)
- dynamic policy tuning from historical incidents
- iNFT security agent profile (portable guardrail personality)
- organization-level policy templates and risk tiers

