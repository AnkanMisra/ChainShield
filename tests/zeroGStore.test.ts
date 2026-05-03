import { describe, expect, it } from "bun:test";
import { ZeroGStore } from "../src/memory/zeroGStore.js";
import type { Decision, Policy } from "../src/core/types.js";
import { ATTACKER, TREASURY, makeIntent, makePolicy } from "./helpers.js";

interface UploadCall {
  bytes: Uint8Array;
}

interface MockOptions {
  failOn?: number;
  throwOn?: number;
  rootHashes?: string[];
}

type MockIndexer = ConstructorParameters<typeof ZeroGStore>[0]["indexer"];

function makeMockIndexer(opts: MockOptions = {}): {
  indexer: NonNullable<MockIndexer>;
  calls: UploadCall[];
} {
  const calls: UploadCall[] = [];
  let n = 0;
  const indexer: NonNullable<MockIndexer> = {
    upload: async (file) => {
      n++;
      calls.push({ bytes: new Uint8Array(file.data) });
      if (opts.throwOn === n) {
        throw new Error("network: ECONNRESET");
      }
      if (opts.failOn === n) {
        return [
          { rootHash: "", txHash: "", txSeq: 0 },
          new Error("0G upload rejected: insufficient funds"),
        ];
      }
      const rootHash = opts.rootHashes?.[n - 1] ?? `0xroot${n.toString().padStart(60, "0")}`;
      const txHash = `0xtx${n.toString().padStart(62, "0")}`;
      return [{ rootHash, txHash, txSeq: n }, null];
    },
  };
  return { indexer, calls };
}

function silentLogger() {
  const calls: { level: "log" | "warn"; msg: string }[] = [];
  return {
    logger: {
      log: (msg?: unknown) => calls.push({ level: "log", msg: String(msg) }),
      warn: (msg?: unknown) => calls.push({ level: "warn", msg: String(msg) }),
    } as Pick<Console, "log" | "warn">,
    calls,
  };
}

function makeDecision(overrides: Partial<Decision> = {}): Decision {
  return {
    id: "dec-1",
    intent: makeIntent({ value: "1" }),
    verdict: "ALLOW",
    riskScore: 10,
    rulesMatched: [],
    reasons: [],
    policyId: "policy-1",
    timestamp: 1_700_000_000_000,
    ...overrides,
  };
}

const fakeSigner = {} as unknown as import("ethers").Signer;

