---
name: selector-decode
description: Use when you encounter an EVM 4-byte function selector (0x followed by 8 hex chars at the start of calldata) and need to identify which function it represents, or when authoring a forbiddenSelectors policy rule. Provides a curated table of common selectors and a decoding workflow for unknown ones.
---

# selector-decode

A 4-byte selector is the first 4 bytes of EVM calldata. It is `keccak256(canonicalSignature)[0:4]` where `canonicalSignature` is the function name plus its parameter type list, with no spaces, e.g. `transfer(address,uint256)`.

## Curated table (most common in DeFi)

### ERC-20

| Selector | Signature | Risk profile |
|---|---|---|
| `0xa9059cbb` | `transfer(address,uint256)` | Direct outflow. Cap by destination + amount. |
| `0x095ea7b3` | `approve(address,uint256)` | Authorization to drain. Block infinite approvals; cap by spender + amount. |
| `0x23b872dd` | `transferFrom(address,address,uint256)` | Pull payment. Often invoked by routers/protocols on behalf of the user. |
| `0x39509351` | `increaseAllowance(address,uint256)` | Quietly raises an existing approval. Treat like `approve`. |
| `0xa457c2d7` | `decreaseAllowance(address,uint256)` | Safe to allow; reduces exposure. |
| `0x70a08231` | `balanceOf(address)` | View only; no policy concern. |

### ERC-721 / ERC-1155

| Selector | Signature | Risk profile |
|---|---|---|
| `0x42842e0e` | `safeTransferFrom(address,address,uint256)` | NFT outflow. |
| `0x23b872dd` | `transferFrom(address,address,uint256)` | NFT outflow (overlap with ERC-20). |
| `0xa22cb465` | `setApprovalForAll(address,bool)` | Critical. Grants spender control over ALL NFTs in the collection. Block by default. |
| `0x095ea7b3` | `approve(address,uint256)` | Per-token approval (uint256 = tokenId). |

### Pausable / Ownable / Access control

| Selector | Signature | Risk profile |
|---|---|---|
| `0x8456cb59` | `pause()` | Pause contract. Often a remediation primitive. |
| `0x3f4ba83a` | `unpause()` | Resume. |
| `0xf2fde38b` | `transferOwnership(address)` | Hand over admin. Block unless explicitly allowlisted. |
| `0x715018a6` | `renounceOwnership()` | Brick contract. Block unless intentional. |

### DEX routing (Uniswap V2/V3 representative)

| Selector | Signature | Notes |
|---|---|---|
| `0x38ed1739` | `swapExactTokensForTokens(uint256,uint256,address[],address,uint256)` | V2-style swap with deadline + min-out. |
| `0x414bf389` | `exactInputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160))` | V3 single-hop swap. |
| `0xc04b8d59` | `exactInput((bytes,address,uint256,uint256,uint256))` | V3 multi-hop. |
| `0xfb3bdb41` | `swapETHForExactTokens(uint256,address[],address,uint256)` | ETH in, exact tokens out. |

## Workflow when you see an unknown selector

1. Read the selector from `intent.data` slice `[0:10]` (the `0x` plus 8 hex chars).
2. Search 4byte.directory: `https://www.4byte.directory/signatures/?bytes4_signature=0x...`. Multiple signatures collide on the same 4 bytes occasionally; pick the one consistent with the destination contract.
3. Cross-check with the destination contract's verified ABI on the relevant block explorer (Etherscan, Basescan, Chainscan-Galileo).
4. If still ambiguous and the call is high-value, recommend `REQUIRE_HUMAN_CONFIRMATION` rather than `ALLOW`.

## When authoring a `forbiddenSelectors` rule

Treat these as default-block for any treasury policy:

- `setApprovalForAll(address,bool)` (`0xa22cb465`)
- `transferOwnership(address)` (`0xf2fde38b`)
- `renounceOwnership()` (`0x715018a6`)

Treat these as block-with-cap (use `approvalCapByToken` instead of a flat ban):

- `approve(address,uint256)` (`0x095ea7b3`)
- `increaseAllowance(address,uint256)` (`0x39509351`)

## Checking in code

`src/core/selectors.ts` exposes:

- `selectorOf(data)` returns the lowercase 10-char selector or `null` if calldata is too short.
- `decodeAddress(data, paramIndex)` reads the `paramIndex`-th 32-byte word and returns the trailing 20 bytes as a hex address.
- `decodeUint256(data, paramIndex)` returns the `paramIndex`-th 32-byte word as a `bigint`.

When extending these helpers, keep them dependency-free (no ethers ABI coder) so the engine stays cheap to run.
