import { describe, it, expect } from 'vitest';
import { getEffectiveAgentState } from './context';

describe('getEffectiveAgentState', () => {
  it('enabled + scheduled cadence -> active', () => {
    expect(getEffectiveAgentState(true, false, 'cron')).toBe('active');
    expect(getEffectiveAgentState(true, false, 'poll')).toBe('active');
  });
  it('enabled + paused -> demand_only', () => {
    expect(getEffectiveAgentState(true, true, 'cron')).toBe('demand_only');
  });
  it('enabled + event/manual cadence -> demand_only (runs on demand, not scheduled)', () => {
    expect(getEffectiveAgentState(true, false, 'event')).toBe('demand_only');
    expect(getEffectiveAgentState(true, false, 'manual')).toBe('demand_only');
    expect(getEffectiveAgentState(true, false, null)).toBe('demand_only');
  });
  it('not enabled -> disabled (regardless of paused/cadence)', () => {
    expect(getEffectiveAgentState(false, false, 'cron')).toBe('disabled');
    expect(getEffectiveAgentState(false, true, 'poll')).toBe('disabled');
  });
});
