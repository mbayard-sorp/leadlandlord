import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import {
  AgentRunError,
  AgentDisabledError,
  BudgetExceededError,
  ComplianceBlockedError,
  KillSwitchActiveError,
  GlobalBudgetExceededError,
  NotImplementedError,
  ThinNicheError,
  UpstreamUnavailableError,
} from '@leadlandlord/shared/errors';
import { classifyAgentError } from './error-classify';

describe('classifyAgentError', () => {
  it('classifies a raw ZodError as validation_error', () => {
    expect(classifyAgentError(new ZodError([]))).toBe('validation_error');
  });

  it('classifies AgentDisabledError as agent_disabled', () => {
    expect(classifyAgentError(new AgentDisabledError('content-engine'))).toBe('agent_disabled');
  });

  it('classifies KillSwitchActiveError as kill_switch', () => {
    expect(classifyAgentError(new KillSwitchActiveError('site-builder', 'spend spike'))).toBe(
      'kill_switch',
    );
  });

  it('unwraps a KillSwitchActiveError wrapped in AgentRunError', () => {
    const wrapped = new AgentRunError(
      'site-builder',
      'run failed',
      new KillSwitchActiveError('site-builder'),
    );
    expect(classifyAgentError(wrapped)).toBe('kill_switch');
  });

  it('unwraps a NotImplementedError wrapped in AgentRunError', () => {
    const wrapped = new AgentRunError('x', 'fail', new NotImplementedError('hero'));
    expect(classifyAgentError(wrapped)).toBe('not_implemented');
  });

  it('classifies GlobalBudgetExceededError as global_budget', () => {
    expect(classifyAgentError(new GlobalBudgetExceededError(50))).toBe('global_budget');
  });

  it('unwraps a GlobalBudgetExceededError wrapped in AgentRunError', () => {
    const wrapped = new AgentRunError('content-engine', 'fail', new GlobalBudgetExceededError(40));
    expect(classifyAgentError(wrapped)).toBe('global_budget');
  });

  it('falls back to runtime_error for unknown errors', () => {
    expect(classifyAgentError(new Error('boom'))).toBe('runtime_error');
  });

  // New error class mappings (Phase 2 hardening).

  it('classifies BudgetExceededError as budget_exceeded (raw, not wrapped)', () => {
    // base.ts re-throws BudgetExceededError RAW at every level — it never
    // arrives wrapped in AgentRunError. Verify raw path.
    expect(classifyAgentError(new BudgetExceededError('site-builder', 5))).toBe('budget_exceeded');
  });

  it('classifies BudgetExceededError wrapped in AgentRunError as budget_exceeded', () => {
    // Defensive: if a caller wraps it, the single-level unwrap must still catch it.
    const wrapped = new AgentRunError('site-builder', 'budget', new BudgetExceededError('site-builder', 5));
    expect(classifyAgentError(wrapped)).toBe('budget_exceeded');
  });

  it('classifies ComplianceBlockedError wrapped in AgentRunError as compliance_blocked', () => {
    // Normal path: thrown inside execute(), single-wrapped by BaseAgent.
    const blocked = new ComplianceBlockedError('site-abc', [{ slug: 'home', rule: 'no_fake_reviews', message: 'found fake review' }]);
    const wrapped = new AgentRunError('site-builder', 'compliance blocked', blocked);
    expect(classifyAgentError(wrapped)).toBe('compliance_blocked');
  });

  it('classifies ComplianceBlockedError raw as compliance_blocked (defensive)', () => {
    // Defensive path: if thrown without wrapping.
    const blocked = new ComplianceBlockedError('site-abc', []);
    expect(classifyAgentError(blocked)).toBe('compliance_blocked');
  });

  it('classifies ThinNicheError as content_quality (raw)', () => {
    expect(classifyAgentError(new ThinNicheError('only 3 keyword candidates'))).toBe('content_quality');
  });

  it('classifies ThinNicheError wrapped in AgentRunError as content_quality', () => {
    const wrapped = new AgentRunError('keyword-planner', 'thin niche', new ThinNicheError('2 candidates'));
    expect(classifyAgentError(wrapped)).toBe('content_quality');
  });

  it('classifies UpstreamUnavailableError as runtime_error (raw)', () => {
    // Transient provider outage — retryable.
    expect(classifyAgentError(new UpstreamUnavailableError('dataforseo', 'all seeds errored'))).toBe('runtime_error');
  });

  it('classifies UpstreamUnavailableError wrapped in AgentRunError as runtime_error', () => {
    const wrapped = new AgentRunError('keyword-planner', 'upstream down', new UpstreamUnavailableError('dataforseo', 'timeout'));
    expect(classifyAgentError(wrapped)).toBe('runtime_error');
  });
});
