import type { Decision, Policy } from "../core/types.js";
import type { Store } from "./store.js";

export class InMemoryStore implements Store {
  private policies = new Map<string, Policy>();
  private decisions: Decision[] = [];

  async putPolicy(policy: Policy): Promise<void> {
    this.policies.set(policy.id, policy);
  }

  async getPolicy(id: string): Promise<Policy | null> {
    return this.policies.get(id) ?? null;
  }

  async listPolicies(owner?: Policy["owner"]): Promise<Policy[]> {
    const all = [...this.policies.values()];
    return owner ? all.filter((p) => p.owner.toLowerCase() === owner.toLowerCase()) : all;
  }

  async appendDecision(decision: Decision): Promise<void> {
    this.decisions.push(decision);
  }

  async listDecisions(filter: {
    owner?: Policy["owner"];
    from?: number;
    to?: number;
  }): Promise<Decision[]> {
    return this.decisions.filter((d) => {
      if (filter.from !== undefined && d.timestamp < filter.from) return false;
      if (filter.to !== undefined && d.timestamp > filter.to) return false;
      if (filter.owner && d.intent.from.toLowerCase() !== filter.owner.toLowerCase()) {
        return false;
      }
      return true;
    });
  }
}
