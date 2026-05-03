export type Address = `0x${string}`;
export type Hex = `0x${string}`;

export type Verdict = "ALLOW" | "REQUIRE_HUMAN_CONFIRMATION" | "BLOCK";

export interface TxIntent {
  from: Address;
  to: Address;
  value: string;
  data: Hex;
  chainId: number;
  nonce?: number;
  gas?: string;
}

export interface PolicyRules {
  maxTransferEth?: number;
  maxDailyOutflowEth?: number;
  allowedDestinations?: Address[];
  forbiddenSelectors?: Hex[];
  maxSlippageBps?: number;
  approvalCapByToken?: Partial<Record<Address, string>>;
}

export interface PolicyRemediation {
  onBlock?: string[];
  onAnomaly?: string[];
  notifyChannels?: string[];
}

export interface Policy {
  id: string;
  owner: Address;
  rules: PolicyRules;
  remediation: PolicyRemediation;
  version: number;
  updatedAt: number;
}

export interface BalanceDelta {
  token: Address;
  account: Address;
  /** Signed decimal string of the wei (or token-unit) movement. Always parseable as `BigInt`. */
  delta: string;
}

export interface ApprovalDelta {
  token: Address;
  owner: Address;
  spender: Address;
  /** Decimal string of the approved amount. Parseable as `BigInt`. `MAX_UINT256` for infinite. */
  amount: string;
}

export interface SimulationResult {
  success: boolean;
  revertReason?: string;
  balanceDeltas: BalanceDelta[];
  approvals?: ApprovalDelta[];
  gasUsed?: string;
}

export interface LlmReasoning {
  text: string;
  teeVerified: boolean;
  chatId: string;
}

export interface PlaybookRun {
  id: string;
  runId: string;
}

export interface Decision {
  id: string;
  txHash?: Hex;
  intent: TxIntent;
  verdict: Verdict;
  riskScore: number;
  rulesMatched: string[];
  simulation?: SimulationResult;
  llmReasoning?: LlmReasoning;
  playbookTriggered?: PlaybookRun;
  reasons: string[];
  policyId: string;
  timestamp: number;
}
