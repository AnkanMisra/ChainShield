import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { ZodError } from "zod";
import type { AnchorRecord, Store } from "../memory/store.js";
import { InMemoryStore } from "../memory/memoryStore.js";
import { DecisionEngine, type DecisionEngineOptions } from "../core/engine.js";
import { PolicyService } from "../core/policyService.js";
import { evaluateRequestSchema, policyInputSchema } from "../core/schemas.js";
import type { Decision, Policy } from "../core/types.js";
import { HeuristicSimulator } from "../simulator/heuristic.js";

export interface AppDeps {
  store?: Store;
  engine?: DecisionEngine;
  policyService?: PolicyService;
}

const DEFAULT_WEB_ORIGINS = ["http://127.0.0.1:4321", "http://localhost:4321"];

/**
 * Parse a single comma-separated `WEB_ORIGIN` entry. Entries surrounded by
 * forward slashes (e.g. `/\\.pages\\.dev$/`) are compiled as RegExp so that
 * platforms like Cloudflare Pages — where production lives at
 * `https://chainshield.pages.dev` and previews land at
 * `https://<sha>.chainshield.pages.dev` — can be allowed with a single
 * pattern. Plain entries pass through as literal strings, matching the
 * behaviour the Astro dev origin has always used.
 */
function parseOriginEntry(raw: string): string | RegExp {
  if (raw.length >= 2 && raw.startsWith("/") && raw.endsWith("/")) {
    return new RegExp(raw.slice(1, -1));
  }
  return raw;
}

/**
 * Default engine wiring used by both `buildApp` (when no engine is injected)
 * and `server.ts`. The simulator is always wired so test apps and the prod
 * server have the same evaluation pipeline; the playbook runner and the
 * notification channels stay opt-in because they require real credentials.
 */
export function defaultEngine(
  store: Store,
  overrides: Omit<DecisionEngineOptions, "store"> = {},
): DecisionEngine {
  return new DecisionEngine({
    store,
    simulator: new HeuristicSimulator(),
    ...overrides,
  });
}

export function buildApp(deps: AppDeps = {}): FastifyInstance {
  const store: Store = deps.store ?? new InMemoryStore();
  const engine = deps.engine ?? defaultEngine(store);
  const policyService = deps.policyService ?? new PolicyService(store);

  const app = Fastify({ logger: false });

  const envOrigin = process.env.WEB_ORIGIN;
  const origin = envOrigin
    ? envOrigin.split(",").map((s) => parseOriginEntry(s.trim()))
    : DEFAULT_WEB_ORIGINS;
  app.register(cors, { origin });

  function anchorOf(id: string): AnchorRecord | undefined {
    return store.getAnchor?.(id);
  }
  function withAnchor<T extends { id: string }>(item: T): T & { anchor?: AnchorRecord } {
    const a = anchorOf(item.id);
    return a ? { ...item, anchor: a } : item;
  }
  function withAnchorPolicy(policy: Policy) {
    return withAnchor(policy);
  }
  function withAnchorDecision(decision: Decision) {
    return withAnchor(decision);
  }

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      reply.status(400).send({ error: "ValidationError", issues: err.issues });
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    reply.status(500).send({ error: "InternalError", message });
  });

  app.get("/health", async () => ({ status: "ok" }));

  /**
   * Read the per-browser session id from the request. The Astro frontend
   * generates a UUID once on first load and stores it in localStorage; every
   * fetch sends it back via `X-Client-Id`. The risk-gate scopes all CRUD
   * operations to this id so Browser A cannot see Browser B's policies or
   * timeline rows.
   *
   * Requests without the header (curl, the demo CLI, integration tests) get
   * `undefined` and the Store reverts to "no filter" — i.e. global view —
   * which is the legacy behaviour and is still useful for admin / debug.
   */
  function clientIdOf(req: { headers: Record<string, unknown> }): string | undefined {
    const raw = req.headers["x-client-id"];
    if (typeof raw !== "string") return undefined;
    const trimmed = raw.trim();
    // Cap at 128 chars to bound the dimension of the in-memory store.
    if (trimmed.length === 0 || trimmed.length > 128) return undefined;
    return trimmed;
  }

  app.post("/policies", async (req, reply) => {
    const policy = await policyService.create(req.body, clientIdOf(req));
    reply.status(201);
    return withAnchorPolicy(policy);
  });

  app.put("/policies/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = policyInputSchema.parse(req.body);
    try {
      return withAnchorPolicy(await policyService.update(id, parsed, clientIdOf(req)));
    } catch (err) {
      reply.status(404);
      return { error: "NotFound", message: (err as Error).message };
    }
  });

  app.get("/policies/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const policy = await policyService.get(id, clientIdOf(req));
    if (!policy) {
      reply.status(404);
      return { error: "NotFound" };
    }
    return withAnchorPolicy(policy);
  });

  app.get("/policies", async (req) => {
    const { owner } = req.query as { owner?: string };
    const list = await policyService.list(owner as `0x${string}` | undefined, clientIdOf(req));
    return list.map(withAnchorPolicy);
  });

  app.post("/evaluate", async (req, reply) => {
    const body = evaluateRequestSchema.parse(req.body);
    const cid = clientIdOf(req);
    const policy = await policyService.get(body.policyId, cid);
    if (!policy) {
      reply.status(404);
      return { error: "PolicyNotFound" };
    }
    if (policy.owner.toLowerCase() !== body.intent.from.toLowerCase()) {
      reply.status(400);
      return {
        error: "PolicyOwnerMismatch",
        message: "Policy owner must match intent.from.",
      };
    }
    return withAnchorDecision(await engine.evaluate(body.intent, policy, cid));
  });

  app.get("/timeline", async (req) => {
    const q = req.query as { owner?: string; from?: string; to?: string };
    const cid = clientIdOf(req);
    const list = await store.listDecisions({
      owner: q.owner as `0x${string}` | undefined,
      from: q.from ? Number(q.from) : undefined,
      to: q.to ? Number(q.to) : undefined,
      ...(cid !== undefined && { clientId: cid }),
    });
    return list.map(withAnchorDecision);
  });

  return app;
}
