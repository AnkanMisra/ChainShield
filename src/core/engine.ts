import { randomUUID } from "node:crypto";
import type { Decision, Policy, SimulationResult, TxIntent, Verdict } from "./types.js";
import { ERC20_APPROVE, decodeUint256, selectorOf } from "./selectors.js";
import type { Store } from "../memory/store.js";
import type { NotificationChannel, PlaybookRunner } from "../playbooks/runner.js";
import type { Simulator } from "../simulator/simulator.js";
import type { GossipTransport } from "../transport/axlGossip.js";

const ETH_DECIMALS = 18n;
const WEI_PER_ETH = 10n ** ETH_DECIMALS;

function weiToEthFloat(wei: bigint): number {
  const whole = wei / WEI_PER_ETH;
  const frac = wei % WEI_PER_ETH;
  return Number(whole) + Number(frac) / Number(WEI_PER_ETH);
}

function decimalStringOf(value: number): string {
  const str = value.toString();
  if (!str.toLowerCase().includes("e")) return str;

  const [mantissa = "0", exponentPart = "0"] = str.toLowerCase().split("e");
  const exponent = Number(exponentPart);
  const digits = mantissa.replace(".", "");
  const decimalPlaces = mantissa.includes(".") ? mantissa.length - mantissa.indexOf(".") - 1 : 0;
  const decimalIndex = digits.length - decimalPlaces + exponent;

  if (decimalIndex <= 0) return `0.${"0".repeat(Math.abs(decimalIndex))}${digits}`;
  if (decimalIndex >= digits.length) return `${digits}${"0".repeat(decimalIndex - digits.length)}`;
  return `${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`;
}

function ethToWei(eth: number): bigint {
  const [whole, frac = ""] = decimalStringOf(eth).split(".");
  const padded = (frac + "0".repeat(18)).slice(0, 18);
  return BigInt(whole ?? "0") * WEI_PER_ETH + BigInt(padded || "0");
}

