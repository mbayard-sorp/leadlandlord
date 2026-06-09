import { describe, it, expect } from 'vitest';
import {
  selectAgentsToDisable,
  isOrchestratorEnabled,
  CONSECUTIVE_FAILURE_DISABLE_THRESHOLD,
  NEVER_AUTO_DISABLE,
} from './supervisor';
import type { FleetHealthRow } from './context';

function row(partial: Partial<FleetHealthRow> & { agent: string }): FleetHealthRow {
  return {
    enabled: true,
    consecutiveFailures: 0,
    auditStatus: 'pass',
    lastError: null,
    ...partial,
  };
}

describe('selectAgentsToDisable', () => {
  it('disables an enabled agent at/over the threshold', () => {
    const out = selectAgentsToDisable([
      row({ agent: 'competitor-analyzer', consecutiveFailures: CONSECUTIVE_FAILURE_DISABLE_THRESHOLD }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.agent).toBe('competitor-analyzer');
    expect(out[0]?.kind).toBe('disable_agent');
  });

  it('leaves agents below the threshold alone', () => {
    const out = selectAgentsToDisable([row({ agent: 'seo-operator', consecutiveFailures: 2 })]);
    expect(out).toHaveLength(0);
  });

  it('never disables an already-disabled agent (no churn)', () => {
    const out = selectAgentsToDisable([
      row({ agent: 'keyword-planner', enabled: false, consecutiveFailures: 9 }),
    ]);
    expect(out).toHaveLength(0);
  });

  it('never auto-disables the operator / orchestrator / fleet-digest', () => {
    const rows = [...NEVER_AUTO_DISABLE].map((agent) => row({ agent, consecutiveFailures: 10 }));
    expect(selectAgentsToDisable(rows)).toHaveLength(0);
  });

  it('includes the failure count + last error in the reason', () => {
    const out = selectAgentsToDisable([
      row({ agent: 'lighthouse-audit', consecutiveFailures: 5, lastError: 'PageSpeed 500' }),
    ]);
    expect(out[0]?.reason).toMatch(/5 consecutive failures/);
    expect(out[0]?.reason).toMatch(/PageSpeed 500/);
  });

  it('honors a custom threshold', () => {
    const rows = [row({ agent: 'maintenance', consecutiveFailures: 2 })];
    expect(selectAgentsToDisable(rows, 2)).toHaveLength(1);
    expect(selectAgentsToDisable(rows, 5)).toHaveLength(0);
  });
});

describe('isOrchestratorEnabled (master switch; gates the supervisory pass)', () => {
  it('defaults to ON when no budget row exists', () => {
    expect(isOrchestratorEnabled(undefined)).toBe(true);
  });
  it('is ON when the row is enabled', () => {
    expect(isOrchestratorEnabled({ enabled: true })).toBe(true);
  });
  it('is OFF when the row is disabled (the toggle)', () => {
    expect(isOrchestratorEnabled({ enabled: false })).toBe(false);
  });
});
