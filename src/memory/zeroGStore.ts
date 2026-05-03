import { Indexer, MemData } from "@0gfoundation/0g-storage-ts-sdk";
import { ethers } from "ethers";
import type { Decision, Policy } from "../core/types.js";
import type { AnchorRecord, Store } from "./store.js";

export type { AnchorRecord };

interface UploadResultSingle {
  rootHash: string;
  txHash: string;
  txSeq: number;
}
interface UploadResultMulti {
  rootHashes: string[];
  txHashes: string[];
  txSeqs: number[];
}
type UploadResult = UploadResultSingle | UploadResultMulti;

interface IndexerLike {
  upload(
    file: MemData,
    blockchainRpc: string,
    signer: ethers.Signer,
  ): Promise<[UploadResult, Error | null]>;
}

export interface ZeroGStoreOptions {
  rpcUrl: string;
  indexerRpc: string;
  privateKey?: string;
  signer?: ethers.Signer;
  indexer?: IndexerLike;
  logger?: Pick<Console, "log" | "warn">;
}

interface TaggedPolicy {
  policy: Policy;
  clientId: string | null;
}

interface TaggedDecision {
  decision: Decision;
  clientId: string | null;
}

export class ZeroGStore implements Store {
  private readonly indexer: IndexerLike;
  private readonly signer: ethers.Signer;
  private readonly rpcUrl: string;
  private readonly logger: Pick<Console, "log" | "warn">;

  private policies = new Map<string, TaggedPolicy>();
  private decisions: TaggedDecision[] = [];
  private anchors = new Map<string, AnchorRecord>();

  /**
   * Tracks every in-flight 0G upload by row id so tests + the API admin
   * route can `await` for the anchor to land. In production nothing awaits
   * this — `putPolicy`/`appendDecision` return immediately after the local
   * write so the request hot path stays under 50ms instead of 5-30s.
   */
  private pending = new Map<string, Promise<void>>();

  constructor(opts: ZeroGStoreOptions) {
    this.rpcUrl = opts.rpcUrl;
    this.logger = opts.logger ?? console;
    this.indexer = opts.indexer ?? (new Indexer(opts.indexerRpc) as unknown as IndexerLike);
    if (opts.signer) {
      this.signer = opts.signer;
    } else {
      if (!opts.privateKey) {
        throw new Error("ZeroGStore requires either signer or privateKey");
      }
      const provider = new ethers.JsonRpcProvider(opts.rpcUrl);
      this.signer = new ethers.Wallet(opts.privateKey, provider);
    }
  }

  async putPolicy(policy: Policy, clientId?: string): Promise<void> {
    this.policies.set(policy.id, { policy, clientId: clientId ?? null });
    this.scheduleAnchor(policy.id, `policy:${policy.id}`, JSON.stringify(policy));
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
    this.scheduleAnchor(decision.id, `decision:${decision.id}`, JSON.stringify(decision));
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

  getAnchor(id: string): AnchorRecord | undefined {
    return this.anchors.get(id);
  }

  /**
   * Awaits the background anchor upload for a single row. Used by tests so
   * they can assert anchor presence after the upload settles, without
   * coupling production code to a synchronous wait. Resolves immediately
   * if no upload was scheduled for that id (e.g. wrong id, or anchor
   * already finished).
   */
  async waitForAnchor(id: string): Promise<void> {
    const p = this.pending.get(id);
    if (p) await p;
  }

  private scheduleAnchor(rowId: string, label: string, json: string): void {
    // Kick off the upload but DO NOT await — production callers return as
    // soon as the in-memory write is done. The promise is parked in
    // `pending` so tests + admin tooling can settle it.
    const p = this.tryAnchor(label, json)
      .then((anchor) => {
        if (anchor) this.anchors.set(rowId, anchor);
      })
      .finally(() => {
        // Only delete if the entry still points at this promise — a
        // subsequent overwrite of the same id (rare for policies, never
        // for decisions) would replace it and we don't want to clobber.
        if (this.pending.get(rowId) === p) this.pending.delete(rowId);
      });
    this.pending.set(rowId, p);
  }

  private async tryAnchor(label: string, json: string): Promise<AnchorRecord | null> {
    const bytes = new TextEncoder().encode(json);
    const file = new MemData(bytes);
    try {
      const [result, err] = await this.indexer.upload(file, this.rpcUrl, this.signer);
      if (err) {
        this.logger.warn(`[zeroG] anchor ${label} failed: ${err.message}`);
        return null;
      }
      if ("rootHash" in result) {
        if (!result.rootHash) {
          this.logger.warn(`[zeroG] anchor ${label} returned empty rootHash; skipping`);
          return null;
        }
        this.logger.log(`[zeroG] anchored ${label} root=${result.rootHash}`);
        return { rootHash: result.rootHash, txHash: result.txHash };
      }
      const rootHash = result.rootHashes[0];
      const txHash = result.txHashes[0];
      if (!rootHash) {
        this.logger.warn(`[zeroG] anchor ${label} returned empty multi-result; skipping`);
        return null;
      }
      this.logger.log(`[zeroG] anchored ${label} (multi) root=${rootHash}`);
      return { rootHash, txHash: txHash ?? "" };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`[zeroG] anchor ${label} threw: ${msg}`);
      return null;
    }
  }
}
