import { describe, expect, it } from 'vitest';
import { evaluateTransition, type WaveSignals, type WaveStateName } from '../state-machine';

// ────────────────────────────────────────────────────────────
// Fixtures
// ────────────────────────────────────────────────────────────

const NOW = new Date('2026-05-20T12:00:00Z');
const AGING_UNTIL_PAST = new Date('2026-05-10T12:00:00Z');
const AGING_UNTIL_FUTURE = new Date('2026-05-28T12:00:00Z');

const SITE_IDS = ['site-a', 'site-b', 'site-c'];

function makeSignals(overrides: Partial<WaveSignals> = {}): WaveSignals {
  return {
    approvedCandidateCount: 3,
    siteCount: 3,
    builtSiteCount: 3,
    agingUntil: AGING_UNTIL_PAST,
    now: NOW,
    indexedSiteCount: 3,
    linkPlacementsPerSite: { 'site-a': 2, 'site-b': 2, 'site-c': 2 },
    backlinksPerSite: { 'site-a': 0, 'site-b': 0, 'site-c': 0 },
    monitoringWeeksElapsed: 4,
    ...overrides,
  };
}

// ────────────────────────────────────────────────────────────
// draft → launching
// ────────────────────────────────────────────────────────────

describe('draft → launching', () => {
  it('advances when 3-5 sites and all candidates approved', () => {
    const result = evaluateTransition('draft', makeSignals());
    expect(result.toState).toBe('launching');
    expect(result.blockers).toHaveLength(0);
  });

  it('blocks when siteCount < 3', () => {
    const result = evaluateTransition('draft', makeSignals({ siteCount: 2, approvedCandidateCount: 2 }));
    expect(result.toState).toBeNull();
    expect(result.blockers.some((b) => b.includes('need 3-5 sites'))).toBe(true);
    expect(result.blockers.some((b) => b.includes('have 2'))).toBe(true);
  });

  it('blocks when siteCount > 5', () => {
    const result = evaluateTransition(
      'draft',
      makeSignals({ siteCount: 6, approvedCandidateCount: 6 }),
    );
    expect(result.toState).toBeNull();
    expect(result.blockers.some((b) => b.includes('need 3-5 sites'))).toBe(true);
    expect(result.blockers.some((b) => b.includes('have 6'))).toBe(true);
  });

  it('blocks when approvedCandidateCount < siteCount', () => {
    const result = evaluateTransition(
      'draft',
      makeSignals({ siteCount: 4, approvedCandidateCount: 2 }),
    );
    expect(result.toState).toBeNull();
    expect(result.blockers.some((b) => b.includes('approved candidates'))).toBe(true);
  });

  it('advances at exactly 5 sites', () => {
    const result = evaluateTransition(
      'draft',
      makeSignals({ siteCount: 5, approvedCandidateCount: 5 }),
    );
    expect(result.toState).toBe('launching');
  });
});

// ────────────────────────────────────────────────────────────
// launching → aging
// ────────────────────────────────────────────────────────────

describe('launching → aging', () => {
  it('advances when all sites built', () => {
    const result = evaluateTransition('launching', makeSignals({ builtSiteCount: 3, siteCount: 3 }));
    expect(result.toState).toBe('aging');
    expect(result.blockers).toHaveLength(0);
  });

  it('blocks when some sites still building', () => {
    const result = evaluateTransition('launching', makeSignals({ builtSiteCount: 2, siteCount: 3 }));
    expect(result.toState).toBeNull();
    expect(result.blockers.some((b) => b.includes('2/3'))).toBe(true);
  });

  it('blocks when no sites built', () => {
    const result = evaluateTransition('launching', makeSignals({ builtSiteCount: 0, siteCount: 3 }));
    expect(result.toState).toBeNull();
    expect(result.blockers).toHaveLength(1);
  });
});

// ────────────────────────────────────────────────────────────
// aging → linking
// ────────────────────────────────────────────────────────────

describe('aging → linking', () => {
  it('advances when agingUntil passed and all sites indexed', () => {
    const result = evaluateTransition('aging', makeSignals());
    expect(result.toState).toBe('linking');
    expect(result.blockers).toHaveLength(0);
  });

  it('blocks when agingUntil is null', () => {
    const result = evaluateTransition('aging', makeSignals({ agingUntil: null }));
    expect(result.toState).toBeNull();
    expect(result.blockers.some((b) => b.includes('agingUntil not set'))).toBe(true);
  });

  it('blocks when agingUntil is in the future', () => {
    const result = evaluateTransition(
      'aging',
      makeSignals({ agingUntil: AGING_UNTIL_FUTURE }),
    );
    expect(result.toState).toBeNull();
    expect(result.blockers.some((b) => b.includes('2026-05-28'))).toBe(true);
    expect(result.blockers.some((b) => b.includes('2026-05-20'))).toBe(true);
  });

  it('blocks when not all sites indexed', () => {
    const result = evaluateTransition(
      'aging',
      makeSignals({ indexedSiteCount: 2, siteCount: 3 }),
    );
    expect(result.toState).toBeNull();
    expect(result.blockers.some((b) => b.includes('2/3 indexed'))).toBe(true);
  });

  it('blocks on both conditions when agingUntil future and not indexed', () => {
    const result = evaluateTransition(
      'aging',
      makeSignals({ agingUntil: AGING_UNTIL_FUTURE, indexedSiteCount: 1, siteCount: 3 }),
    );
    expect(result.toState).toBeNull();
    expect(result.blockers).toHaveLength(2);
  });
});

