import { describe, expect, it } from "bun:test";
import { DecisionEngine } from "../src/core/engine.js";
import { InMemoryStore } from "../src/memory/memoryStore.js";
import { MockRunner } from "../src/playbooks/runner.js";
import { CollectorChannel } from "../src/playbooks/notifier.js";
import { ATTACKER, COLD_VAULT, TOKEN, approveCalldata, makeIntent, makePolicy } from "./helpers.js";

function buildEngine(opts: {
  failPlaybookIds?: string[];
  channels?: Record<string, CollectorChannel>;
} = {}) {
  const store = new InMemoryStore();
  const runner = new MockRunner({ failPlaybookIds: opts.failPlaybookIds ?? [] });
  const channels = opts.channels ?? {};
  let counter = 0;
  const engine = new DecisionEngine({
    store,
    playbookRunner: runner,
    notificationChannels: channels,
    now: () => 1_700_000_000_000,
    idGen: () => `decision-${++counter}`,
  });
  return { engine, store, runner, channels };
}

describe("DecisionEngine — Phase 2 remediation", () => {
  it("triggers the first playbook in onBlock when verdict is BLOCK", async () => {
    const { engine, runner } = buildEngine();
    const policy = makePolicy({
      rules: { maxTransferEth: 1 },
      remediation: { onBlock: ["revoke-all", "safe-vault-evac"] },
    });
    const decision = await engine.evaluate(
      makeIntent({ value: "5000000000000000000" }),
      policy,
    );
    expect(decision.verdict).toBe("BLOCK");
    expect(decision.playbookTriggered).toEqual({ id: "revoke-all", runId: "mock-run-1" });
    expect(runner.invocations).toHaveLength(1);
    expect(runner.invocations[0]?.playbookId).toBe("revoke-all");
  });

  it("triggers remediation on the forbidden-selector short-circuit path", async () => {
    const discord = new CollectorChannel();
    const { engine, runner } = buildEngine({ channels: { discord } });
    const policy = makePolicy({
      rules: { forbiddenSelectors: ["0x095ea7b3"] },
      remediation: { onBlock: ["revoke-all"], notifyChannels: ["discord"] },
    });
    const decision = await engine.evaluate(
      makeIntent({
        to: TOKEN,
        data: approveCalldata(ATTACKER, 2n ** 256n - 1n),
      }),
      policy,
    );
    expect(decision.verdict).toBe("BLOCK");
    expect(decision.riskScore).toBe(95);
    expect(decision.rulesMatched).toEqual(["forbiddenSelectors"]);
    expect(decision.playbookTriggered).toEqual({ id: "revoke-all", runId: "mock-run-1" });
    expect(runner.invocations).toHaveLength(1);
    expect(discord.messages).toHaveLength(1);
    expect(discord.messages[0]?.verdict).toBe("BLOCK");
  });

  it("falls through to the next playbook when the first one throws", async () => {
    const { engine, runner } = buildEngine({ failPlaybookIds: ["revoke-all"] });
    const policy = makePolicy({
      rules: { maxTransferEth: 1 },
      remediation: { onBlock: ["revoke-all", "safe-vault-evac"] },
    });
    const decision = await engine.evaluate(
      makeIntent({ value: "5000000000000000000" }),
      policy,
    );
    expect(decision.playbookTriggered?.id).toBe("safe-vault-evac");
    expect(decision.reasons.some((r) => r.includes("Playbook revoke-all failed"))).toBe(true);
    expect(runner.invocations).toHaveLength(1);
    expect(runner.invocations[0]?.playbookId).toBe("safe-vault-evac");
  });

  it("does not trigger a playbook on ALLOW or REQUIRE_HUMAN_CONFIRMATION", async () => {
    const { engine, runner } = buildEngine();
    const allowPolicy = makePolicy({
      rules: { allowedDestinations: [COLD_VAULT] },
      remediation: { onBlock: ["revoke-all"] },
    });
    const allow = await engine.evaluate(
      makeIntent({ to: COLD_VAULT, value: "1" }),
      allowPolicy,
    );
    expect(allow.verdict).toBe("ALLOW");
    expect(allow.playbookTriggered).toBeUndefined();

    const confirm = await engine.evaluate(
      makeIntent({ to: ATTACKER, value: "1" }),
      allowPolicy,
    );
    expect(confirm.verdict).toBe("REQUIRE_HUMAN_CONFIRMATION");
    expect(confirm.playbookTriggered).toBeUndefined();
    expect(runner.invocations).toHaveLength(0);
  });

  it("dispatches notifications to every registered channel listed in the policy", async () => {
    const discord = new CollectorChannel();
    const telegram = new CollectorChannel();
    const { engine } = buildEngine({ channels: { discord, telegram } });
    const policy = makePolicy({
      rules: { maxTransferEth: 1 },
      remediation: { onBlock: ["revoke-all"], notifyChannels: ["discord", "telegram"] },
    });
    await engine.evaluate(makeIntent({ value: "5000000000000000000" }), policy);
    expect(discord.messages).toHaveLength(1);
    expect(telegram.messages).toHaveLength(1);
    expect(discord.messages[0]?.verdict).toBe("BLOCK");
  });

  it("ignores notification-channel names that are not registered", async () => {
    const discord = new CollectorChannel();
    const { engine } = buildEngine({ channels: { discord } });
    const policy = makePolicy({
      rules: { maxTransferEth: 1 },
      remediation: { onBlock: [], notifyChannels: ["discord", "missing-channel"] },
    });
    const decision = await engine.evaluate(
      makeIntent({ value: "5000000000000000000" }),
      policy,
    );
    expect(decision.verdict).toBe("BLOCK");
    expect(discord.messages).toHaveLength(1);
  });

  it("never persists a decision twice even if a playbook fails", async () => {
    const { engine, store } = buildEngine({ failPlaybookIds: ["a", "b"] });
    const policy = makePolicy({
      rules: { maxTransferEth: 1 },
      remediation: { onBlock: ["a", "b"] },
    });
    await engine.evaluate(makeIntent({ value: "5000000000000000000" }), policy);
    const recorded = await store.listDecisions({});
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.playbookTriggered).toBeUndefined();
  });

  it("truncates oversized runner errors when pushing them into reasons", async () => {
    const store = new InMemoryStore();
    const huge = "x".repeat(5000);
    let counter = 0;
    const failingRunner = {
      async run() {
        throw new Error(`giant ${huge}`);
      },
    };
    const engine = new DecisionEngine({
      store,
      playbookRunner: failingRunner,
      now: () => 1_700_000_000_000,
      idGen: () => `dec-${++counter}`,
    });
    const policy = makePolicy({
      rules: { maxTransferEth: 1 },
      remediation: { onBlock: ["pb"] },
    });
    const decision = await engine.evaluate(
      makeIntent({ value: "5000000000000000000" }),
      policy,
    );
    const failureReason = decision.reasons.find((r) => r.startsWith("Playbook pb failed"));
    expect(failureReason).toBeTruthy();
    expect(failureReason!.length).toBeLessThanOrEqual(280);
  });
});
