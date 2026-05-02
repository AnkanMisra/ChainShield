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

export class ZeroGStore implements Store {
  private readonly indexer: IndexerLike;
  private readonly signer: ethers.Signer;
  private readonly rpcUrl: string;
  private readonly logger: Pick<Console, "log" | "warn">;

  private policies = new Map<string, Policy>();
  private decisions: Decision[] = [];
  private anchors = new Map<string, AnchorRecord>();

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

  async putPolicy(policy: Policy): Promise<void> {
    this.policies.set(policy.id, policy);
    const anchor = await this.tryAnchor(`policy:${policy.id}`, JSON.stringify(policy));
    if (anchor) this.anchors.set(policy.id, anchor);
  }

  async getPolicy(id: string): Promise<Policy | null> {
    return this.policies.get(id) ?? null;
  }

  async listPolicies(owner?: Policy["owner"]): Promise<Policy[]> {
    const all = [...this.policies.values()];
    return owner
      ? all.filter((p) => p.owner.toLowerCase() === owner.toLowerCase())
      : all;
  }

  async appendDecision(decision: Decision): Promise<void> {
    this.decisions.push(decision);
    const anchor = await this.tryAnchor(`decision:${decision.id}`, JSON.stringify(decision));
    if (anchor) this.anchors.set(decision.id, anchor);
  }

  async listDecisions(filter: {
    owner?: Policy["owner"];
    from?: number;
    to?: number;
  }): Promise<Decision[]> {
    return this.decisions.filter((d) => {
      if (filter.from !== undefined && d.timestamp < filter.from) return false;
      if (filter.to !== undefined && d.timestamp > filter.to) return false;
      if (filter.owner && d.intent.from.toLowerCase() !== filter.owner.toLowerCase()) {
        return false;
      }
      return true;
    });
  }

  getAnchor(id: string): AnchorRecord | undefined {
    return this.anchors.get(id);
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
        this.logger.log(`[zeroG] anchored ${label} root=${result.rootHash}`);
        return { rootHash: result.rootHash, txHash: result.txHash };
      }
      const rootHash = result.rootHashes[0] ?? "";
      const txHash = result.txHashes[0] ?? "";
      this.logger.log(`[zeroG] anchored ${label} (multi) root=${rootHash}`);
      return { rootHash, txHash };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`[zeroG] anchor ${label} threw: ${msg}`);
      return null;
    }
  }
}
