import { randomUUID } from "node:crypto";
import type { Policy } from "./types.js";
import type { Store } from "../memory/store.js";
import { policyInputSchema, type PolicyInput } from "./schemas.js";

export class PolicyService {
  constructor(
    private readonly store: Store,
    private readonly now: () => number = () => Date.now(),
    private readonly idGen: () => string = randomUUID,
  ) {}

  async create(input: unknown): Promise<Policy> {
    const parsed = policyInputSchema.parse(input);
    const policy: Policy = {
      id: this.idGen(),
      owner: parsed.owner,
      rules: parsed.rules,
      remediation: parsed.remediation,
      version: 1,
      updatedAt: this.now(),
    };
    await this.store.putPolicy(policy);
    return policy;
  }

  async update(id: string, input: PolicyInput): Promise<Policy> {
    const existing = await this.store.getPolicy(id);
    if (!existing) throw new Error(`Policy ${id} not found`);
    const policy: Policy = {
      ...existing,
      owner: input.owner,
      rules: input.rules,
      remediation: input.remediation,
      version: existing.version + 1,
      updatedAt: this.now(),
    };
    await this.store.putPolicy(policy);
    return policy;
  }

  get(id: string): Promise<Policy | null> {
    return this.store.getPolicy(id);
  }

  list(owner?: Policy["owner"]): Promise<Policy[]> {
    return this.store.listPolicies(owner);
  }
}
