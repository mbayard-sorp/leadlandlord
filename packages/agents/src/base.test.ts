import { describe, it, expect } from 'vitest';
import { isOverGlobalBudget, isOverMonthlyBudget } from './base';

describe('isOverGlobalBudget (orchestrator Phase 2)', () => {
  it('cap <= 0 means "no global limit" (never over — avoids bricking the fleet)', () => {
    expect(isOverGlobalBudget(1000, 0)).toBe(false);
    expect(isOverGlobalBudget(1000, -5)).toBe(false);
  });
  it('is over at or above the cap', () => {
    expect(isOverGlobalBudget(1, 1)).toBe(true);
    expect(isOverGlobalBudget(1.0001, 1)).toBe(true);
    expect(isOverGlobalBudget(50, 50)).toBe(true);
  });
  it('is not over below the cap', () => {
    expect(isOverGlobalBudget(0.99, 1)).toBe(false);
    // Fresh UTC-day reset: counter zeroed, work resumes.
    expect(isOverGlobalBudget(0, 1)).toBe(false);
  });
});

describe('isOverMonthlyBudget (orchestrator Phase 2)', () => {
  it('cap <= 0 means unlimited', () => {
    expect(isOverMonthlyBudget(500, 0)).toBe(false);
  });
  it('enforces at or above the cap', () => {
    expect(isOverMonthlyBudget(200, 200)).toBe(true);
    expect(isOverMonthlyBudget(199.99, 200)).toBe(false);
  });
});
