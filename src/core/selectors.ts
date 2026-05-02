import type { Hex } from "./types.js";

export const ERC20_TRANSFER: Hex = "0xa9059cbb";
export const ERC20_APPROVE: Hex = "0x095ea7b3";
export const ERC20_TRANSFER_FROM: Hex = "0x23b872dd";

export function selectorOf(data: Hex): Hex | null {
  if (data.length < 10) return null;
  return data.slice(0, 10).toLowerCase() as Hex;
}

export function decodeAddress(data: Hex, paramIndex: number): Hex | null {
  const offset = 10 + paramIndex * 64;
  if (data.length < offset + 64) return null;
  const slot = data.slice(offset, offset + 64);
  return ("0x" + slot.slice(24)) as Hex;
}

export function decodeUint256(data: Hex, paramIndex: number): bigint | null {
  const offset = 10 + paramIndex * 64;
  if (data.length < offset + 64) return null;
  const slot = data.slice(offset, offset + 64);
  return BigInt("0x" + slot);
}
