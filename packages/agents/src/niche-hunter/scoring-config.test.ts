import { describe, it, expect } from 'vitest';
import { evaluateApprovalDiversity, DEFAULT_APPROVE_MAX_PER_STATE_SHARE } from './scoring-config';

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
