import { describe, expect, it } from "bun:test";
import { DecisionEngine } from "../src/core/engine.js";
import { InMemoryStore } from "../src/memory/memoryStore.js";
import { ATTACKER, COLD_VAULT, TOKEN, TREASURY, approveCalldata, makeIntent, makePolicy } from "./helpers.js";

function makeEngine(now = () => 1_700_000_000_000) {
  const store = new InMemoryStore();
  let counter = 0;
  const idGen = () => `decision-${++counter}`;
  const engine = new DecisionEngine({ store, now, idGen });
  return { engine, store };
}

describe("DecisionEngine — Phase 1 deterministic rules", () => {
  it("ALLOWs a tx that satisfies every rule", async () => {
    const { engine } = makeEngine();
    const policy = makePolicy({
      rules: { maxTransferEth: 1, allowedDestinations: [COLD_VAULT] },
    });
    const intent = makeIntent({ to: COLD_VAULT, value: "500000000000000000" });

    const decision = await engine.evaluate(intent, policy);

    expect(decision.verdict).toBe("ALLOW");
    expect(decision.rulesMatched).toEqual([]);
    expect(decision.riskScore).toBe(0);
  });

  it("BLOCKs a tx exceeding the per-tx ETH cap", async () => {
    const { engine } = makeEngine();
    const policy = makePolicy({ rules: { maxTransferEth: 1 } });
    const intent = makeIntent({ value: "2000000000000000000" });

    const decision = await engine.evaluate(intent, policy);

    expect(decision.verdict).toBe("BLOCK");
    expect(decision.rulesMatched).toContain("maxTransferEth");
    expect(decision.riskScore).toBeGreaterThanOrEqual(90);
  });

  it("requires confirmation for destinations outside the allowlist", async () => {
    const { engine } = makeEngine();
    const policy = makePolicy({
      rules: { allowedDestinations: [COLD_VAULT] },
    });
    const intent = makeIntent({ to: ATTACKER, value: "100000000000000000" });

    const decision = await engine.evaluate(intent, policy);

    expect(decision.verdict).toBe("REQUIRE_HUMAN_CONFIRMATION");
    expect(decision.rulesMatched).toContain("allowedDestinations");
  });

  it("BLOCKs a transaction matching a forbidden selector", async () => {
    const { engine } = makeEngine();
    const policy = makePolicy({ rules: { forbiddenSelectors: ["0x095ea7b3"] } });
    const intent = makeIntent({
      to: TOKEN,
      data: approveCalldata(ATTACKER, 2n ** 256n - 1n),
    });

    const decision = await engine.evaluate(intent, policy);

    expect(decision.verdict).toBe("BLOCK");
    expect(decision.rulesMatched).toContain("forbiddenSelectors");
  });

  it("BLOCKs an ERC-20 approval that exceeds approvalCapByToken", async () => {
    const { engine } = makeEngine();
    const cap = 1_000n * 10n ** 18n;
    const policy = makePolicy({
      rules: { approvalCapByToken: { [TOKEN.toLowerCase() as `0x${string}`]: cap.toString() } },
    });
    const intent = makeIntent({
      to: TOKEN,
      data: approveCalldata(ATTACKER, cap * 2n),
    });

    const decision = await engine.evaluate(intent, policy);

    expect(decision.verdict).toBe("BLOCK");
    expect(decision.rulesMatched).toContain("approvalCapByToken");
  });

  it("BLOCKs once cumulative daily outflow would exceed the cap", async () => {
    const { engine, store } = makeEngine();
    const policy = makePolicy({ rules: { maxDailyOutflowEth: 2 } });

    await store.appendDecision({
      id: "prior-1",
      intent: makeIntent({ value: "1500000000000000000" }),
      verdict: "ALLOW",
      riskScore: 0,
      rulesMatched: [],
      reasons: [],
      policyId: policy.id,
      timestamp: 1_700_000_000_000 - 60_000,
    });

    const intent = makeIntent({ value: "1000000000000000000" });
    const decision = await engine.evaluate(intent, policy);

    expect(decision.verdict).toBe("BLOCK");
    expect(decision.rulesMatched).toContain("maxDailyOutflowEth");
  });

  it("persists each decision so the timeline can be queried", async () => {
    const { engine, store } = makeEngine();
    const policy = makePolicy();
    await engine.evaluate(makeIntent({ value: "1" }), policy);
    await engine.evaluate(makeIntent({ value: "2" }), policy);

    const all = await store.listDecisions({});
    expect(all).toHaveLength(2);
  });
});
