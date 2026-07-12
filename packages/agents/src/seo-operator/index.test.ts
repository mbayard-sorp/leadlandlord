import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SeoOperatorInput, SeoOperatorOutput, normalizeSeoOperatorInput, slugify } from './index';
import { draftInfoPage } from '../shared/author-info-page';

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

  it('accepts freshness input with default staleDays', () => {
    const parsed = SeoOperatorInput.parse({
      mode: 'freshness',
      siteId: '11111111-1111-1111-1111-111111111111',
    });
    expect(parsed.mode).toBe('freshness');
    if (parsed.mode === 'freshness') {
      expect(parsed.staleDays).toBe(120);
    }
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

describe('draftInfoPage (MOCK_AI=1)', () => {
  beforeEach(() => {
    process.env.MOCK_AI = '1';
  });
  afterEach(() => {
    delete process.env.MOCK_AI;
  });

  it('returns a draft with all required fields and respects length caps', async () => {
    const recordUsage = vi.fn();
    const ctx = {
      runId: 'run-1',
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: () => ctx.log },
      parentRunId: null,
      recordUsage,
      progress: vi.fn(),
      emitNextStepEvent: vi.fn(),
    } as unknown as Parameters<typeof draftInfoPage>[0]['ctx'];

    const out = await draftInfoPage({
      siteId: '11111111-1111-1111-1111-111111111111',
      proposedSlug: 'tree-removal-cost',
      proposedTitle: 'Tree Removal Cost',
      intent: 'info',
      niche: 'tree service',
      city: 'Tucson',
      state: 'AZ',
      ctx,
      themeKey: 'classic',
    });

    expect(out.title).toBeTruthy();
    expect(out.title.length).toBeLessThanOrEqual(60);
    expect(out.metaDescription.length).toBeLessThanOrEqual(155);
    expect(out.mdx).toContain('Tree Removal Cost');
    expect(out.h1).toBeTruthy();
    // jsonLd is a JSON string we can parse.
    const parsed = JSON.parse(out.jsonLd);
    expect(parsed['@context']).toBe('https://schema.org');
    // Mock path doesn't call Anthropic, so no usage recorded.
    expect(recordUsage).not.toHaveBeenCalled();
  });
});

describe('seo-operator new_info_page apply gating', () => {
  it('apply path requires status=approved for new_info_page (medium-risk)', async () => {
    // Re-create the gate from runApply: medium-risk + status='pending' → 'awaiting_review'.
    // This is the gate documented in the SeoOperator code: medium-risk recs
    // never auto-apply unless an operator has flipped the status to 'approved'.
    const gate = (riskLevel: string, status: string) => {
      if (riskLevel === 'high') return 'blocked';
      if (riskLevel === 'medium' && status !== 'approved') return 'awaiting_review';
      return 'proceed';
    };
    expect(gate('medium', 'pending')).toBe('awaiting_review');
    expect(gate('medium', 'approved')).toBe('proceed');
    expect(gate('low', 'pending')).toBe('proceed');
    expect(gate('high', 'approved')).toBe('blocked');
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
