import type { Decision, Policy } from "../core/types.js";

export interface AnchorRecord {
  rootHash: string;
  txHash: string;
}

/**
 * Per-browser session isolation contract.
 *
 * Every read + write accepts an optional `clientId`. The frontend generates a
 * stable UUID per browser (stored in localStorage) and sends it as the
 * `X-Client-Id` HTTP header on every API call; the Fastify route reads the
 * header and threads the value down to the Store. Implementations:
 *
 *   - On WRITE, tag the row with the supplied clientId. `undefined` ->
 *     untagged (system/admin/CLI rows).
 *   - On READ, when a clientId is provided, only return rows tagged with
 *     the same clientId. `undefined` -> return everything (admin / curl /
 *     test fixtures).
 *
 * The contract NEVER leaks the existence of a row owned by a different
 * client: `getPolicy("foreign-id", "my-client")` returns `null`, identical
 * to a genuinely missing id. This is the property `tests/clientIsolation`
 * locks down.
 */
export interface Store {
  putPolicy(policy: Policy, clientId?: string): Promise<void>;
  getPolicy(id: string, clientId?: string): Promise<Policy | null>;
  listPolicies(filter?: {
    owner?: Policy["owner"];
    clientId?: string;
  }): Promise<Policy[]>;
  appendDecision(decision: Decision, clientId?: string): Promise<void>;
  listDecisions(filter: {
    owner?: Policy["owner"];
    from?: number;
    to?: number;
    clientId?: string;
  }): Promise<Decision[]>;
  getAnchor?(id: string): AnchorRecord | undefined;
}
