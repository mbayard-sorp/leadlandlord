export class NotImplementedError extends Error {
  readonly code = 'NOT_IMPLEMENTED';
  constructor(stage: string) {
    super(`${stage} is not implemented yet (stubbed for a future phase).`);
    this.name = 'NotImplementedError';
  }
}

export class BudgetExceededError extends Error {
  readonly code = 'BUDGET_EXCEEDED';
  constructor(agent: string, capUsd: number) {
    super(`Agent "${agent}" exceeded its daily budget cap of $${capUsd.toFixed(2)}.`);
    this.name = 'BudgetExceededError';
  }
}

export class AgentRunError extends Error {
  readonly code = 'AGENT_RUN_ERROR';
  constructor(
    public readonly agent: string,
    message: string,
    public readonly underlying?: unknown,
  ) {
    super(message);
    this.name = 'AgentRunError';
  }
}

export class IntegrationError extends Error {
  readonly code = 'INTEGRATION_ERROR';
  constructor(
    public readonly provider: string,
    message: string,
    public readonly status?: number,
    public readonly body?: unknown,
  ) {
    super(`[${provider}] ${message}`);
    this.name = 'IntegrationError';
  }
}
