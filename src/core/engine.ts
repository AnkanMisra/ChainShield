import { randomUUID } from "node:crypto";
import type { Decision, Policy, TxIntent, Verdict } from "./types.js";
import { ERC20_APPROVE, decodeUint256, selectorOf } from "./selectors.js";
import type { Store } from "../memory/store.js";

const ETH_DECIMALS = 18n;
const WEI_PER_ETH = 10n ** ETH_DECIMALS;

function weiToEthFloat(wei: bigint): number {
  const whole = wei / WEI_PER_ETH;
  const frac = wei % WEI_PER_ETH;
  return Number(whole) + Number(frac) / Number(WEI_PER_ETH);
}

function ethToWei(eth: number): bigint {
  const [whole, frac = ""] = eth.toString().split(".");
  const padded = (frac + "0".repeat(18)).slice(0, 18);
  return BigInt(whole ?? "0") * WEI_PER_ETH + BigInt(padded || "0");
}

const DAY_MS = 24 * 60 * 60 * 1000;

export interface DecisionEngineOptions {
  store: Store;
  now?: () => number;
  idGen?: () => string;
}

export class DecisionEngine {
  private readonly store: Store;
  private readonly now: () => number;
  private readonly idGen: () => string;

  constructor(opts: DecisionEngineOptions) {
    this.store = opts.store;
    this.now = opts.now ?? (() => Date.now());
    this.idGen = opts.idGen ?? randomUUID;
  }

  async evaluate(intent: TxIntent, policy: Policy): Promise<Decision> {
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
    }

    const valueWei = BigInt(intent.value);
    if (policy.rules.maxTransferEth !== undefined) {
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

    if (policy.rules.maxDailyOutflowEth !== undefined) {
      const since = this.now() - DAY_MS;
      const recent = await this.store.listDecisions({
        owner: policy.owner,
        from: since,
      });
      const usedWei = recent
        .filter((d) => d.verdict !== "BLOCK")
        .reduce((sum, d) => sum + BigInt(d.intent.value), 0n);
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
      const cap = BigInt(
        policy.rules.approvalCapByToken[intent.to.toLowerCase() as `0x${string}`]!,
      );
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
    };

    await this.store.appendDecision(decision);
    return decision;
  }
}
