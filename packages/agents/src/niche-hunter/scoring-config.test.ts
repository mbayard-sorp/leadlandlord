import { describe, it, expect } from 'vitest';
import {
  evaluateApprovalDiversity,
  DEFAULT_APPROVE_MAX_PER_STATE_SHARE,
  resolveRefinedCityVolume,
  DFS_TRUST_FLOOR,
  computeSeasonalitySignal,
  dampenSeasonalVolume,
  SEASONALITY_DAMPENING_THRESHOLD,
} from './scoring-config';

describe('evaluateApprovalDiversity', () => {
  it('does not warn on an empty approved set (min-sample floor suppresses the state-share noise)', () => {
    const result = evaluateApprovalDiversity({
      trade: 'roofing',
      state: 'AZ',
      approvedRows: [],
    });
    // sameStateShare mechanically = (0+1)/(0+1) = 1.0, but the state trigger
    // is gated behind a minimum sample size so the very first approval in an
    // empty portfolio never warns.
    expect(result.sameStateShare).toBeCloseTo(1.0, 4);
    expect(result.stateTriggered).toBe(false);
    expect(result.tradeTriggered).toBe(false);
    expect(result.shouldWarn).toBe(false);
  });

  it('per-state share warning stays suppressed below the minimum sample size even with a skewed share', () => {
    // 1 of 2 approved is TX; approving another TX -> share 2/3 = 0.667 > 0.40,
    // but totalApprovedCount (2) is below APPROVE_STATE_SHARE_MIN_SAMPLE (3).
    const approvedRows = [
      { trade: 'roofing', state: 'TX' },
      { trade: 'plumbing', state: 'CA' },
    ];
    const result = evaluateApprovalDiversity({
      trade: 'landscaping',
      state: 'TX',
      approvedRows,
    });
    expect(result.sameStateShare).toBeCloseTo(2 / 3, 4);
    expect(result.stateTriggered).toBe(false);
    expect(result.shouldWarn).toBe(false);
  });

  it('same-trade warning: fires at exactly APPROVE_SAME_TRADE_WARNING_COUNT (3)', () => {
    const approvedRows = [
      { trade: 'roofing', state: 'TX' },
      { trade: 'roofing', state: 'NV' },
      { trade: 'roofing', state: 'CA' },
      { trade: 'plumbing', state: 'CA' },
      { trade: 'hvac', state: 'CA' },
      { trade: 'electrical', state: 'CA' },
    ];
    const result = evaluateApprovalDiversity({
      trade: 'roofing',
      state: 'AZ',
      approvedRows,
    });
    expect(result.sameTradeApprovedCount).toBe(3);
    expect(result.tradeTriggered).toBe(true);
    expect(result.shouldWarn).toBe(true);
  });

  it('same-trade warning: does not fire at 2 (below the threshold)', () => {
    const approvedRows = [
      { trade: 'roofing', state: 'TX' },
      { trade: 'roofing', state: 'NV' },
      { trade: 'plumbing', state: 'CA' },
      { trade: 'hvac', state: 'CA' },
      { trade: 'electrical', state: 'CA' },
    ];
    const result = evaluateApprovalDiversity({
      trade: 'roofing',
      state: 'AZ',
      approvedRows,
    });
    expect(result.sameTradeApprovedCount).toBe(2);
    expect(result.tradeTriggered).toBe(false);
    expect(result.shouldWarn).toBe(false);
  });

  it('trade match is case-insensitive', () => {
    const approvedRows = [
      { trade: 'Roofing', state: 'TX' },
      { trade: 'ROOFING', state: 'NV' },
      { trade: 'roofing', state: 'CA' },
    ];
    const result = evaluateApprovalDiversity({
      trade: 'ROOFing',
      state: 'AZ',
      approvedRows,
    });
    expect(result.sameTradeApprovedCount).toBe(3);
    expect(result.tradeTriggered).toBe(true);
  });

  it('per-state share warning: fires when the forward-looking share exceeds 40% (default)', () => {
    // 3 of 4 approved are already TX; approving a 4th TX niche -> (3+1)/(4+1) = 0.80 > 0.40.
    const approvedRows = [
      { trade: 'roofing', state: 'TX' },
      { trade: 'plumbing', state: 'TX' },
      { trade: 'hvac', state: 'TX' },
      { trade: 'electrical', state: 'CA' },
    ];
    const result = evaluateApprovalDiversity({
      trade: 'landscaping',
      state: 'TX',
      approvedRows,
    });
    expect(result.sameStateShare).toBeCloseTo(0.8, 4);
    expect(result.stateTriggered).toBe(true);
    expect(result.shouldWarn).toBe(true);
  });

  it('per-state share warning: does not fire when the forward-looking share stays under the cap', () => {
    // 1 of 4 approved is TX; approving a 2nd -> (1+1)/(4+1) = 0.40, NOT > 0.40 (strict inequality).
    const approvedRows = [
      { trade: 'roofing', state: 'TX' },
      { trade: 'plumbing', state: 'CA' },
      { trade: 'hvac', state: 'NV' },
      { trade: 'electrical', state: 'NM' },
    ];
    const result = evaluateApprovalDiversity({
      trade: 'landscaping',
      state: 'TX',
      approvedRows,
    });
    expect(result.sameStateShare).toBeCloseTo(0.4, 4);
    expect(result.stateTriggered).toBe(false);
    expect(result.shouldWarn).toBe(false);
  });

  it('state match is case-insensitive', () => {
    const approvedRows = [
      { trade: 'roofing', state: 'tx' },
      { trade: 'plumbing', state: 'Tx' },
      { trade: 'hvac', state: 'TX' },
    ];
    const result = evaluateApprovalDiversity({
      trade: 'landscaping',
      state: 'tx',
      approvedRows,
    });
    expect(result.sameStateApprovedCount).toBe(3);
  });

  it('respects a system_state override for maxPerStateShare', () => {
    const approvedRows = [
      { trade: 'roofing', state: 'TX' },
      { trade: 'plumbing', state: 'CA' },
      { trade: 'hvac', state: 'NV' },
    ];
    // Default cap (0.40): (1+1)/(3+1) = 0.50 > 0.40 -> would trigger.
    const withDefault = evaluateApprovalDiversity({
      trade: 'landscaping',
      state: 'TX',
      approvedRows,
    });
    expect(withDefault.stateTriggered).toBe(true);
    expect(withDefault.maxPerStateShare).toBe(DEFAULT_APPROVE_MAX_PER_STATE_SHARE);

    // Override to 0.80: 0.50 is no longer > 0.80 -> does not trigger.
    const withOverride = evaluateApprovalDiversity({
      trade: 'landscaping',
      state: 'TX',
      approvedRows,
      maxPerStateShare: 0.8,
    });
    expect(withOverride.stateTriggered).toBe(false);
    expect(withOverride.maxPerStateShare).toBe(0.8);
  });

  it('both triggers can fire simultaneously', () => {
    const approvedRows = [
      { trade: 'roofing', state: 'TX' },
      { trade: 'roofing', state: 'TX' },
      { trade: 'roofing', state: 'TX' },
    ];
    const result = evaluateApprovalDiversity({
      trade: 'roofing',
      state: 'TX',
      approvedRows,
    });
    expect(result.tradeTriggered).toBe(true);
    expect(result.stateTriggered).toBe(true);
    expect(result.shouldWarn).toBe(true);
  });
});

