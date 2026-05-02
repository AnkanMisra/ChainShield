import { describe, expect, it } from "bun:test";
import { NoopSimulator } from "../src/simulator/simulator.js";
import { HeuristicSimulator } from "../src/simulator/heuristic.js";
import { ATTACKER, COLD_VAULT, TOKEN, TREASURY, approveCalldata, makeIntent } from "./helpers.js";
import type { Hex } from "../src/core/types.js";

const ZERO: Hex = "0x0000000000000000000000000000000000000000";

function transferCalldata(to: string, amount: bigint): Hex {
  const toHex = to.slice(2).toLowerCase().padStart(64, "0");
  const amountHex = amount.toString(16).padStart(64, "0");
  return `0xa9059cbb${toHex}${amountHex}` as Hex;
}

function transferFromCalldata(from: string, to: string, amount: bigint): Hex {
  const fromHex = from.slice(2).toLowerCase().padStart(64, "0");
  const toHex = to.slice(2).toLowerCase().padStart(64, "0");
  const amountHex = amount.toString(16).padStart(64, "0");
  return `0x23b872dd${fromHex}${toHex}${amountHex}` as Hex;
}

describe("NoopSimulator", () => {
  it("always returns success with empty deltas", async () => {
    const sim = new NoopSimulator();
    const result = await sim.simulate(makeIntent({ value: "1000000000000000000" }));
    expect(result.success).toBe(true);
    expect(result.balanceDeltas).toEqual([]);
    expect(result.revertReason).toBeUndefined();
  });
});

describe("HeuristicSimulator", () => {
  const sim = new HeuristicSimulator();

  describe("native ETH", () => {
    it("emits two balance deltas for a non-zero ETH transfer", async () => {
      const intent = makeIntent({ to: COLD_VAULT, value: "500000000000000000" });
      const result = await sim.simulate(intent);
      expect(result.success).toBe(true);
      expect(result.balanceDeltas).toHaveLength(2);
      expect(result.balanceDeltas[0]).toEqual({
        token: ZERO,
        account: TREASURY,
        delta: "-500000000000000000",
      });
      expect(result.balanceDeltas[1]).toEqual({
        token: ZERO,
        account: COLD_VAULT,
        delta: "500000000000000000",
      });
    });

    it("emits no deltas for a zero-value, zero-data tx", async () => {
      const intent = makeIntent({ value: "0", data: "0x" });
      const result = await sim.simulate(intent);
      expect(result.success).toBe(true);
      expect(result.balanceDeltas).toEqual([]);
    });

    it("reverts on a non-numeric value string", async () => {
      const intent = makeIntent({ value: "not-a-number", data: "0x" });
      const result = await sim.simulate(intent);
      expect(result.success).toBe(false);
      expect(result.revertReason).toContain("invalid value");
    });
  });

  describe("ERC-20 transfer", () => {
    it("decodes recipient and amount, emits two deltas", async () => {
      const amount = 42n * 10n ** 18n;
      const intent = makeIntent({
        from: TREASURY,
        to: TOKEN,
        value: "0",
        data: transferCalldata(COLD_VAULT, amount),
      });
      const result = await sim.simulate(intent);
      expect(result.success).toBe(true);
      expect(result.balanceDeltas).toHaveLength(2);
      expect(result.balanceDeltas[0]?.account).toBe(TREASURY);
      expect(result.balanceDeltas[0]?.delta).toBe(`-${amount}`);
      expect(result.balanceDeltas[1]?.account.toLowerCase()).toBe(COLD_VAULT.toLowerCase());
      expect(result.balanceDeltas[1]?.delta).toBe(amount.toString());
      expect(result.balanceDeltas.every((d) => d.token === TOKEN)).toBe(true);
    });

    it("reverts on transfer to zero address", async () => {
      const intent = makeIntent({
        to: TOKEN,
        data: transferCalldata(ZERO, 1n),
      });
      const result = await sim.simulate(intent);
      expect(result.success).toBe(false);
      expect(result.revertReason).toContain("zero address");
    });

    it("reverts on truncated transfer calldata", async () => {
      const intent = makeIntent({
        to: TOKEN,
        data: "0xa9059cbb" as Hex,
      });
      const result = await sim.simulate(intent);
      expect(result.success).toBe(false);
      expect(result.revertReason).toContain("calldata too short");
    });
  });

  describe("ERC-20 transferFrom", () => {
    it("decodes sender, recipient, amount", async () => {
      const amount = 1n;
      const intent = makeIntent({
        to: TOKEN,
        data: transferFromCalldata(TREASURY, COLD_VAULT, amount),
      });
      const result = await sim.simulate(intent);
      expect(result.success).toBe(true);
      expect(result.balanceDeltas).toHaveLength(2);
      expect(result.balanceDeltas[0]?.account.toLowerCase()).toBe(TREASURY.toLowerCase());
      expect(result.balanceDeltas[0]?.delta).toBe("-1");
      expect(result.balanceDeltas[1]?.account.toLowerCase()).toBe(COLD_VAULT.toLowerCase());
      expect(result.balanceDeltas[1]?.delta).toBe("1");
    });

    it("reverts when sender is zero address", async () => {
      const intent = makeIntent({
        to: TOKEN,
        data: transferFromCalldata(ZERO, COLD_VAULT, 1n),
      });
      const result = await sim.simulate(intent);
      expect(result.success).toBe(false);
      expect(result.revertReason).toContain("zero address");
    });

    it("reverts on truncated transferFrom calldata", async () => {
      const intent = makeIntent({ to: TOKEN, data: "0x23b872dd" as Hex });
      const result = await sim.simulate(intent);
      expect(result.success).toBe(false);
      expect(result.revertReason).toContain("calldata too short");
    });
  });

  describe("ERC-20 approve", () => {
    it("emits an approval-style delta and never a balance move", async () => {
      const amount = 2n ** 256n - 1n;
      const intent = makeIntent({
        to: TOKEN,
        data: approveCalldata(ATTACKER, amount),
      });
      const result = await sim.simulate(intent);
      expect(result.success).toBe(true);
      expect(result.balanceDeltas).toHaveLength(1);
      expect(result.balanceDeltas[0]?.account.toLowerCase()).toBe(ATTACKER.toLowerCase());
      expect(result.balanceDeltas[0]?.delta).toContain("approval");
      expect(result.balanceDeltas[0]?.delta).toContain(amount.toString());
    });

    it("reverts on approve to zero address", async () => {
      const intent = makeIntent({
        to: TOKEN,
        data: approveCalldata(ZERO, 1n),
      });
      const result = await sim.simulate(intent);
      expect(result.success).toBe(false);
      expect(result.revertReason).toContain("zero address");
    });

    it("reverts on truncated approve calldata", async () => {
      const intent = makeIntent({ to: TOKEN, data: "0x095ea7b3" as Hex });
      const result = await sim.simulate(intent);
      expect(result.success).toBe(false);
      expect(result.revertReason).toContain("calldata too short");
    });
  });

  describe("unknown selector", () => {
    it("returns success with empty deltas and no revert reason", async () => {
      const intent = makeIntent({
        to: TOKEN,
        data: "0xdeadbeef00000000000000000000000000000000000000000000000000000000" as Hex,
      });
      const result = await sim.simulate(intent);
      expect(result.success).toBe(true);
      expect(result.balanceDeltas).toEqual([]);
      expect(result.revertReason).toBeUndefined();
    });
  });
});
