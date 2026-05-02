import type { Policy, TxIntent } from "../src/core/types.js";

export const TREASURY: `0x${string}` = "0x1111111111111111111111111111111111111111";
export const COLD_VAULT: `0x${string}` = "0x2222222222222222222222222222222222222222";
export const ATTACKER: `0x${string}` = "0x3333333333333333333333333333333333333333";
export const TOKEN: `0x${string}` = "0x4444444444444444444444444444444444444444";

export function makePolicy(overrides: Partial<Policy> = {}): Policy {
  return {
    id: "policy-1",
    owner: TREASURY,
    rules: {},
    remediation: {},
    version: 1,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

export function makeIntent(overrides: Partial<TxIntent> = {}): TxIntent {
  return {
    from: TREASURY,
    to: COLD_VAULT,
    value: "0",
    data: "0x",
    chainId: 16602,
    ...overrides,
  };
}

export function approveCalldata(spender: `0x${string}`, amount: bigint): `0x${string}` {
  const spenderHex = spender.slice(2).toLowerCase().padStart(64, "0");
  const amountHex = amount.toString(16).padStart(64, "0");
  return `0x095ea7b3${spenderHex}${amountHex}` as `0x${string}`;
}
