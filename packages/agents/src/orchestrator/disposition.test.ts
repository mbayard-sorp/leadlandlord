import { describe, it, expect } from 'vitest';
import { agentRegistry } from '../registry';
import { FLEET_DISPOSITION, summarizeDisposition } from './disposition';

const KNOWN_EXTRAS = ['fleet-digest', 'orchestrator', 'backlink-copycat', 'citation-runner'];

describe('FLEET_DISPOSITION coverage', () => {
  it('covers every registry kind', () => {
    const missing = Object.keys(agentRegistry).filter((k) => !(k in FLEET_DISPOSITION));
    expect(missing).toEqual([]);
  });

  it('only contains registry kinds + the known extras', () => {
    const registry = new Set(Object.keys(agentRegistry));
    const stray = Object.keys(FLEET_DISPOSITION).filter(
      (k) => !registry.has(k) && !KNOWN_EXTRAS.includes(k),
    );
    expect(stray).toEqual([]);
  });

  it('includes the two new agents + two deferred stubs', () => {
    for (const k of KNOWN_EXTRAS) expect(FLEET_DISPOSITION[k]).toBeDefined();
  });
});

describe('summarizeDisposition (the intended split)', () => {
  const s = summarizeDisposition();

  it('matches the agreed disposition: 28 ON, 5 armed, 9 disabled', () => {
    expect(s.enabled).toHaveLength(28);
    expect(s.armed).toHaveLength(5);
    expect(s.disabled).toHaveLength(9);
    expect(s.enabled.length + s.armed.length + s.disabled.length).toBe(
      Object.keys(FLEET_DISPOSITION).length,
    );
  });

  it('arms exactly the human-triggered build chain + niche engine', () => {
    expect(new Set(s.armed)).toEqual(
      new Set([
        'niche-scout',
        'niche-validator',
        'site-builder',
        'domain-procurer',
        'tracking-setup',
      ]),
    );
  });

  it('disables all outbound + deferred agents', () => {
    for (const k of [
      'tenant-prospector',
      'outreach-agent',
      'billing-dunning',
      'molly-digest',
      'wave-launcher',
      'backlink-copycat',
    ]) {
      expect(s.disabled).toContain(k);
    }
    // citation-runner is now enabled (citations v1 pilot)
    expect(s.enabled).toContain('citation-runner');
  });

  it('keeps caps sane (armed site-builder $10, owned content-engine $8)', () => {
    expect(FLEET_DISPOSITION['site-builder']?.dailyCapUsd).toBe(10);
    expect(FLEET_DISPOSITION['content-engine']?.dailyCapUsd).toBe(8);
    expect(FLEET_DISPOSITION['content-engine']?.armed).toBeUndefined();
  });
});
