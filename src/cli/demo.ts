#!/usr/bin/env bun
/**
 * ChainShield demo CLI
 *
 * Drives the four canonical demo scenes against a running risk-gate server.
 *
 * Usage:
 *   bun run demo                                        # default localhost
 *   DEMO_API_BASE=http://127.0.0.1:8787 bun run demo
 *   DEMO_PLAYBOOK_ID=8c12ujo1ax7b93w21updd bun run demo # fire a real KeeperHub playbook on BLOCK
 *
 * Exit codes:
 *   0  every scene matched its expected verdict
 *   1  one or more scenes did not match (or the API was unreachable)
 */

import type { Decision, Policy, TxIntent } from "../core/types.js";

const API_BASE = (process.env.DEMO_API_BASE ?? "http://127.0.0.1:8787").replace(/\/+$/, "");
const PLAYBOOK_ID = process.env.DEMO_PLAYBOOK_ID ?? "";

const TREASURY = "0x1111111111111111111111111111111111111111" as const;
const COLD_VAULT = "0x2222222222222222222222222222222222222222" as const;
const ATTACKER = "0x3333333333333333333333333333333333333333" as const;
const TOKEN = "0x4444444444444444444444444444444444444444" as const;

const RESET = "[0m";
const DIM = "[2m";
const BOLD = "[1m";
const GREEN = "[32m";
const RED = "[31m";
const AMBER = "[33m";
const CYAN = "[36m";

function colorVerdict(v: Decision["verdict"]): string {
  if (v === "ALLOW") return `${GREEN}${v}${RESET}`;
  if (v === "BLOCK") return `${RED}${v}${RESET}`;
  return `${AMBER}${v}${RESET}`;
}

interface Scene {
  name: string;
  expect: Decision["verdict"];
  intent: TxIntent;
}

function approveCalldata(spender: string, amount: bigint): `0x${string}` {
  const spenderHex = spender.slice(2).toLowerCase().padStart(64, "0");
  const amountHex = amount.toString(16).padStart(64, "0");
  return `0x095ea7b3${spenderHex}${amountHex}` as `0x${string}`;
}

const scenes: Scene[] = [
  {
    name: "Safe transfer to allowlisted vault (0.5 ETH)",
    expect: "ALLOW",
    intent: {
      from: TREASURY,
      to: COLD_VAULT,
      value: "500000000000000000",
      data: "0x",
      chainId: 16602,
    },
  },
  {
    name: "Over-cap transfer (5 ETH > 1 ETH per-tx cap)",
    expect: "BLOCK",
    intent: {
      from: TREASURY,
      to: COLD_VAULT,
      value: "5000000000000000000",
      data: "0x",
      chainId: 16602,
    },
  },
  {
    name: "Forbidden infinite approve(attacker, MAX_UINT256)",
    expect: "BLOCK",
    intent: {
      from: TREASURY,
      to: TOKEN,
      value: "0",
      data: approveCalldata(ATTACKER, 2n ** 256n - 1n),
      chainId: 16602,
    },
  },
  {
    name: "Off-allowlist destination (0.1 ETH to attacker)",
    expect: "REQUIRE_HUMAN_CONFIRMATION",
    intent: {
      from: TREASURY,
      to: ATTACKER,
      value: "100000000000000000",
      data: "0x",
      chainId: 16602,
    },
  },
];

interface ApiResult<T> {
  ok: boolean;
  status: number;
  data: T;
}

async function apiCall<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResult<T>> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { ok: res.ok, status: res.status, data: data as T };
}

function rule(): string {
  return `${DIM}${"-".repeat(72)}${RESET}`;
}

function printHeader(): void {
  console.log("");
  console.log(`${BOLD}ChainShield demo CLI${RESET}`);
  console.log(rule());
  console.log(`api      ${CYAN}${API_BASE}${RESET}`);
  console.log(`playbook ${PLAYBOOK_ID || `${DIM}(none — set DEMO_PLAYBOOK_ID for KeeperHub remediation)${RESET}`}`);
  console.log(rule());
}

