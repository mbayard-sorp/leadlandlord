import { describe, expect, it } from 'vitest';
import { SeoOperatorInput, SeoOperatorOutput, normalizeSeoOperatorInput, slugify } from './index';

describe('seo-operator schema', () => {
  it('accepts canonical review input with default lookbackDays', () => {
    const parsed = SeoOperatorInput.parse({
      mode: 'review',
      siteId: '11111111-1111-1111-1111-111111111111',
    });
    expect(parsed.mode).toBe('review');
    if (parsed.mode === 'review') {
      expect(parsed.lookbackDays).toBe(28);
    }
  });

  it('accepts canonical apply input', () => {
    const parsed = SeoOperatorInput.parse({
      mode: 'apply',
      recommendationId: '22222222-2222-2222-2222-222222222222',
    });
    expect(parsed.mode).toBe('apply');
  });

  it('rejects unknown mode', () => {
    expect(() =>
      SeoOperatorInput.parse({
        mode: 'audit',
        siteId: '11111111-1111-1111-1111-111111111111',
      }),
    ).toThrow();
  });

  it('produces valid output for both modes', () => {
    expect(() =>
      SeoOperatorOutput.parse({
        mode: 'review',
        siteId: '11111111-1111-1111-1111-111111111111',
        recommendationsWritten: 7,
      }),
    ).not.toThrow();
    expect(() =>
      SeoOperatorOutput.parse({
        mode: 'apply',
        recommendationId: '22222222-2222-2222-2222-222222222222',
        status: 'auto_applied',
      }),
    ).not.toThrow();
  });
});

describe('normalizeSeoOperatorInput', () => {
  it('maps legacy { site_id } scheduler payload to review mode', () => {
    const out = normalizeSeoOperatorInput({
      site_id: '11111111-1111-1111-1111-111111111111',
      audit_kind: 'all',
    });
    expect((out as { mode?: string }).mode).toBe('review');
    expect((out as { siteId?: string }).siteId).toBe('11111111-1111-1111-1111-111111111111');
  });

  it('maps legacy { recommendation_id } operator payload to apply mode', () => {
    const out = normalizeSeoOperatorInput({
      site_id: '11111111-1111-1111-1111-111111111111',
      recommendation_id: '22222222-2222-2222-2222-222222222222',
      action_payload: { x: 1 },
    });
    expect((out as { mode?: string }).mode).toBe('apply');
    expect((out as { recommendationId?: string }).recommendationId).toBe(
      '22222222-2222-2222-2222-222222222222',
    );
  });

  it('passes through canonical input', () => {
    const out = normalizeSeoOperatorInput({
      mode: 'review',
      siteId: '11111111-1111-1111-1111-111111111111',
    });
    expect(out).toEqual({
      mode: 'review',
      siteId: '11111111-1111-1111-1111-111111111111',
    });
  });

  it('bridges snake_case site_id when mode already declared', () => {
    const out = normalizeSeoOperatorInput({
      mode: 'review',
      site_id: '11111111-1111-1111-1111-111111111111',
    });
    expect((out as { siteId?: string }).siteId).toBe('11111111-1111-1111-1111-111111111111');
  });
});

describe('slugify', () => {
  it('lowercases, strips punctuation, joins with hyphens', () => {
    expect(slugify('Tree Removal Tucson AZ!')).toBe('tree-removal-tucson-az');
  });
  it('handles empty/edge input', () => {
    expect(slugify('')).toBe('');
    expect(slugify('---')).toBe('');
  });
  it('truncates very long strings', () => {
    const long = 'a'.repeat(200);
    expect(slugify(long).length).toBeLessThanOrEqual(80);
  });
});
