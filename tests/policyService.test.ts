import { describe, expect, it } from "vitest";
import { InMemoryStore } from "../src/memory/memoryStore.js";
import { PolicyService } from "../src/core/policyService.js";
import { TREASURY, COLD_VAULT } from "./helpers.js";

describe("PolicyService", () => {
  it("creates a valid policy with a generated id and version 1", async () => {
    const store = new InMemoryStore();
    const svc = new PolicyService(store, () => 42, () => "id-1");

    const p = await svc.create({
      owner: TREASURY,
      rules: { maxTransferEth: 1, allowedDestinations: [COLD_VAULT] },
    });

    expect(p.id).toBe("id-1");
    expect(p.version).toBe(1);
    expect(p.updatedAt).toBe(42);
    expect(await svc.get("id-1")).toEqual(p);
  });

  it("rejects malformed addresses", async () => {
    const svc = new PolicyService(new InMemoryStore());
    await expect(
      svc.create({ owner: "not-an-address", rules: {} }),
    ).rejects.toThrow();
  });

  it("bumps version on update", async () => {
    const store = new InMemoryStore();
    let n = 0;
    const svc = new PolicyService(store, () => 100 + n++, () => "id-2");

    const created = await svc.create({ owner: TREASURY, rules: {} });
    const updated = await svc.update(created.id, {
      owner: TREASURY,
      rules: { maxTransferEth: 5 },
      remediation: {},
    });

    expect(updated.version).toBe(2);
    expect(updated.rules.maxTransferEth).toBe(5);
  });
});
