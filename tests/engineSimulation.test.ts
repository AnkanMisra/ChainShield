import { describe, expect, it } from "bun:test";
import { DecisionEngine } from "../src/core/engine.js";
import { InMemoryStore } from "../src/memory/memoryStore.js";
import { HeuristicSimulator } from "../src/simulator/heuristic.js";
import type { Simulator } from "../src/simulator/simulator.js";
import type { SimulationResult, TxIntent } from "../src/core/types.js";
import { ATTACKER, COLD_VAULT, TOKEN, approveCalldata, makeIntent, makePolicy } from "./helpers.js";

function buildEngine(simulator?: Simulator) {
  const store = new InMemoryStore();
  let counter = 0;
  return new DecisionEngine({
    store,
    simulator,
    now: () => 1_700_000_000_000,
    idGen: () => `decision-${++counter}`,
  });
}

class StaticSimulator implements Simulator {
  constructor(private readonly result: SimulationResult) {}
  async simulate(_intent: TxIntent): Promise<SimulationResult> {
    return this.result;
  }
}

class ThrowingSimulator implements Simulator {
  async simulate(_intent: TxIntent): Promise<SimulationResult> {
    throw new Error("network down: ECONNRESET");
  }
}

describe("DecisionEngine — simulator integration", () => {
  it("attaches the simulation field to the Decision when a simulator is configured", async () => {
    const engine = buildEngine(new HeuristicSimulator());
    const policy = makePolicy({ rules: { allowedDestinations: [COLD_VAULT] } });
    const decision = await engine.evaluate(
      makeIntent({ to: COLD_VAULT, value: "1000000000000000000" }),
      policy,
    );
    expect(decision.verdict).toBe("ALLOW");
    expect(decision.simulation).toBeDefined();
    expect(decision.simulation?.success).toBe(true);
    expect(decision.simulation?.balanceDeltas).toHaveLength(2);
  });

  it("does not attach a simulation field when no simulator is configured", async () => {
    const engine = buildEngine();
    const policy = makePolicy();
    const decision = await engine.evaluate(makeIntent({ value: "1" }), policy);
    expect(decision.simulation).toBeUndefined();
  });

  it("escalates ALLOW to REQUIRE_HUMAN_CONFIRMATION when simulation reverts", async () => {
    const engine = buildEngine(
      new StaticSimulator({
        success: false,
        revertReason: "ERC-20 transfer to zero address",
        balanceDeltas: [],
      }),
    );
    const policy = makePolicy({ rules: { allowedDestinations: [COLD_VAULT] } });
    const decision = await engine.evaluate(
      makeIntent({ to: COLD_VAULT, value: "1" }),
      policy,
    );
    expect(decision.verdict).toBe("REQUIRE_HUMAN_CONFIRMATION");
    expect(decision.riskScore).toBeGreaterThanOrEqual(70);
    expect(decision.rulesMatched).toContain("simulationRevert");
    expect(decision.reasons.some((r) => r.includes("zero address"))).toBe(true);
    expect(decision.simulation?.success).toBe(false);
  });

  it("does not downgrade a BLOCK verdict when simulation reverts", async () => {
    const engine = buildEngine(
      new StaticSimulator({
        success: false,
        revertReason: "would revert",
        balanceDeltas: [],
      }),
    );
    const policy = makePolicy({ rules: { maxTransferEth: 1 } });
    const decision = await engine.evaluate(
      makeIntent({ value: "5000000000000000000" }),
      policy,
    );
    expect(decision.verdict).toBe("BLOCK");
    expect(decision.riskScore).toBeGreaterThanOrEqual(90);
    expect(decision.rulesMatched).toContain("maxTransferEth");
    expect(decision.rulesMatched).toContain("simulationRevert");
  });

  it("treats a thrown simulator as a soft revert with safe error message", async () => {
    const engine = buildEngine(new ThrowingSimulator());
    const policy = makePolicy({ rules: { allowedDestinations: [COLD_VAULT] } });
    const decision = await engine.evaluate(
      makeIntent({ to: COLD_VAULT, value: "1" }),
      policy,
    );
    expect(decision.verdict).toBe("REQUIRE_HUMAN_CONFIRMATION");
    expect(decision.simulation?.success).toBe(false);
    expect(decision.simulation?.revertReason).toContain("simulator error");
    expect(decision.simulation?.revertReason).toContain("ECONNRESET");
  });

  it("skips the simulator entirely on the forbidden-selector short-circuit path", async () => {
    let calls = 0;
    const counterSim: Simulator = {
      async simulate() {
        calls++;
        return { success: true, balanceDeltas: [] };
      },
    };
    const engine = buildEngine(counterSim);
    const policy = makePolicy({
      rules: { forbiddenSelectors: ["0x095ea7b3"] },
    });
    const decision = await engine.evaluate(
      makeIntent({ to: TOKEN, data: approveCalldata(ATTACKER, 1n) }),
      policy,
    );
    expect(decision.verdict).toBe("BLOCK");
    expect(decision.rulesMatched).toEqual(["forbiddenSelectors"]);
    expect(decision.simulation).toBeUndefined();
    expect(calls).toBe(0);
  });

  it("integrates HeuristicSimulator end-to-end: approve to zero address escalates", async () => {
    const engine = buildEngine(new HeuristicSimulator());
    const policy = makePolicy({ rules: { allowedDestinations: [TOKEN] } });
    const zero = "0x0000000000000000000000000000000000000000";
    const decision = await engine.evaluate(
      makeIntent({ to: TOKEN, data: approveCalldata(zero as `0x${string}`, 1n) }),
      policy,
    );
    expect(decision.verdict).toBe("REQUIRE_HUMAN_CONFIRMATION");
    expect(decision.rulesMatched).toContain("simulationRevert");
  });
});
