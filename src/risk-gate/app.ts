import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { ZodError } from "zod";
import type { Store } from "../memory/store.js";
import { InMemoryStore } from "../memory/memoryStore.js";
import { DecisionEngine } from "../core/engine.js";
import { PolicyService } from "../core/policyService.js";
import { evaluateRequestSchema, policyInputSchema } from "../core/schemas.js";

export interface AppDeps {
  store?: Store;
  engine?: DecisionEngine;
  policyService?: PolicyService;
}

const DEFAULT_WEB_ORIGINS = ["http://127.0.0.1:4321", "http://localhost:4321"];

export function buildApp(deps: AppDeps = {}): FastifyInstance {
  const store = deps.store ?? new InMemoryStore();
  const engine = deps.engine ?? new DecisionEngine({ store });
  const policyService = deps.policyService ?? new PolicyService(store);

  const app = Fastify({ logger: false });

  const envOrigin = process.env.WEB_ORIGIN;
  const origin = envOrigin ? envOrigin.split(",").map((s) => s.trim()) : DEFAULT_WEB_ORIGINS;
  app.register(cors, { origin });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      reply.status(400).send({ error: "ValidationError", issues: err.issues });
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    reply.status(500).send({ error: "InternalError", message });
  });

  app.get("/health", async () => ({ status: "ok" }));

  app.post("/policies", async (req, reply) => {
    const policy = await policyService.create(req.body);
    reply.status(201);
    return policy;
  });

  app.put("/policies/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = policyInputSchema.parse(req.body);
    try {
      return await policyService.update(id, parsed);
    } catch (err) {
      reply.status(404);
      return { error: "NotFound", message: (err as Error).message };
    }
  });

  app.get("/policies/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const policy = await policyService.get(id);
    if (!policy) {
      reply.status(404);
      return { error: "NotFound" };
    }
    return policy;
  });

  app.get("/policies", async (req) => {
    const { owner } = req.query as { owner?: string };
    return policyService.list(owner as `0x${string}` | undefined);
  });

  app.post("/evaluate", async (req, reply) => {
    const body = evaluateRequestSchema.parse(req.body);
    const policy = await policyService.get(body.policyId);
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
    return engine.evaluate(body.intent, policy);
  });

  app.get("/timeline", async (req) => {
    const q = req.query as { owner?: string; from?: string; to?: string };
    return store.listDecisions({
      owner: q.owner as `0x${string}` | undefined,
      from: q.from ? Number(q.from) : undefined,
      to: q.to ? Number(q.to) : undefined,
    });
  });

  return app;
}
