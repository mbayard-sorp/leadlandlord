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
    super(`Agent "${agent}" exceeded its budget cap of $${capUsd.toFixed(2)}.`);
    this.name = 'BudgetExceededError';
  }
}

export class GlobalBudgetExceededError extends Error {
  readonly code = 'GLOBAL_BUDGET_EXCEEDED';
  constructor(capUsd: number) {
    super(
      `Portfolio-wide daily spend cap of $${capUsd.toFixed(2)} reached; pausing agent work until the next UTC day.`,
    );
    this.name = 'GlobalBudgetExceededError';
  }
}

export class KillSwitchActiveError extends Error {
  readonly code = 'KILL_SWITCH_ACTIVE';
  constructor(agent: string, reason?: string | null) {
    super(
      `Agent "${agent}" refused to run: portfolio kill switch is active${reason ? ` (${reason})` : ''}.`,
    );
    this.name = 'KillSwitchActiveError';
  }
}

export class AgentDisabledError extends Error {
  readonly code = 'AGENT_DISABLED';
  constructor(agent: string) {
    super(`Agent "${agent}" is disabled (agent_budgets.enabled = false).`);
    this.name = 'AgentDisabledError';
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

/**
 * Thrown by compliance-guard inside site-builder.execute when one or more
 * content pages fail a compliance rule. Terminal — the build is blocked until
 * the operator fixes the content or overrides the rule. Surfaces as
 * FailureKind='compliance_blocked' in agent_events (TERMINAL_KINDS).
 *
 * `failures` is a list of per-page violations so the operator UI can show
 * exactly which slugs need attention.
 */
export class ComplianceBlockedError extends Error {
  readonly code = 'COMPLIANCE_BLOCKED';
  constructor(
    public readonly siteId: string,
    public readonly failures: Array<{ slug: string; rule: string; message: string }>,
  ) {
    super(
      `Site "${siteId}" blocked by compliance check: ${failures.map((f) => `[${f.slug}] ${f.rule} — ${f.message}`).join('; ')}`,
    );
    this.name = 'ComplianceBlockedError';
  }
}

/**
 * Thrown by keyword-planner when the niche has fewer than 5 keyword
 * candidates even though DataForSEO is healthy. Signals a thin-market niche
 * rather than a transient API failure. CAUGHT by site-builder (build proceeds
 * with empty clusters). Surfaces as FailureKind='content_quality' (TERMINAL_KINDS).
 */
export class ThinNicheError extends Error {
  readonly code = 'THIN_NICHE';
  constructor(message: string) {
    super(message);
    this.name = 'ThinNicheError';
  }
}

/**
 * Thrown by content-engine ONLY when there is no publishable bundle to fall
 * back on — i.e. the *initial* generation stream timed out or the model never
 * invoked the output tool, so no Zod-valid ContentBundle ever existed. The
 * density-lint *retry* failing is NOT this case: that path degrades gracefully
 * and publishes the initial bundle (see content-engine/index.ts).
 *
 * Classified as FailureKind='content_quality' (TERMINAL_KINDS) so the event
 * dead-letters on attempt 1 — a labeled, one-click-Retry dead-letter instead of
 * a 5× retry storm. Recovery is the operator Retry button / scripts/finish-site.ts.
 */
export class DensityLintExhaustedError extends Error {
  readonly code = 'DENSITY_LINT_EXHAUSTED';
  constructor(
    message: string,
    public readonly siteId?: string,
    public readonly failedPages?: string[],
  ) {
    super(message);
    this.name = 'DensityLintExhaustedError';
  }
}

/**
 * Thrown by keyword-planner (and other integration-heavy agents) when the
 * upstream provider is down or all seed queries errored. Distinguishes a
 * provider outage from a thin-market signal. NOT caught by site-builder —
 * propagates upward and is classified as 'runtime_error' (retryable).
 */
export class UpstreamUnavailableError extends Error {
  readonly code = 'UPSTREAM_UNAVAILABLE';
  constructor(
    public readonly service: string,
    message: string,
  ) {
    super(`[${service}] ${message}`);
    this.name = 'UpstreamUnavailableError';
  }
}
