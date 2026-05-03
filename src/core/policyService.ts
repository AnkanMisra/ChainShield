import { randomUUID } from "node:crypto";
import type { Policy } from "./types.js";
import type { Store } from "../memory/store.js";
import { policyInputSchema, type PolicyInput } from "./schemas.js";

export class PolicyNotFoundError extends Error {
  constructor(id: string) {
    super(`Policy ${id} not found`);
    this.name = "PolicyNotFoundError";
  }
}

export class PolicyService {
  constructor(
    private readonly store: Store,
    private readonly now: () => number = () => Date.now(),
    private readonly idGen: () => string = randomUUID,
  ) {}

  async create(input: unknown, clientId?: string): Promise<Policy> {
    const parsed = policyInputSchema.parse(input);
    const policy: Policy = {
      id: this.idGen(),
      owner: parsed.owner,
      rules: parsed.rules,
      remediation: parsed.remediation,
      version: 1,
      updatedAt: this.now(),
    };
    await this.store.putPolicy(policy, clientId);
    return policy;
  }

  async update(id: string, input: PolicyInput, clientId?: string): Promise<Policy> {
    const existing = await this.store.getPolicy(id, clientId);
    if (!existing) throw new PolicyNotFoundError(id);
    const policy: Policy = {
      ...existing,
      owner: input.owner,
      rules: input.rules,
      remediation: input.remediation,
      version: existing.version + 1,
      updatedAt: this.now(),
    };
    await this.store.putPolicy(policy, clientId);
    return policy;
  }

  get(id: string, clientId?: string): Promise<Policy | null> {
    return this.store.getPolicy(id, clientId);
  }

  list(owner?: Policy["owner"], clientId?: string): Promise<Policy[]> {
    return this.store.listPolicies({ ...(owner !== undefined && { owner }), ...(clientId !== undefined && { clientId }) });
  }
}