// ────────────────────────────────────────────────────────────
// linking → backlinking
// ────────────────────────────────────────────────────────────

describe('linking → backlinking', () => {
  it('advances when all sites have >= 2 link placements', () => {
    const result = evaluateTransition('linking', makeSignals());
    expect(result.toState).toBe('backlinking');
    expect(result.blockers).toHaveLength(0);
  });

  it('blocks when a site has < 2 placements', () => {
    const result = evaluateTransition(
      'linking',
      makeSignals({
        linkPlacementsPerSite: { 'site-a': 2, 'site-b': 1, 'site-c': 2 },
      }),
    );
    expect(result.toState).toBeNull();
    expect(result.blockers.some((b) => b.includes('site-b'))).toBe(true);
  });

  it('blocks when multiple sites under threshold', () => {
    const result = evaluateTransition(
      'linking',
      makeSignals({
        linkPlacementsPerSite: { 'site-a': 0, 'site-b': 1, 'site-c': 2 },
      }),
    );
    expect(result.toState).toBeNull();
    expect(result.blockers.some((b) => b.includes('2 site(s)'))).toBe(true);
  });

  it('advances when placements are exactly 2', () => {
    const result = evaluateTransition(
      'linking',
      makeSignals({
        linkPlacementsPerSite: { 'site-a': 2, 'site-b': 2, 'site-c': 2 },
      }),
    );
    expect(result.toState).toBe('backlinking');
  });
});

// ────────────────────────────────────────────────────────────
// backlinking → monitoring
// ────────────────────────────────────────────────────────────

describe('backlinking → monitoring', () => {
  it('advances with skipBacklinks evidence when no backlinks exist (stub path)', () => {
    const result = evaluateTransition(
      'backlinking',
      makeSignals({ backlinksPerSite: { 'site-a': 0, 'site-b': 0, 'site-c': 0 } }),
    );
    expect(result.toState).toBe('monitoring');
    expect(result.blockers).toHaveLength(0);
    expect(result.evidence.skipBacklinks).toBe(true);
    expect(typeof result.evidence.reason).toBe('string');
  });

  it('advances without skipBacklinks when all sites have >= 1 backlink', () => {
    const result = evaluateTransition(
      'backlinking',
      makeSignals({ backlinksPerSite: { 'site-a': 1, 'site-b': 2, 'site-c': 1 } }),
    );
    expect(result.toState).toBe('monitoring');
    expect(result.blockers).toHaveLength(0);
    expect(result.evidence.skipBacklinks).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────
// monitoring → completed
// ────────────────────────────────────────────────────────────

describe('monitoring → completed', () => {
  it('advances when >= 4 weeks elapsed', () => {
    const result = evaluateTransition('monitoring', makeSignals({ monitoringWeeksElapsed: 4 }));
    expect(result.toState).toBe('completed');
    expect(result.blockers).toHaveLength(0);
  });

  it('advances when more than 4 weeks elapsed', () => {
    const result = evaluateTransition('monitoring', makeSignals({ monitoringWeeksElapsed: 6 }));
    expect(result.toState).toBe('completed');
  });

  it('blocks when < 4 weeks elapsed', () => {
    const result = evaluateTransition('monitoring', makeSignals({ monitoringWeeksElapsed: 2 }));
    expect(result.toState).toBeNull();
    expect(result.blockers.some((b) => b.includes('2/4 weeks'))).toBe(true);
  });

  it('blocks at 0 weeks elapsed', () => {
    const result = evaluateTransition('monitoring', makeSignals({ monitoringWeeksElapsed: 0 }));
    expect(result.toState).toBeNull();
    expect(result.blockers.some((b) => b.includes('0/4 weeks'))).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────
// completed (terminal)
// ────────────────────────────────────────────────────────────

describe('completed state', () => {
  it('never advances from completed', () => {
    const result = evaluateTransition('completed', makeSignals());
    expect(result.toState).toBeNull();
    expect(result.blockers.some((b) => b.includes('already completed'))).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────
// evidence shape
// ────────────────────────────────────────────────────────────

describe('evidence shape', () => {
  it('includes relevant signal fields in draft evidence', () => {
    const result = evaluateTransition('draft', makeSignals());
    expect(result.evidence).toHaveProperty('approvedCandidateCount');
    expect(result.evidence).toHaveProperty('siteCount');
  });

  it('includes agingUntil in aging evidence', () => {
    const result = evaluateTransition('aging', makeSignals());
    expect(result.evidence).toHaveProperty('agingUntil');
  });

  it('includes linkPlacementsPerSite in linking evidence', () => {
    const result = evaluateTransition('linking', makeSignals());
    expect(result.evidence).toHaveProperty('linkPlacementsPerSite');
  });

  it('includes monitoringWeeksElapsed in monitoring evidence', () => {
    const result = evaluateTransition('monitoring', makeSignals());
    expect(result.evidence).toHaveProperty('monitoringWeeksElapsed');
  });
});

// Suppress unused import warning — SITE_IDS used as documentation fixture.
void SITE_IDS;
