import { describe, it, expect } from 'vitest';
import { ClaudeCandidateSchema, computeScore } from './index';

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
// computeScore — safety clamp tests
// ─────────────────────────────────────────────────────────────────────────────

describe('computeScore', () => {
  const baseInputs = {
    search_volume: 1000,
    kd: 30,
    competition: 0.3,
    est_avg_job_value_usd: 500,
    est_close_rate: 0.35,
  };

  it('score with est_close_rate=0.02 differs from score with est_close_rate=0.1 (no inflation)', () => {
    const scoreAt002 = computeScore({ ...baseInputs, est_close_rate: 0.02 });
    const scoreAt01 = computeScore({ ...baseInputs, est_close_rate: 0.1 });
    // With the old floor of 0.1, both would be the same. Now they should differ.
    expect(scoreAt002).not.toEqual(scoreAt01);
    expect(isFinite(scoreAt002)).toBe(true);
  });

  it('score with negative est_avg_job_value_usd is non-negative', () => {
    const score = computeScore({ ...baseInputs, est_avg_job_value_usd: -100 });
    expect(score).toBeGreaterThanOrEqual(0);
  });
});
