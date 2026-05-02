import type { Decision } from "../core/types.js";
import type { NotificationChannel } from "./runner.js";

export class CollectorChannel implements NotificationChannel {
  public readonly messages: Array<{ message: string; decisionId: string; verdict: Decision["verdict"] }> = [];

  async notify(message: string, decision: Decision): Promise<void> {
    this.messages.push({
      message,
      decisionId: decision.id,
      verdict: decision.verdict,
    });
  }
}

export interface WebhookChannelOptions {
  url: string;
  fetcher?: typeof fetch;
  contentTemplate?: (message: string, decision: Decision) => unknown;
}

export class WebhookChannel implements NotificationChannel {
  constructor(private readonly opts: WebhookChannelOptions) {}

  async notify(message: string, decision: Decision): Promise<void> {
    const fetcher = this.opts.fetcher ?? fetch;
    const body = this.opts.contentTemplate
      ? this.opts.contentTemplate(message, decision)
      : {
          content: `[ChainShield] ${message}`,
          embeds: [
            {
              title: `Decision ${decision.id.slice(0, 8)}`,
              fields: [
                { name: "Verdict", value: decision.verdict, inline: true },
                { name: "Risk", value: `${decision.riskScore}/100`, inline: true },
                {
                  name: "Rules matched",
                  value: decision.rulesMatched.length > 0 ? decision.rulesMatched.join(", ") : "none",
                },
                {
                  name: "Reasons",
                  value: decision.reasons.join("\n").slice(0, 1000) || "n/a",
                },
              ],
            },
          ],
        };

    const res = await fetcher(this.opts.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`WebhookChannel failed (${res.status})`);
    }
  }
}
