import { describe, expect, it } from "bun:test";
import { AxlGossipTransport } from "../src/transport/axlGossip.js";
import { NoopGossip } from "../src/transport/noopGossip.js";
import type { Decision, Policy } from "../src/core/types.js";
import { TREASURY, makeIntent, makePolicy } from "./helpers.js";

function makeDecision(overrides: Partial<Decision> = {}): Decision {
  return {
    id: "dec-axl-1",
    intent: makeIntent({ value: "1000000000000000000" }),
    verdict: "BLOCK",
    riskScore: 95,
    rulesMatched: ["forbiddenSelectors"],
    reasons: ["Selector 0x095ea7b3 is on the forbidden list."],
    policyId: "policy-1",
    timestamp: 1_700_000_000_000,
    ...overrides,
  };
}

function captureLogger() {
  const warnings: string[] = [];
  const logs: string[] = [];
  return {
    warnings,
    logs,
    logger: {
      warn: (msg: string) => warnings.push(msg),
      log: (msg: string) => logs.push(msg),
    },
  };
}

describe("AxlGossipTransport", () => {
  it("POSTs the decision payload to the local AXL bridge with default topic", async () => {
    let captured: { url: string; method: string; headers: Record<string, string>; body: unknown } | null = null;
    const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
      const headersIn = init?.headers as Record<string, string> | undefined;
      captured = {
        url: String(url),
        method: init?.method ?? "GET",
        headers: { ...(headersIn ?? {}) },
        body: init?.body ? JSON.parse(init.body as string) : null,
      };
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const transport = new AxlGossipTransport({
      baseUrl: "http://127.0.0.1:9002",
      fetcher,
    });

    await transport.broadcast(makeDecision(), makePolicy());

    expect(captured).not.toBeNull();
    expect(captured!.url).toBe("http://127.0.0.1:9002/api/v1/mcp/publish");
    expect(captured!.method).toBe("POST");
    expect(captured!.headers["Content-Type"]).toBe("application/json");

    const body = captured!.body as {
      topic: string;
      payload: { decision: Decision; policy: Policy };
    };
    expect(body.topic).toBe("chainshield.decisions");
    expect(body.payload.decision.id).toBe("dec-axl-1");
    expect(body.payload.decision.verdict).toBe("BLOCK");
    expect(body.payload.policy.owner).toBe(TREASURY);
  });

  it("uses the configured topic when one is provided", async () => {
    let bodySeen: { topic: string } | null = null;
    const fetcher = (async (_url: string | URL | Request, init?: RequestInit) => {
      bodySeen = JSON.parse(init?.body as string) as { topic: string };
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    const transport = new AxlGossipTransport({
      baseUrl: "http://127.0.0.1:9002",
      topic: "chainshield.test",
      fetcher,
    });
    await transport.broadcast(makeDecision(), makePolicy());

    expect(bodySeen!.topic).toBe("chainshield.test");
  });

  it("never throws when the AXL node returns a 5xx", async () => {
    const cap = captureLogger();
    const fetcher = (async () =>
      new Response("internal", { status: 500 })) as unknown as typeof fetch;

    const transport = new AxlGossipTransport({
      baseUrl: "http://127.0.0.1:9002",
      fetcher,
      logger: cap.logger,
    });

    await transport.broadcast(makeDecision(), makePolicy());

    expect(cap.warnings.length).toBe(1);
    expect(cap.warnings[0]).toContain("500");
    expect(cap.warnings[0]).toContain("internal");
  });

  it("never throws when the network call rejects", async () => {
    const cap = captureLogger();
    const fetcher = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;

    const transport = new AxlGossipTransport({
      baseUrl: "http://127.0.0.1:9002",
      fetcher,
      logger: cap.logger,
    });

    await transport.broadcast(makeDecision(), makePolicy());

    expect(cap.warnings.length).toBe(1);
    expect(cap.warnings[0]).toContain("ECONNREFUSED");
  });

  it("collapses an HTML error body to (html error page) instead of leaking markup", async () => {
    const cap = captureLogger();
    const html =
      "<!DOCTYPE html><html><body>" +
      "<script src='/_next/x.js'></script>".repeat(40) +
      "</body></html>";
    const fetcher = (async () =>
      new Response(html, {
        status: 502,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      })) as unknown as typeof fetch;

    const transport = new AxlGossipTransport({
      baseUrl: "http://127.0.0.1:9002",
      fetcher,
      logger: cap.logger,
    });

    await transport.broadcast(makeDecision(), makePolicy());

    expect(cap.warnings.length).toBe(1);
    expect(cap.warnings[0]).toContain("502");
    expect(cap.warnings[0]).toContain("(html error page)");
    expect(cap.warnings[0]).not.toContain("<script");
  });
});

describe("NoopGossip", () => {
  it("broadcast resolves without doing anything", async () => {
    const transport = new NoopGossip();
    await transport.broadcast(makeDecision(), makePolicy());
    // pure no-op; success is just not throwing
    expect(true).toBe(true);
  });
});
