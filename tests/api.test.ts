import { describe, expect, it } from "vitest";
import { buildApp } from "../src/risk-gate/app.js";
import { TREASURY, COLD_VAULT, ATTACKER } from "./helpers.js";

describe("Risk-Gate API", () => {
  it("creates a policy then evaluates an intent against it", async () => {
    const app = buildApp();

    const create = await app.inject({
      method: "POST",
      url: "/policies",
      payload: {
        owner: TREASURY,
        rules: { maxTransferEth: 1, allowedDestinations: [COLD_VAULT] },
      },
    });
    expect(create.statusCode).toBe(201);
    const policy = create.json();

    const allowed = await app.inject({
      method: "POST",
      url: "/evaluate",
      payload: {
        policyId: policy.id,
        intent: {
          from: TREASURY,
          to: COLD_VAULT,
          value: "100000000000000000",
          data: "0x",
          chainId: 16602,
        },
      },
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json().verdict).toBe("ALLOW");

    const blocked = await app.inject({
      method: "POST",
      url: "/evaluate",
      payload: {
        policyId: policy.id,
        intent: {
          from: TREASURY,
          to: ATTACKER,
          value: "5000000000000000000",
          data: "0x",
          chainId: 16602,
        },
      },
    });
    expect(blocked.statusCode).toBe(200);
    expect(blocked.json().verdict).toBe("BLOCK");

    const timeline = await app.inject({ method: "GET", url: "/timeline" });
    expect(timeline.json()).toHaveLength(2);

    await app.close();
  });

  it("returns 404 evaluating against an unknown policy", async () => {
    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/evaluate",
      payload: {
        policyId: "missing",
        intent: {
          from: TREASURY,
          to: COLD_VAULT,
          value: "1",
          data: "0x",
          chainId: 16602,
        },
      },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("returns 400 with ZodError details on malformed payloads", async () => {
    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/policies",
      payload: { owner: "0xnope", rules: {} },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("ValidationError");
    await app.close();
  });
});
