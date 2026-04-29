import type { Decision, Policy } from "../core/types.js";

export interface Store {
  putPolicy(policy: Policy): Promise<void>;
  getPolicy(id: string): Promise<Policy | null>;
  listPolicies(owner?: Policy["owner"]): Promise<Policy[]>;
  appendDecision(decision: Decision): Promise<void>;
  listDecisions(filter: {
    owner?: Policy["owner"];
    from?: number;
    to?: number;
  }): Promise<Decision[]>;
}
