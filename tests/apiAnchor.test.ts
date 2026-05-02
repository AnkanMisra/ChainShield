import { describe, expect, it } from "bun:test";
import { buildApp } from "../src/risk-gate/app.js";
import { InMemoryStore } from "../src/memory/memoryStore.js";
import type { AnchorRecord, Store } from "../src/memory/store.js";
import { COLD_VAULT, TREASURY } from "./helpers.js";

class AnchoredMemoryStore extends InMemoryStore {
  private counter = 0;
  private anchors = new Map<string, AnchorRecord>();

  async putPolicy(policy: Parameters<InMemoryStore["putPolicy"]>[0]) {
    await super.putPolicy(policy);
    this.counter++;
    this.anchors.set(policy.id, {
      rootHash: `0xroot${this.counter.toString().padStart(60, "0")}`,
      txHash: `0xtx${this.counter.toString().padStart(62, "0")}`,
    });
  }

  async appendDecision(decision: Parameters<InMemoryStore["appendDecision"]>[0]) {
    await super.appendDecision(decision);
    this.counter++;
    this.anchors.set(decision.id, {
      rootHash: `0xroot${this.counter.toString().padStart(60, "0")}`,
      txHash: `0xtx${this.counter.toString().padStart(62, "0")}`,
    });
  }

  getAnchor(id: string): AnchorRecord | undefined {
    return this.anchors.get(id);
  }
}

describe("Risk-Gate API — anchor surfacing", () => {
  it("attaches anchor to policy responses when the store is anchor-aware", async () => {
    const store: Store = new AnchoredMemoryStore();
    const app = buildApp({ store });

    const create = await app.inject({
      method: "POST",
      url: "/policies",
      payload: { owner: TREASURY, rules: { allowedDestinations: [COLD_VAULT] } },
    });
    expect(create.statusCode).toBe(201);
    const policy = create.json();
    expect(policy.anchor).toBeDefined();
    expect(policy.anchor.rootHash).toMatch(/^0xroot/);
    expect(policy.anchor.txHash).toMatch(/^0xtx/);

    const get = await app.inject({ method: "GET", url: `/policies/${policy.id}` });
    expect(get.json().anchor.rootHash).toBe(policy.anchor.rootHash);

    const list = await app.inject({ method: "GET", url: "/policies" });
    const arr = list.json();
    expect(arr).toHaveLength(1);
    expect(arr[0].anchor.rootHash).toBe(policy.anchor.rootHash);

    await app.close();
  });

  it("attaches anchor to evaluate and timeline responses", async () => {
    const store: Store = new AnchoredMemoryStore();
    const app = buildApp({ store });

    const create = await app.inject({
      method: "POST",
      url: "/policies",
      payload: { owner: TREASURY, rules: { allowedDestinations: [COLD_VAULT] } },
    });
    const policy = create.json();

    const evalRes = await app.inject({
      method: "POST",
      url: "/evaluate",
      payload: {
        policyId: policy.id,
        intent: {
          from: TREASURY,
          to: COLD_VAULT,
          value: "1",
          data: "0x",
          chainId: 16602,
        },
      },
    });
    const decision = evalRes.json();
    expect(decision.anchor).toBeDefined();
    expect(decision.anchor.rootHash).toMatch(/^0xroot/);

    const timeline = await app.inject({ method: "GET", url: "/timeline" });
    const tl = timeline.json();
    expect(tl).toHaveLength(1);
    expect(tl[0].anchor.rootHash).toBe(decision.anchor.rootHash);

    await app.close();
  });

  it("omits anchor field when the store is not anchor-aware (default in-memory)", async () => {
    const app = buildApp();

    const create = await app.inject({
      method: "POST",
      url: "/policies",
      payload: { owner: TREASURY, rules: {} },
    });
    expect(create.json().anchor).toBeUndefined();

    const evalRes = await app.inject({
      method: "POST",
      url: "/evaluate",
      payload: {
        policyId: create.json().id,
        intent: {
          from: TREASURY,
          to: COLD_VAULT,
          value: "0",
          data: "0x",
          chainId: 16602,
        },
      },
    });
    expect(evalRes.json().anchor).toBeUndefined();

    await app.close();
  });
});