function printDecision(scene: Scene, d: Decision): { passed: boolean } {
  const passed = d.verdict === scene.expect;
  const mark = passed ? `${GREEN}ok${RESET}` : `${RED}MISMATCH${RESET}`;
  console.log("");
  console.log(`${BOLD}${scene.name}${RESET}`);
  console.log(`  expect:    ${colorVerdict(scene.expect)}`);
  console.log(`  verdict:   ${colorVerdict(d.verdict)}  risk ${d.riskScore}/100  [${mark}]`);
  if (d.rulesMatched.length > 0) {
    console.log(`  rules:     ${d.rulesMatched.join(", ")}`);
  }
  if (d.simulation) {
    if (d.simulation.success) {
      const summary = d.simulation.balanceDeltas.length === 0
        ? "no balance impact"
        : `${d.simulation.balanceDeltas.length} balance delta(s)`;
      console.log(`  simulation: ${GREEN}success${RESET} — ${summary}`);
    } else {
      console.log(`  simulation: ${RED}revert${RESET} — ${d.simulation.revertReason ?? "unknown"}`);
    }
  }
  if (d.playbookTriggered) {
    console.log(
      `  playbook:  ${GREEN}fired${RESET} — ${d.playbookTriggered.id} / run ${d.playbookTriggered.runId}`,
    );
  }
  for (const r of d.reasons) {
    console.log(`  ${DIM}-> ${r}${RESET}`);
  }
  return { passed };
}

async function main(): Promise<void> {
  printHeader();

  // 1. health check
  const health = await apiCall<{ status: string }>("GET", "/health").catch((err) => ({
    ok: false,
    status: 0,
    data: { status: String(err) },
  } as ApiResult<{ status: string }>));
  if (!health.ok) {
    console.error(`${RED}error:${RESET} risk-gate not reachable at ${API_BASE}/health (status ${health.status})`);
    console.error(`hint: start it with ${BOLD}bun run dev:server${RESET} or ${BOLD}bun run start${RESET}`);
    process.exit(1);
  }
  console.log(`health     ${GREEN}ok${RESET}`);

  // 2. create the demo policy
  const policyBody = {
    owner: TREASURY,
    rules: {
      maxTransferEth: 1,
      maxDailyOutflowEth: 3,
      allowedDestinations: [COLD_VAULT],
      forbiddenSelectors: ["0x095ea7b3"],
    },
    remediation: PLAYBOOK_ID
      ? { onBlock: [PLAYBOOK_ID], notifyChannels: ["collector"] }
      : { onBlock: [], notifyChannels: ["collector"] },
  };
  const policyRes = await apiCall<Policy>("POST", "/policies", policyBody);
  if (!policyRes.ok) {
    console.error(`${RED}policy create failed (${policyRes.status}):${RESET}`, policyRes.data);
    process.exit(1);
  }
  console.log(`policy     ${policyRes.data.id} (v${policyRes.data.version})`);

  // 3. run scenes in order
  let allPassed = true;
  for (const scene of scenes) {
    const evalRes = await apiCall<Decision>("POST", "/evaluate", {
      policyId: policyRes.data.id,
      intent: scene.intent,
    });
    if (!evalRes.ok) {
      console.error(`${RED}evaluate failed (${evalRes.status}):${RESET}`, evalRes.data);
      allPassed = false;
      continue;
    }
    const { passed } = printDecision(scene, evalRes.data);
    if (!passed) allPassed = false;
  }

  // 4. final summary
  console.log("");
  console.log(rule());
  const tlRes = await apiCall<Decision[]>("GET", "/timeline");
  if (tlRes.ok && Array.isArray(tlRes.data)) {
    console.log(`timeline   ${tlRes.data.length} decision(s) recorded`);
    let triggered = 0;
    for (const d of tlRes.data) if (d.playbookTriggered) triggered++;
    if (triggered > 0) console.log(`playbooks  ${triggered} fired`);
  }
  console.log(rule());

  if (allPassed) {
    console.log(`${GREEN}${BOLD}all scenes matched expected verdicts${RESET}`);
    process.exit(0);
  }
  console.log(`${RED}${BOLD}one or more scenes did not match${RESET}`);
  process.exit(1);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`${RED}fatal:${RESET} ${msg}`);
  process.exit(1);
});
