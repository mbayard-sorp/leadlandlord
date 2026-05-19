import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClaudeCandidateSchema, computeScore } from './index';
import { isDenylisted, NICHE_DENYLIST } from './denylist';
import { checkAutoApprove } from '../approval-engine';
import { DEFAULT_WEIGHTS } from './scoring-config';

// ─────────────────────────────────────────────────────────────────────────────
// ClaudeCandidateSchema — schema validation tests
// ─────────────────────────────────────────────────────────────────────────────

const validCandidate = {
  niche: 'tree removal',
  city: 'Tucson',
  state: 'AZ',
  category: 'home_services',
  est_avg_job_value_usd: 800,
  est_close_rate: 0.35,
  rationale: 'High demand in desert climates with many mature trees and minimal chain competition.',
  confidence_score: 8,
  est_monthly_searches_low: 120,
  est_monthly_searches_high: 300,
};

describe('ClaudeCandidateSchema', () => {
  it('accepts a well-formed candidate', () => {
    const result = ClaudeCandidateSchema.safeParse(validCandidate);
    expect(result.success).toBe(true);
  });

  it('rejects an invalid category (medical)', () => {
    const result = ClaudeCandidateSchema.safeParse({ ...validCandidate, category: 'medical' });
    expect(result.success).toBe(false);
  });

  it('uppercases a lowercase state code', () => {
    const result = ClaudeCandidateSchema.safeParse({ ...validCandidate, state: 'tx' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.state).toBe('TX');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// computeScore — safety clamp + weight tests
// ─────────────────────────────────────────────────────────────────────────────

describe('computeScore', () => {
  const baseInputs = {
    search_volume: 1000,
    kd: 30,
    competition: 0.3,
    est_avg_job_value_usd: 500,
    est_close_rate: 0.35,
    ad_count: 3,
    weights: DEFAULT_WEIGHTS,
  };

  it('returns a finite non-negative number', () => {
    const score = computeScore(baseInputs);
    expect(isFinite(score)).toBe(true);
    expect(score).toBeGreaterThanOrEqual(0);
  });

  it('score with est_close_rate=0.02 differs from score with est_close_rate=0.1 (no inflation)', () => {
    const scoreAt002 = computeScore({ ...baseInputs, est_close_rate: 0.02 });
    const scoreAt01 = computeScore({ ...baseInputs, est_close_rate: 0.1 });
    expect(scoreAt002).not.toEqual(scoreAt01);
    expect(isFinite(scoreAt002)).toBe(true);
  });

  it('score with negative est_avg_job_value_usd is non-negative', () => {
    const score = computeScore({ ...baseInputs, est_avg_job_value_usd: -100 });
    expect(score).toBeGreaterThanOrEqual(0);
  });

  it('higher ad_count increases score', () => {
    const low = computeScore({ ...baseInputs, ad_count: 0 });
    const high = computeScore({ ...baseInputs, ad_count: 10 });
    expect(high).toBeGreaterThan(low);
  });

  it('ad_count capped at 10 — score does not grow beyond cap', () => {
    const at10 = computeScore({ ...baseInputs, ad_count: 10 });
    const at20 = computeScore({ ...baseInputs, ad_count: 20 });
    // ad_count / 10 is capped at 1 in computeScore, so both should produce the same result
    // (the cap happens inside getPaidAdCount; computeScore receives already-capped value)
    expect(at10).toBeCloseTo(at20, 5);
  });

  it('custom weights shift score proportionally', () => {
    const defaultScore = computeScore(baseInputs);
    const heavyDemand = computeScore({
      ...baseInputs,
      weights: { ...DEFAULT_WEIGHTS, demand: 0.80, serp_difficulty: 0.05, ad_presence: 0.05, city_size_fit: 0.05, niche_risk: 0.05 },
    });
    // With demand=0.80 and search_volume=1000, heavy demand weight should differ.
    expect(defaultScore).not.toBeCloseTo(heavyDemand, 1);
  });

  it('scores are 0-100 range for typical inputs', () => {
    const score = computeScore(baseInputs);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// isDenylisted — denylist filter tests
// ─────────────────────────────────────────────────────────────────────────────

describe('isDenylisted', () => {
  it('locksmith is denylisted', () => {
    expect(isDenylisted('locksmith')).toBe(true);
  });

  it('emergency locksmith is denylisted (substring match)', () => {
    expect(isDenylisted('emergency locksmith services')).toBe(true);
  });

  it('tree removal is allowed', () => {
    expect(isDenylisted('tree removal')).toBe(false);
  });

  it('junk removal is allowed', () => {
    expect(isDenylisted('junk removal')).toBe(false);
  });

  it('garage door is denylisted', () => {
    expect(isDenylisted('garage door repair')).toBe(true);
  });

  it('garage doors is denylisted', () => {
    expect(isDenylisted('garage doors installation')).toBe(true);
  });

  it('security camera is denylisted', () => {
    expect(isDenylisted('security camera installation')).toBe(true);
  });

  it('alarm is denylisted', () => {
    expect(isDenylisted('alarm system installation')).toBe(true);
  });

  it('key duplication is denylisted', () => {
    expect(isDenylisted('key duplication')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isDenylisted('LOCKSMITH')).toBe(true);
    expect(isDenylisted('Garage Door')).toBe(true);
  });

  it('concrete patio installation is allowed', () => {
    expect(isDenylisted('concrete patio installation')).toBe(false);
  });

  it('NICHE_DENYLIST has at least 8 entries', () => {
    expect(NICHE_DENYLIST.length).toBeGreaterThanOrEqual(8);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// checkAutoApprove — approval engine tests (mocked DB)
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('@leadlandlord/db', () => {
  return {
    getDb: vi.fn(),
    autoApproveRules: { kind: 'kind', active: 'active', id: 'id', approvedCount: 'approvedCount' },
    niches: {
      niche: 'niche', city: 'city', state: 'state', id: 'id',
    },
    agentApprovals: {},
    eq: (a: unknown, b: unknown) => ({ type: 'eq', a, b }),
    and: (...args: unknown[]) => ({ type: 'and', args }),
  };
});

function makeMockDb(rules: Array<{ id: string; kind: string; matcher: unknown; active: boolean; approvedCount: number }>) {
  const updateChain = {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(undefined),
  };
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(rules),
      }),
    }),
    update: vi.fn().mockReturnValue(updateChain),
  };
}

describe('checkAutoApprove', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns matched=false when no rules exist', async () => {
    const db = makeMockDb([]);
    const result = await checkAutoApprove('niche_candidate', { score: 80 }, db as never);
    expect(result.matched).toBe(false);
    expect(result.ruleId).toBeUndefined();
  });

  it('matches a $gte rule when score meets threshold', async () => {
    const db = makeMockDb([
      { id: 'rule-1', kind: 'niche_candidate', matcher: { score: { $gte: 70 } }, active: true, approvedCount: 0 },
    ]);
    const result = await checkAutoApprove('niche_candidate', { score: 80 }, db as never);
    expect(result.matched).toBe(true);
    expect(result.ruleId).toBe('rule-1');
  });

  it('does not match a $gte rule when score is below threshold', async () => {
    const db = makeMockDb([
      { id: 'rule-1', kind: 'niche_candidate', matcher: { score: { $gte: 90 } }, active: true, approvedCount: 0 },
    ]);
    const result = await checkAutoApprove('niche_candidate', { score: 80 }, db as never);
    expect(result.matched).toBe(false);
  });

  it('matches a $lte rule', async () => {
    const db = makeMockDb([
      { id: 'rule-2', kind: 'niche_candidate', matcher: { kd: { $lte: 30 } }, active: true, approvedCount: 0 },
    ]);
    const result = await checkAutoApprove('niche_candidate', { kd: 25 }, db as never);
    expect(result.matched).toBe(true);
  });

  it('matches a $eq rule', async () => {
    const db = makeMockDb([
      { id: 'rule-3', kind: 'niche_candidate', matcher: { state: { $eq: 'TX' } }, active: true, approvedCount: 0 },
    ]);
    const result = await checkAutoApprove('niche_candidate', { state: 'TX' }, db as never);
    expect(result.matched).toBe(true);
  });

  it('does not match $eq when value differs', async () => {
    const db = makeMockDb([
      { id: 'rule-3', kind: 'niche_candidate', matcher: { state: { $eq: 'TX' } }, active: true, approvedCount: 0 },
    ]);
    const result = await checkAutoApprove('niche_candidate', { state: 'AZ' }, db as never);
    expect(result.matched).toBe(false);
  });

  it('matches multi-predicate rule when all conditions pass', async () => {
    const db = makeMockDb([
      {
        id: 'rule-4',
        kind: 'niche_candidate',
        matcher: { score: { $gte: 60 }, kd: { $lte: 30 } },
        active: true,
        approvedCount: 0,
      },
    ]);
    const result = await checkAutoApprove('niche_candidate', { score: 75, kd: 20 }, db as never);
    expect(result.matched).toBe(true);
  });

  it('does not match multi-predicate rule when one condition fails', async () => {
    const db = makeMockDb([
      {
        id: 'rule-4',
        kind: 'niche_candidate',
        matcher: { score: { $gte: 60 }, kd: { $lte: 30 } },
        active: true,
        approvedCount: 0,
      },
    ]);
    const result = await checkAutoApprove('niche_candidate', { score: 75, kd: 40 }, db as never);
    expect(result.matched).toBe(false);
  });

  it('increments approvedCount when rule matches', async () => {
    const db = makeMockDb([
      { id: 'rule-1', kind: 'niche_candidate', matcher: { score: { $gte: 70 } }, active: true, approvedCount: 5 },
    ]);
    await checkAutoApprove('niche_candidate', { score: 80 }, db as never);
    expect(db.update).toHaveBeenCalled();
  });
});
