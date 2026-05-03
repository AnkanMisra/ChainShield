import type { Decision, Policy } from "../core/types.js";

export interface GossipTransport {
  broadcast(decision: Decision, policy: Policy): Promise<void>;
}

export interface AxlGossipConfig {
  baseUrl: string;
  topic?: string;
  fetcher?: typeof fetch;
  logger?: Pick<Console, "log" | "warn">;
}

const DEFAULT_TOPIC = "chainshield.decisions";
const ERROR_BODY_MAX = 200;

// MCP-style publish endpoint exposed by the local AXL bridge at :9002.
// The exact path may need a one-line tweak when validated against a real
// running node; the rest of this module (auth-less POST, JSON body, soft
// failure) is stable across the documented AXL HTTP shape.
const PUBLISH_PATH = "/api/v1/mcp/publish";

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

export class AxlGossipTransport implements GossipTransport {
  private readonly baseUrl: string;
  private readonly topic: string;
  private readonly fetcher: typeof fetch;
  private readonly logger: Pick<Console, "log" | "warn">;

  constructor(cfg: AxlGossipConfig) {
    this.baseUrl = cfg.baseUrl.replace(/\/+$/, "");
    this.topic = cfg.topic ?? DEFAULT_TOPIC;
    this.fetcher = cfg.fetcher ?? fetch;
    this.logger = cfg.logger ?? console;
  }

  async broadcast(decision: Decision, policy: Policy): Promise<void> {
    const url = `${this.baseUrl}${PUBLISH_PATH}`;
    const body = JSON.stringify({
      topic: this.topic,
      payload: { decision, policy },
    });
    try {
      const res = await this.fetcher(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      if (!res.ok) {
        const summary = await summarizeErrorBody(res);
        this.logger.warn(
          `[axl] gossip publish failed (${res.status}): ${summary}`,
        );
      }
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      const safe = raw.replace(/\s+/g, " ").trim().slice(0, ERROR_BODY_MAX);
      this.logger.warn(`[axl] gossip publish threw: ${safe}`);
    }
  }
}
