import type { Decision, Policy } from "../core/types.js";
import type { GossipTransport } from "./axlGossip.js";

export class NoopGossip implements GossipTransport {
  async broadcast(_decision: Decision, _policy: Policy): Promise<void> {
    // intentional no-op: used when AXL_BASE_URL is unset
  }
}
