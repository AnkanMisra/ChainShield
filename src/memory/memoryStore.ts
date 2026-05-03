import type { Decision, Policy } from "../core/types.js";
import type { Store } from "./store.js";

interface TaggedPolicy {
  policy: Policy;
  clientId: string | null;
}

interface TaggedDecision {
  decision: Decision;
  clientId: string | null;
}

/**
 * In-memory `Store` with per-browser isolation. Every row is tagged with the
 * `clientId` that wrote it (null when the writer didn't supply one — typical
 * for the demo CLI / curl). Reads scope to the caller's clientId when one is
 * supplied; an `undefined` clientId returns everything (admin / debug).
 */
export class InMemoryStore implements Store {
  private policies = new Map<string, TaggedPolicy>();
  private decisions: TaggedDecision[] = [];

  async putPolicy(policy: Policy, clientId?: string): Promise<void> {
    this.policies.set(policy.id, { policy, clientId: clientId ?? null });
  }

  async getPolicy(id: string, clientId?: string): Promise<Policy | null> {
    const row = this.policies.get(id);
    if (!row) return null;
    if (clientId !== undefined && row.clientId !== clientId) return null;
    return row.policy;
  }

  async listPolicies(filter: {
    owner?: Policy["owner"];
    clientId?: string;
  } = {}): Promise<Policy[]> {
    const all = [...this.policies.values()];
    return all
      .filter((row) => {
        if (filter.clientId !== undefined && row.clientId !== filter.clientId) return false;
        if (filter.owner && row.policy.owner.toLowerCase() !== filter.owner.toLowerCase()) {
          return false;
        }
        return true;
      })
      .map((row) => row.policy);
  }

  async appendDecision(decision: Decision, clientId?: string): Promise<void> {
    this.decisions.push({ decision, clientId: clientId ?? null });
  }

  async listDecisions(filter: {
    owner?: Policy["owner"];
    from?: number;
    to?: number;
    clientId?: string;
  }): Promise<Decision[]> {
    return this.decisions
      .filter((row) => {
        if (filter.clientId !== undefined && row.clientId !== filter.clientId) return false;
        const d = row.decision;
        if (filter.from !== undefined && d.timestamp < filter.from) return false;
        if (filter.to !== undefined && d.timestamp > filter.to) return false;
        if (filter.owner && d.intent.from.toLowerCase() !== filter.owner.toLowerCase()) {
          return false;
        }
        return true;
      })
      .map((row) => row.decision);
  }
}
