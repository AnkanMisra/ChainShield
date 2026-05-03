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
  reasons: string[];
  playbookTriggered?: PlaybookRun;
  policyId: string;
  timestamp: number;
}

export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data: T;
}

export interface ZodIssue {
  path?: Array<string | number>;
  message?: string;
  code?: string;
}

export interface ValidationError {
  error: "ValidationError";
  issues: ZodIssue[];
}
