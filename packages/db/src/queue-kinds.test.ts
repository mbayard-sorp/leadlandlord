import { describe, it, expect } from 'vitest';
import { TERMINAL_KINDS, RELEASE_WITHOUT_ATTEMPT_KINDS } from './queue';

// Locks the orchestrator Phase 2 invariant: a portfolio-wide budget pause
// (global_budget) backs off and resumes — it must never dead-letter.
describe('queue failure-kind classification sets', () => {
  it('global_budget releases the lease without consuming an attempt (like kill_switch)', () => {
    expect(RELEASE_WITHOUT_ATTEMPT_KINDS.has('global_budget')).toBe(true);
    expect(RELEASE_WITHOUT_ATTEMPT_KINDS.has('kill_switch')).toBe(true);
  });

  it('global_budget never dead-letters (not terminal)', () => {
    expect(TERMINAL_KINDS.has('global_budget')).toBe(false);
  });

  it('release-without-attempt and terminal sets are disjoint', () => {
    for (const k of RELEASE_WITHOUT_ATTEMPT_KINDS) {
      expect(TERMINAL_KINDS.has(k)).toBe(false);
    }
  });

  it('runtime_error backs off (neither terminal nor released)', () => {
    expect(TERMINAL_KINDS.has('runtime_error')).toBe(false);
    expect(RELEASE_WITHOUT_ATTEMPT_KINDS.has('runtime_error')).toBe(false);
  });

  it('deterministic kinds still dead-letter', () => {
    for (const k of ['validation_error', 'unknown_agent', 'not_implemented', 'agent_disabled'] as const) {
      expect(TERMINAL_KINDS.has(k)).toBe(true);
    }
  });
});
