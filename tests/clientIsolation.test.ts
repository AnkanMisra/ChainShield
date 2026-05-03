import { describe, expect, it } from "bun:test";
import { buildApp } from "../src/risk-gate/app.js";
import { InMemoryStore } from "../src/memory/memoryStore.js";
import { COLD_VAULT, TREASURY, makeIntent, makePolicy } from "./helpers.js";

const A = "browser-aaa";
const B = "browser-bbb";

function postPolicy(app: ReturnType<typeof buildApp>, clientId?: string) {
  return app.inject({
    method: "POST",
    url: "/policies",
    headers: clientId ? { "x-client-id": clientId } : {},
    payload: { owner: TREASURY, rules: { allowedDestinations: [COLD_VAULT] } },
  });
}

function listPolicies(app: ReturnType<typeof buildApp>, clientId?: string) {
  return app.inject({
    method: "GET",
    url: "/policies",
    headers: clientId ? { "x-client-id": clientId } : {},
  });
}

function getPolicy(app: ReturnType<typeof buildApp>, id: string, clientId?: string) {
  return app.inject({
    method: "GET",
    url: `/policies/${encodeURIComponent(id)}`,
    headers: clientId ? { "x-client-id": clientId } : {},
  });
}

function postEvaluate(
  app: ReturnType<typeof buildApp>,
  policyId: string,
  clientId: string,
) {
  return app.inject({
    method: "POST",
    url: "/evaluate",
    headers: { "x-client-id": clientId },
    payload: {
      policyId,
      intent: {
        from: TREASURY,
        to: COLD_VAULT,
        value: "1",
        data: "0x",
        chainId: 16602,
      },
    },
  });
}

function getTimeline(app: ReturnType<typeof buildApp>, clientId?: string) {
  return app.inject({
    method: "GET",
    url: "/timeline",
    headers: clientId ? { "x-client-id": clientId } : {},
  });
}

describe("Per-browser session isolation via X-Client-Id", () => {
  it("a policy created by browser A is not visible to browser B", async () => {
    const app = buildApp();
    const created = await postPolicy(app, A);
    expect(created.statusCode).toBe(201);
    const policyId = created.json().id;

    const aSeesIt = await listPolicies(app, A);
    expect(aSeesIt.json().map((p: { id: string }) => p.id)).toContain(policyId);

    const bSeesIt = await listPolicies(app, B);
    expect(bSeesIt.json()).toHaveLength(0);

    await app.close();
  });

  it("getPolicy returns 404 when the id belongs to a different client (no leakage)", async () => {
    const app = buildApp();
    const created = await postPolicy(app, A);
    const policyId = created.json().id;

    const aFinds = await getPolicy(app, policyId, A);
    expect(aFinds.statusCode).toBe(200);

    const bGets404 = await getPolicy(app, policyId, B);
    expect(bGets404.statusCode).toBe(404);

    await app.close();
  });

  it("evaluate fails for browser B against a policy owned by browser A", async () => {
    const app = buildApp();
    const created = await postPolicy(app, A);
    const policyId = created.json().id;

    const bEval = await postEvaluate(app, policyId, B);
    expect(bEval.statusCode).toBe(404);
    expect(bEval.json().error).toBe("PolicyNotFound");

    await app.close();
  });

  it("decisions written under A do not appear in B's /timeline", async () => {
    const app = buildApp();
    const created = await postPolicy(app, A);
    const policyId = created.json().id;
    const aEval = await postEvaluate(app, policyId, A);
    expect(aEval.statusCode).toBe(200);

    const aTimeline = await getTimeline(app, A);
    expect(aTimeline.json()).toHaveLength(1);

    const bTimeline = await getTimeline(app, B);
    expect(bTimeline.json()).toHaveLength(0);

    await app.close();
  });

  it("requests without X-Client-Id see the global view (admin / curl path)", async () => {
    const app = buildApp();
    await postPolicy(app, A);
    await postPolicy(app, B);

    const adminList = await listPolicies(app);
    expect(adminList.json().length).toBeGreaterThanOrEqual(2);

    await app.close();
  });

  it("rejects oversized X-Client-Id headers and falls back to admin view", async () => {
    const app = buildApp();
    const oversized = "x".repeat(200);
    const created = await postPolicy(app, oversized);
    expect(created.statusCode).toBe(201);
    // Server treated the oversized id as "no clientId", so the policy was
    // tagged null and the admin view (no header) sees it.
    const adminSeesIt = await listPolicies(app);
    expect(adminSeesIt.json().length).toBeGreaterThanOrEqual(1);
    await app.close();
  });
});

describe("InMemoryStore: clientId tagging at the unit level", () => {
  it("getPolicy returns null when the wrong clientId is supplied", async () => {
    const store = new InMemoryStore();
    await store.putPolicy(makePolicy({ id: "p" }), "alice");
    expect(await store.getPolicy("p", "alice")).not.toBeNull();
    expect(await store.getPolicy("p", "bob")).toBeNull();
    expect(await store.getPolicy("p")).not.toBeNull(); // admin view
  });

  it("listDecisions filters by clientId before owner / from / to", async () => {
    const store = new InMemoryStore();
    await store.appendDecision(
      {
        id: "d-alice",
        intent: makeIntent({ value: "1" }),
        verdict: "ALLOW",
        riskScore: 0,
        rulesMatched: [],
        reasons: [],
        policyId: "p",
        timestamp: 100,
      },
      "alice",
    );
    await store.appendDecision(
      {
        id: "d-bob",
        intent: makeIntent({ value: "1" }),
        verdict: "ALLOW",
        riskScore: 0,
        rulesMatched: [],
        reasons: [],
        policyId: "p",
        timestamp: 200,
      },
      "bob",
    );

    expect((await store.listDecisions({ clientId: "alice" })).map((d) => d.id)).toEqual([
      "d-alice",
    ]);
    expect((await store.listDecisions({ clientId: "bob" })).map((d) => d.id)).toEqual([
      "d-bob",
    ]);
    expect((await store.listDecisions({})).map((d) => d.id)).toEqual([
      "d-alice",
      "d-bob",
    ]);
  });
});