describe('resolveRefinedCityVolume (F3)', () => {
  it('trusts the measured volume when it clears the trust floor', () => {
    expect(resolveRefinedCityVolume(1000, 4000)).toBe(1000);
    expect(resolveRefinedCityVolume(DFS_TRUST_FLOOR, 4000)).toBe(DFS_TRUST_FLOOR);
  });

  it('clamps an inflated proxy to the floor when measured is sub-floor', () => {
    // The run 5d1ec782 pathology: proxy $-value from a 5000-ish volume vs a real
    // sub-100 market. The proxy must be clamped, not kept.
    expect(resolveRefinedCityVolume(40, 5000)).toBe(DFS_TRUST_FLOOR);
    expect(resolveRefinedCityVolume(90, 300)).toBe(DFS_TRUST_FLOOR);
  });

  it('keeps a proxy already at or below the floor (clamp never inflates)', () => {
    expect(resolveRefinedCityVolume(40, 60)).toBe(60);
    expect(resolveRefinedCityVolume(0, 25)).toBe(25);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Shared seasonality helpers (ADR 0030 M1) — single source of truth for
// validateNicheCore and the scout's Stage-3 measured-volume path.
// ─────────────────────────────────────────────────────────────────────────────

describe('computeSeasonalitySignal / dampenSeasonalVolume (ADR 0030 M1)', () => {
  it('empty series → null index/mean, never highly seasonal, dampen is a no-op', () => {
    const signal = computeSeasonalitySignal([]);
    expect(signal.seasonalityIndex).toBeNull();
    expect(signal.annualMean).toBeNull();
    expect(signal.isHighlySeasonal).toBe(false);
    expect(dampenSeasonalVolume(500, signal)).toBe(500);
  });

  it('flat demand → index near 1, not highly seasonal, no dampening', () => {
    const signal = computeSeasonalitySignal([100, 100, 100, 100]);
    expect(signal.seasonalityIndex).toBe(1);
    expect(signal.isHighlySeasonal).toBe(false);
    expect(dampenSeasonalVolume(400, signal)).toBe(400);
  });

  it('highly seasonal (snow removal shape) → dampens toward the annual mean', () => {
    // Peak 1000 in winter, trough 0 in summer → index 0 < 0.35 threshold.
    const monthly = [1000, 800, 300, 50, 0, 0, 0, 0, 50, 200, 600, 1000];
    const signal = computeSeasonalitySignal(monthly);
    expect(signal.seasonalityIndex).toBe(0);
    expect(signal.isHighlySeasonal).toBe(true);
    const mean = monthly.reduce((s, v) => s + v, 0) / monthly.length;
    expect(signal.annualMean).toBeCloseTo(mean, 6);
    // Peak-month measured volume 1000 → (1000 + mean) / 2, matching the exact
    // formula validateNicheCore has always applied.
    expect(dampenSeasonalVolume(1000, signal)).toBeCloseTo((1000 + mean) / 2, 6);
  });

  it('index exactly at the threshold is NOT highly seasonal (strict <)', () => {
    // trough/peak = 0.35 exactly → NOT dampened (strict less-than).
    const signal = computeSeasonalitySignal([35, 100]);
    expect(signal.seasonalityIndex).toBeCloseTo(SEASONALITY_DAMPENING_THRESHOLD, 6);
    expect(signal.isHighlySeasonal).toBe(false);
  });

  it('all-zero series → index null (peak 0), never dampens', () => {
    const signal = computeSeasonalitySignal([0, 0, 0]);
    expect(signal.seasonalityIndex).toBeNull();
    expect(signal.isHighlySeasonal).toBe(false);
    expect(dampenSeasonalVolume(50, signal)).toBe(50);
  });
});