describe("ZeroGStore", () => {
  it("uploads a policy on putPolicy and serves it from cache on getPolicy", async () => {
    const { indexer, calls } = makeMockIndexer();
    const { logger } = silentLogger();
    const store = new ZeroGStore({
      rpcUrl: "http://rpc",
      indexerRpc: "http://indexer",
      signer: fakeSigner,
      indexer,
      logger,
    });
    const policy: Policy = makePolicy({ id: "pA" });
    await store.putPolicy(policy);

    expect(calls).toHaveLength(1);
    const decoded = JSON.parse(new TextDecoder().decode(calls[0]!.bytes));
    expect(decoded.id).toBe("pA");
    expect(decoded.owner).toBe(TREASURY);

    const got = await store.getPolicy("pA");
    expect(got).toEqual(policy);

    const anchor = store.getAnchor("pA");
    expect(anchor?.rootHash.startsWith("0xroot")).toBe(true);
    expect(anchor?.txHash.startsWith("0xtx")).toBe(true);
  });

  it("returns null from getPolicy for an unknown id", async () => {
    const { indexer } = makeMockIndexer();
    const { logger } = silentLogger();
    const store = new ZeroGStore({
      rpcUrl: "http://rpc",
      indexerRpc: "http://indexer",
      signer: fakeSigner,
      indexer,
      logger,
    });
    expect(await store.getPolicy("missing")).toBeNull();
  });

  it("filters listPolicies by owner case-insensitively", async () => {
    const { indexer } = makeMockIndexer();
    const { logger } = silentLogger();
    const store = new ZeroGStore({
      rpcUrl: "http://rpc",
      indexerRpc: "http://indexer",
      signer: fakeSigner,
      indexer,
      logger,
    });
    await store.putPolicy(makePolicy({ id: "p1", owner: TREASURY }));
    await store.putPolicy(makePolicy({ id: "p2", owner: ATTACKER }));
    const upper = TREASURY.toUpperCase() as `0x${string}`;
    const list = await store.listPolicies({ owner: upper });
    expect(list.map((p) => p.id)).toEqual(["p1"]);
  });

  it("appends decisions and filters by owner / from / to", async () => {
    const { indexer, calls } = makeMockIndexer();
    const { logger } = silentLogger();
    const store = new ZeroGStore({
      rpcUrl: "http://rpc",
      indexerRpc: "http://indexer",
      signer: fakeSigner,
      indexer,
      logger,
    });
    await store.appendDecision(makeDecision({ id: "d1", timestamp: 100 }));
    await store.appendDecision(
      makeDecision({ id: "d2", timestamp: 200, intent: makeIntent({ from: ATTACKER, value: "1" }) }),
    );
    await store.appendDecision(makeDecision({ id: "d3", timestamp: 300 }));

    expect(calls).toHaveLength(3);
    expect((await store.listDecisions({})).map((d) => d.id)).toEqual(["d1", "d2", "d3"]);
    expect((await store.listDecisions({ owner: ATTACKER })).map((d) => d.id)).toEqual(["d2"]);
    expect(
      (await store.listDecisions({ from: 150, to: 250 })).map((d) => d.id),
    ).toEqual(["d2"]);

    expect(store.getAnchor("d1")).toBeDefined();
    expect(store.getAnchor("d3")?.rootHash).not.toBe(store.getAnchor("d1")?.rootHash);
  });

  it("keeps the policy in cache and skips the anchor when upload returns an error", async () => {
    const { indexer } = makeMockIndexer({ failOn: 1 });
    const { logger, calls } = silentLogger();
    const store = new ZeroGStore({
      rpcUrl: "http://rpc",
      indexerRpc: "http://indexer",
      signer: fakeSigner,
      indexer,
      logger,
    });
    await store.putPolicy(makePolicy({ id: "px" }));

    expect(await store.getPolicy("px")).not.toBeNull();
    expect(store.getAnchor("px")).toBeUndefined();
    const warned = calls.some((c) => c.level === "warn" && c.msg.includes("insufficient funds"));
    expect(warned).toBe(true);
  });

  it("treats a thrown indexer as a soft failure and does not break the write", async () => {
    const { indexer } = makeMockIndexer({ throwOn: 1 });
    const { logger, calls } = silentLogger();
    const store = new ZeroGStore({
      rpcUrl: "http://rpc",
      indexerRpc: "http://indexer",
      signer: fakeSigner,
      indexer,
      logger,
    });
    await store.appendDecision(makeDecision({ id: "dz" }));

    expect((await store.listDecisions({})).map((d) => d.id)).toEqual(["dz"]);
    expect(store.getAnchor("dz")).toBeUndefined();
    const warned = calls.some((c) => c.level === "warn" && c.msg.includes("ECONNRESET"));
    expect(warned).toBe(true);
  });

  it("skips the anchor when the indexer returns an empty rootHash", async () => {
    const indexer = {
      upload: async (): Promise<[unknown, Error | null]> => [
        { rootHash: "", txHash: "", txSeq: 0 },
        null,
      ],
    } as unknown as NonNullable<MockIndexer>;
    const { logger, calls } = silentLogger();
    const store = new ZeroGStore({
      rpcUrl: "http://rpc",
      indexerRpc: "http://indexer",
      signer: fakeSigner,
      indexer,
      logger,
    });
    await store.putPolicy(makePolicy({ id: "pe" }));
    expect(await store.getPolicy("pe")).not.toBeNull();
    expect(store.getAnchor("pe")).toBeUndefined();
    expect(
      calls.some((c) => c.level === "warn" && c.msg.includes("empty rootHash")),
    ).toBe(true);
  });

  it("skips the anchor when the indexer returns an empty multi-result", async () => {
    const indexer = {
      upload: async (): Promise<[unknown, Error | null]> => [
        { rootHashes: [], txHashes: [], txSeqs: [] },
        null,
      ],
    } as unknown as NonNullable<MockIndexer>;
    const { logger, calls } = silentLogger();
    const store = new ZeroGStore({
      rpcUrl: "http://rpc",
      indexerRpc: "http://indexer",
      signer: fakeSigner,
      indexer,
      logger,
    });
    await store.appendDecision(makeDecision({ id: "de" }));
    expect(store.getAnchor("de")).toBeUndefined();
    expect(
      calls.some((c) => c.level === "warn" && c.msg.includes("empty multi-result")),
    ).toBe(true);
  });

  it("requires a privateKey when no signer is provided", () => {
    expect(() =>
      new ZeroGStore({
        rpcUrl: "http://rpc",
        indexerRpc: "http://indexer",
      }),
    ).toThrow(/privateKey/);
  });
});
