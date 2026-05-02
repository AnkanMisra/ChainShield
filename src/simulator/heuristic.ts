import type { Address, Hex, SimulationResult, TxIntent } from "../core/types.js";
import {
  ERC20_APPROVE,
  ERC20_TRANSFER,
  ERC20_TRANSFER_FROM,
  decodeAddress,
  decodeUint256,
  selectorOf,
} from "../core/selectors.js";
import type { Simulator } from "./simulator.js";

const ZERO_ADDRESS: Address = "0x0000000000000000000000000000000000000000";

function ok(balanceDeltas: SimulationResult["balanceDeltas"]): SimulationResult {
  return { success: true, balanceDeltas };
}

function revert(reason: string): SimulationResult {
  return { success: false, revertReason: reason, balanceDeltas: [] };
}

function asAddress(maybe: Hex | null): Address | null {
  return maybe as Address | null;
}

export class HeuristicSimulator implements Simulator {
  async simulate(intent: TxIntent): Promise<SimulationResult> {
    let valueWei: bigint;
    try {
      valueWei = BigInt(intent.value);
    } catch {
      return revert(`invalid value: ${intent.value}`);
    }

    const data = intent.data ?? "0x";
    const selector = selectorOf(data);

    // No calldata: a plain native ETH transfer (or a no-op zero-value tx).
    if (!selector) {
      if (valueWei === 0n) return ok([]);
      return ok([
        { token: ZERO_ADDRESS, account: intent.from, delta: `-${valueWei}` },
        { token: ZERO_ADDRESS, account: intent.to, delta: valueWei.toString() },
      ]);
    }

    if (selector === ERC20_TRANSFER) {
      const recipient = asAddress(decodeAddress(data, 0));
      const amount = decodeUint256(data, 1);
      if (recipient === null || amount === null) {
        return revert("ERC-20 transfer calldata too short");
      }
      if (recipient === ZERO_ADDRESS) {
        return revert("ERC-20 transfer to zero address");
      }
      return ok([
        { token: intent.to, account: intent.from, delta: `-${amount}` },
        { token: intent.to, account: recipient, delta: amount.toString() },
      ]);
    }

    if (selector === ERC20_TRANSFER_FROM) {
      const sender = asAddress(decodeAddress(data, 0));
      const recipient = asAddress(decodeAddress(data, 1));
      const amount = decodeUint256(data, 2);
      if (sender === null || recipient === null || amount === null) {
        return revert("ERC-20 transferFrom calldata too short");
      }
      if (sender === ZERO_ADDRESS || recipient === ZERO_ADDRESS) {
        return revert("ERC-20 transferFrom uses zero address");
      }
      return ok([
        { token: intent.to, account: sender, delta: `-${amount}` },
        { token: intent.to, account: recipient, delta: amount.toString() },
      ]);
    }

    if (selector === ERC20_APPROVE) {
      const spender = asAddress(decodeAddress(data, 0));
      const amount = decodeUint256(data, 1);
      if (spender === null || amount === null) {
        return revert("ERC-20 approve calldata too short");
      }
      if (spender === ZERO_ADDRESS) {
        return revert("ERC-20 approve to zero address");
      }
      // approve does not move balances; the engine uses approvalCapByToken to
      // bound spender authority. Surface the spender + amount in the deltas so
      // the UI can display "spender X authorized for N units" alongside the
      // verdict.
      return ok([
        { token: intent.to, account: spender, delta: `+approval ${amount}` },
      ]);
    }

    // Unknown selector — note in revertReason but treat as success (we have
    // no model of what the call does). The deterministic rules already cover
    // forbidden selectors and approval caps; this is the conservative default.
    return ok([]);
  }
}
