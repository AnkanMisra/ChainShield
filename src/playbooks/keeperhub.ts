import type { Decision, PlaybookRun, Policy } from "../core/types.js";
import type { PlaybookRunner } from "./runner.js";

export interface KeeperHubConfig {
  baseUrl: string;
  apiKey: string;
  fetcher?: typeof fetch;
}

interface KeeperHubExecuteResponse {
  runId?: string;
  id?: string;
  executionId?: string;
}

const ERROR_BODY_MAX = 200;

async function summarizeErrorBody(res: Response): Promise<string> {
  const contentType = res.headers.get("content-type") ?? "";
  let body = await res.text().catch(() => "");
  if (!body) return "(empty body)";
  if (contentType.includes("text/html") || /^<!DOCTYPE|<html/i.test(body)) {
    return "(html error page)";
  }
  body = body.replace(/\s+/g, " ").trim();
  return body.length > ERROR_BODY_MAX ? body.slice(0, ERROR_BODY_MAX) + "..." : body;
}

export class KeeperHubRunner implements PlaybookRunner {
  constructor(private readonly cfg: KeeperHubConfig) {}

  async run(playbookId: string, decision: Decision, policy: Policy): Promise<PlaybookRun> {
    const fetcher = this.cfg.fetcher ?? fetch;
    const url = `${this.cfg.baseUrl.replace(/\/+$/, "")}/api/workflow/${encodeURIComponent(playbookId)}/execute`;

    const res = await fetcher(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.cfg.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        inputs: {
          owner: policy.owner,
          decisionId: decision.id,
          intent: decision.intent,
          rulesMatched: decision.rulesMatched,
          riskScore: decision.riskScore,
          reasons: decision.reasons,
        },
      }),
    });

    if (!res.ok) {
      throw new Error(
        `KeeperHub run failed (${res.status}): ${await summarizeErrorBody(res)}`,
      );
    }

    const data = (await res.json().catch(() => ({}))) as KeeperHubExecuteResponse;
    const runId = data.runId ?? data.id ?? data.executionId ?? "unknown";
    return { id: playbookId, runId };
  }
}