function tryBigInt(s: string | undefined | null): bigint | null {
  if (s === undefined || s === null || s === "") return null;
  try {
    return BigInt(s);
  } catch {
    return null;
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

export interface DecisionEngineOptions {
  store: Store;
  simulator?: Simulator;
  playbookRunner?: PlaybookRunner;
  notificationChannels?: Record<string, NotificationChannel>;
  gossip?: GossipTransport;
  now?: () => number;
  idGen?: () => string;
}

export class DecisionEngine {
  private readonly store: Store;
  private readonly simulator: Simulator | undefined;
  private readonly runner: PlaybookRunner | undefined;
  private readonly channels: Record<string, NotificationChannel>;
  private readonly gossip: GossipTransport | undefined;
  private readonly now: () => number;
  private readonly idGen: () => string;

  constructor(opts: DecisionEngineOptions) {
    this.store = opts.store;
    this.simulator = opts.simulator;
    this.runner = opts.playbookRunner;
    this.channels = opts.notificationChannels ?? {};
    this.gossip = opts.gossip;
    this.now = opts.now ?? (() => Date.now());
    this.idGen = opts.idGen ?? randomUUID;
  }

  async evaluate(intent: TxIntent, policy: Policy, clientId?: string): Promise<Decision> {
    const reasons: string[] = [];
    const rulesMatched: string[] = [];
    let verdict: Verdict = "ALLOW";
    let riskScore = 0;

    const selector = selectorOf(intent.data);
    const forbiddenSelectors = (policy.rules.forbiddenSelectors ?? []).map((s) =>
      s.toLowerCase(),
    );
    if (selector && forbiddenSelectors.includes(selector.toLowerCase())) {
      verdict = "BLOCK";
      riskScore = Math.max(riskScore, 95);
      rulesMatched.push("forbiddenSelectors");
      reasons.push(`Selector ${selector} is on the forbidden list.`);

      const earlyDecision: Decision = {
        id: this.idGen(),
        intent,
        verdict,
        riskScore,
        rulesMatched,
        reasons,
        policyId: policy.id,
        timestamp: this.now(),
      };
      await this.handleRemediation(earlyDecision, policy);
      return this.persist(earlyDecision, clientId);
    }

    const valueWei = tryBigInt(intent.value);
    if (valueWei === null) {
      verdict = "REQUIRE_HUMAN_CONFIRMATION";
      riskScore = Math.max(riskScore, 70);
      rulesMatched.push("invalidIntentValue");
      reasons.push(`Intent value "${intent.value}" is not a decimal wei string.`);
    } else if (policy.rules.maxTransferEth !== undefined) {
      const cap = ethToWei(policy.rules.maxTransferEth);
      if (valueWei > cap) {
        verdict = "BLOCK";
        riskScore = Math.max(riskScore, 90);
        rulesMatched.push("maxTransferEth");
        reasons.push(
          `Transfer of ${weiToEthFloat(valueWei)} ETH exceeds per-tx cap of ${policy.rules.maxTransferEth} ETH.`,
        );
      }
    }

    if (policy.rules.maxDailyOutflowEth !== undefined && valueWei !== null) {
      const since = this.now() - DAY_MS;
      const recent = await this.store.listDecisions({
        owner: policy.owner,
        from: since,
        ...(clientId !== undefined && { clientId }),
      });
      const usedWei = recent
        .filter((d) => d.verdict !== "BLOCK")
        .reduce((sum, d) => {
          const v = tryBigInt(d.intent.value);
          // Skip corrupt historical entries silently — a single bad row in the
          // timeline must not break new evaluations.
          return v === null ? sum : sum + v;
        }, 0n);
      const projected = usedWei + valueWei;
      const cap = ethToWei(policy.rules.maxDailyOutflowEth);
      if (projected > cap) {
        verdict = "BLOCK";
        riskScore = Math.max(riskScore, 88);
        rulesMatched.push("maxDailyOutflowEth");
        reasons.push(
          `Projected 24h outflow ${weiToEthFloat(projected)} ETH exceeds cap of ${policy.rules.maxDailyOutflowEth} ETH.`,
        );
      }
    }

    if (policy.rules.allowedDestinations && policy.rules.allowedDestinations.length > 0) {
      const allow = policy.rules.allowedDestinations.map((a) => a.toLowerCase());
      if (!allow.includes(intent.to.toLowerCase())) {
        if (verdict === "ALLOW") verdict = "REQUIRE_HUMAN_CONFIRMATION";
        riskScore = Math.max(riskScore, 60);
        rulesMatched.push("allowedDestinations");
        reasons.push(`Destination ${intent.to} is not on the allowlist.`);
      }
    }

    if (
      selector === ERC20_APPROVE &&
      policy.rules.approvalCapByToken &&
      policy.rules.approvalCapByToken[intent.to.toLowerCase() as `0x${string}`] !== undefined
    ) {
      const rawCap = policy.rules.approvalCapByToken[intent.to.toLowerCase() as `0x${string}`]!;
      const cap = tryBigInt(rawCap);
      if (cap === null) {
        if (verdict === "ALLOW") verdict = "REQUIRE_HUMAN_CONFIRMATION";
        riskScore = Math.max(riskScore, 70);
        rulesMatched.push("invalidApprovalCap");
        reasons.push(`Approval cap "${rawCap}" on token ${intent.to} is not a decimal wei string.`);
      } else {
        const amount = decodeUint256(intent.data, 1);
        if (amount !== null && amount > cap) {
          verdict = "BLOCK";
          riskScore = Math.max(riskScore, 92);
          rulesMatched.push("approvalCapByToken");
          reasons.push(
            `Approval amount ${amount} on token ${intent.to} exceeds cap of ${cap}.`,
          );
        }
      }
    }

    const simulation = await this.runSimulator(intent);
    if (simulation && !simulation.success) {
      if (verdict === "ALLOW") verdict = "REQUIRE_HUMAN_CONFIRMATION";
      riskScore = Math.max(riskScore, 70);
      rulesMatched.push("simulationRevert");
      reasons.push(`Simulation reverted: ${simulation.revertReason ?? "unknown"}.`);
    }

    if (verdict === "ALLOW" && reasons.length === 0) {
      reasons.push("All policy rules satisfied.");
    }

    const decision: Decision = {
      id: this.idGen(),
      intent,
      verdict,
      riskScore,
      rulesMatched,
      reasons,
      policyId: policy.id,
      timestamp: this.now(),
      ...(simulation ? { simulation } : {}),
    };

    if (decision.verdict === "BLOCK") {
      await this.handleRemediation(decision, policy);
    }

    return this.persist(decision, clientId);
  }

  private async runSimulator(intent: TxIntent): Promise<SimulationResult | undefined> {
    if (!this.simulator) return undefined;
    try {
      return await this.simulator.simulate(intent);
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      const safe = raw.replace(/\s+/g, " ").trim().slice(0, 256);
      return {
        success: false,
        revertReason: `simulator error: ${safe}`,
        balanceDeltas: [],
      };
    }
  }

  private async persist(decision: Decision, clientId?: string): Promise<Decision> {
    await this.store.appendDecision(decision, clientId);
    return decision;
  }

  private async handleRemediation(decision: Decision, policy: Policy): Promise<void> {
    const playbookIds = policy.remediation.onBlock ?? [];
    if (this.runner && playbookIds.length > 0) {
      for (const id of playbookIds) {
        try {
          decision.playbookTriggered = await this.runner.run(id, decision, policy);
          break;
        } catch (err) {
          const raw = err instanceof Error ? err.message : String(err);
          const safe = raw.replace(/\s+/g, " ").trim().slice(0, 256);
          decision.reasons.push(`Playbook ${id} failed: ${safe}`);
        }
      }
    }

    const channelNames = policy.remediation.notifyChannels ?? [];
    for (const name of channelNames) {
      const channel = this.channels[name];
      if (!channel) continue;
      try {
        await channel.notify(
          `BLOCK on policy ${policy.id}: ${decision.reasons.join(" ")}`,
          decision,
        );
      } catch {
        // notification failures are not allowed to affect the verdict or persistence
      }
    }

    if (this.gossip) {
      // GossipTransport implementations are required to never throw - they
      // log internally on failure. The broadcast is awaited so blocked
      // decisions reach co-operating gates before the response returns.
      await this.gossip.broadcast(decision, policy);
    }
  }
}
