import type { Decision, PlaybookRun, Policy } from "../core/types.js";

export interface PlaybookRunner {
  run(playbookId: string, decision: Decision, policy: Policy): Promise<PlaybookRun>;
}

export interface NotificationChannel {
  notify(message: string, decision: Decision): Promise<void>;
}

export class MockRunner implements PlaybookRunner {
  public readonly invocations: Array<{
    playbookId: string;
    decisionId: string;
    policyId: string;
  }> = [];

  constructor(
    private readonly behavior: {
      runIdPrefix?: string;
      failPlaybookIds?: string[];
    } = {},
  ) {}

  async run(playbookId: string, decision: Decision, policy: Policy): Promise<PlaybookRun> {
    if (this.behavior.failPlaybookIds?.includes(playbookId)) {
      throw new Error(`MockRunner: forced failure for playbook ${playbookId}`);
    }
    this.invocations.push({
      playbookId,
      decisionId: decision.id,
      policyId: policy.id,
    });
    const prefix = this.behavior.runIdPrefix ?? "mock-run";
    return { id: playbookId, runId: `${prefix}-${this.invocations.length}` };
  }
}
