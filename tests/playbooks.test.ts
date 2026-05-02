import { describe, expect, it } from "bun:test";
import { MockRunner } from "../src/playbooks/runner.js";
import { KeeperHubRunner } from "../src/playbooks/keeperhub.js";
import { CollectorChannel, WebhookChannel } from "../src/playbooks/notifier.js";
import type { Decision, Policy } from "../src/core/types.js";
import { TREASURY, makeIntent, makePolicy } from "./helpers.js";

function makeDecision(overrides: Partial<Decision> = {}): Decision {
  return {
    id: "dec-1",
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

describe("MockRunner", () => {
  it("records invocations and returns sequential run ids", async () => {
    const runner = new MockRunner({ runIdPrefix: "mock" });
    const policy: Policy = makePolicy();
    const r1 = await runner.run("revoke-all", makeDecision({ id: "d1" }), policy);
    const r2 = await runner.run("safe-vault-evac", makeDecision({ id: "d2" }), policy);
    expect(r1).toEqual({ id: "revoke-all", runId: "mock-1" });
    expect(r2).toEqual({ id: "safe-vault-evac", runId: "mock-2" });
    expect(runner.invocations).toEqual([
      { playbookId: "revoke-all", decisionId: "d1", policyId: "policy-1" },
      { playbookId: "safe-vault-evac", decisionId: "d2", policyId: "policy-1" },
    ]);
  });

  it("throws when configured to fail for a given playbook id", async () => {
    const runner = new MockRunner({ failPlaybookIds: ["bad"] });
    const policy = makePolicy();
    await expect(runner.run("bad", makeDecision(), policy)).rejects.toThrow("forced failure");
  });
});

describe("KeeperHubRunner", () => {
  it("POSTs to /api/workflow/:id/execute with bearer auth and a JSON inputs body", async () => {
    let captured: { url: string; method: string; headers: Record<string, string>; body: unknown } | null = null;
    const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
      const headersIn = init?.headers as Record<string, string> | undefined;
      captured = {
        url: String(url),
        method: init?.method ?? "GET",
        headers: { ...(headersIn ?? {}) },
        body: init?.body ? JSON.parse(init.body as string) : null,
      };
      return new Response(JSON.stringify({ runId: "kh-42" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const runner = new KeeperHubRunner({
      baseUrl: "https://app.keeperhub.com",
      apiKey: "secret-token",
      fetcher,
    });

    const result = await runner.run("revoke-all-approvals", makeDecision(), makePolicy());

    expect(result).toEqual({ id: "revoke-all-approvals", runId: "kh-42" });
    expect(captured!.url).toBe("https://app.keeperhub.com/api/workflow/revoke-all-approvals/execute");
    expect(captured!.method).toBe("POST");
    expect(captured!.headers["Authorization"]).toBe("Bearer secret-token");
    expect(captured!.headers["Content-Type"]).toBe("application/json");
    const body = captured!.body as { inputs: { owner: string; rulesMatched: string[]; riskScore: number } };
    expect(body.inputs.owner).toBe(TREASURY);
    expect(body.inputs.rulesMatched).toEqual(["forbiddenSelectors"]);
    expect(body.inputs.riskScore).toBe(95);
  });

  it("falls back to id then executionId when runId is missing", async () => {
    const fetcher = (async () =>
      new Response(JSON.stringify({ executionId: "exec-7" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as unknown as typeof fetch;
    const runner = new KeeperHubRunner({
      baseUrl: "https://app.keeperhub.com/",
      apiKey: "k",
      fetcher,
    });
    const result = await runner.run("safe-vault-evac", makeDecision(), makePolicy());
    expect(result.runId).toBe("exec-7");
  });

  it("throws when KeeperHub responds with a non-2xx status", async () => {
    const fetcher = (async () =>
      new Response("forbidden", { status: 403 })) as unknown as typeof fetch;
    const runner = new KeeperHubRunner({
      baseUrl: "https://app.keeperhub.com",
      apiKey: "k",
      fetcher,
    });
    await expect(runner.run("revoke-all", makeDecision(), makePolicy())).rejects.toThrow(
      /KeeperHub run failed \(403\): forbidden/,
    );
  });

  it("suppresses an HTML 404 page in the error message", async () => {
    const html = "<!DOCTYPE html><html><head><title>404</title></head><body>" +
      "<script src='/_next/static/chunks/foo.js'></script>".repeat(50) + "</body></html>";
    const fetcher = (async () =>
      new Response(html, {
        status: 404,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      })) as unknown as typeof fetch;
    const runner = new KeeperHubRunner({
      baseUrl: "https://app.keeperhub.com",
      apiKey: "k",
      fetcher,
    });
    let caught: Error | null = null;
    try {
      await runner.run("revoke-all", makeDecision(), makePolicy());
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).not.toBeNull();
    expect(caught!.message).toBe("KeeperHub run failed (404): (html error page)");
    expect(caught!.message.length).toBeLessThan(120);
    expect(caught!.message).not.toContain("<script");
  });

  it("truncates long non-HTML error bodies to 200 chars + ellipsis", async () => {
    const huge = "{\"error\":\"" + "x".repeat(2000) + "\"}";
    const fetcher = (async () =>
      new Response(huge, {
        status: 500,
        headers: { "Content-Type": "application/json" },
      })) as unknown as typeof fetch;
    const runner = new KeeperHubRunner({
      baseUrl: "https://app.keeperhub.com",
      apiKey: "k",
      fetcher,
    });
    let caught: Error | null = null;
    try {
      await runner.run("revoke-all", makeDecision(), makePolicy());
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).not.toBeNull();
    expect(caught!.message).toMatch(/^KeeperHub run failed \(500\): /);
    expect(caught!.message.endsWith("...")).toBe(true);
    expect(caught!.message.length).toBeLessThan(260);
  });

  it("encodes playbook ids that contain special characters", async () => {
    let capturedUrl = "";
    const fetcher = (async (url: string | URL | Request) => {
      capturedUrl = String(url);
      return new Response(JSON.stringify({ runId: "ok" }), { status: 200 });
    }) as unknown as typeof fetch;
    const runner = new KeeperHubRunner({
      baseUrl: "https://app.keeperhub.com",
      apiKey: "k",
      fetcher,
    });
    await runner.run("safe vault/evac", makeDecision(), makePolicy());
    expect(capturedUrl).toContain("safe%20vault%2Fevac");
  });
});

describe("CollectorChannel", () => {
  it("captures every notify call with verdict and decision id", async () => {
    const c = new CollectorChannel();
    await c.notify("hello", makeDecision({ id: "d1", verdict: "BLOCK" }));
    await c.notify("world", makeDecision({ id: "d2", verdict: "REQUIRE_HUMAN_CONFIRMATION" }));
    expect(c.messages).toEqual([
      { message: "hello", decisionId: "d1", verdict: "BLOCK" },
      { message: "world", decisionId: "d2", verdict: "REQUIRE_HUMAN_CONFIRMATION" },
    ]);
  });
});

describe("WebhookChannel", () => {
  it("POSTs a Discord-shaped embed to the configured webhook URL", async () => {
    let captured: { url: string; body: { content: string; embeds: Array<{ fields: Array<{ name: string; value: string }> }> } } | null = null;
    const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
      captured = {
        url: String(url),
        body: JSON.parse(init?.body as string),
      };
      return new Response("", { status: 204 });
    }) as unknown as typeof fetch;

    const ch = new WebhookChannel({ url: "https://discord.example/webhooks/abc", fetcher });
    await ch.notify("BLOCK on policy x", makeDecision({ id: "decision-id-12345678" }));

    expect(captured!.url).toBe("https://discord.example/webhooks/abc");
    expect(captured!.body.content).toContain("ChainShield");
    const fields = captured!.body.embeds[0]!.fields;
    expect(fields.find((f) => f.name === "Verdict")!.value).toBe("BLOCK");
    expect(fields.find((f) => f.name === "Risk")!.value).toBe("95/100");
  });

  it("uses a custom contentTemplate when provided", async () => {
    let bodySeen: unknown = null;
    const fetcher = (async (_url: string | URL | Request, init?: RequestInit) => {
      bodySeen = JSON.parse(init?.body as string);
      return new Response("", { status: 200 });
    }) as unknown as typeof fetch;

    const ch = new WebhookChannel({
      url: "https://example/hook",
      fetcher,
      contentTemplate: (m, d) => ({ slackText: `${m} (${d.verdict})` }),
    });
    await ch.notify("hi", makeDecision());
    expect(bodySeen).toEqual({ slackText: "hi (BLOCK)" });
  });

  it("throws if the webhook responds with a non-2xx status", async () => {
    const fetcher = (async () => new Response("err", { status: 500 })) as unknown as typeof fetch;
    const ch = new WebhookChannel({ url: "https://example/hook", fetcher });
    await expect(ch.notify("x", makeDecision())).rejects.toThrow(/WebhookChannel failed \(500\)/);
  });
});
