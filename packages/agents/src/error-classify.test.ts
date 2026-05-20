import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import {
  AgentRunError,
  AgentDisabledError,
  KillSwitchActiveError,
  NotImplementedError,
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

  it('falls back to runtime_error for unknown errors', () => {
    expect(classifyAgentError(new Error('boom'))).toBe('runtime_error');
  });
});
