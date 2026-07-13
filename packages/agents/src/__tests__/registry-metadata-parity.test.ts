import { describe, it, expect } from 'vitest';
import { agentRegistry } from '../registry';
import { agentMetadata } from '../metadata';

/**
 * BL-022: the operator agents page (apps/operator/app/operator/agents/page.tsx)
 * renders `agentMetadata[name]?.description ?? ''` for every key in
 * `agentRegistry`. A registry entry with no matching metadata silently renders
 * a blank description. This test keeps the two maps in lockstep so the drift
 * can never recur unnoticed.
 */
describe('agentRegistry / agentMetadata parity', () => {
  it('every registered agent has a metadata entry', () => {
    const missing = Object.keys(agentRegistry).filter((name) => !(name in agentMetadata));
    expect(missing).toEqual([]);
  });

  it('every metadata entry maps to a registered agent (no orphans)', () => {
    const orphaned = Object.keys(agentMetadata).filter((name) => !(name in agentRegistry));
    expect(orphaned).toEqual([]);
  });
});
