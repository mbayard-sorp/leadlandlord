import { describe, it, expect } from 'vitest';
import {
  PortfolioAnalystInput,
  PortfolioAnalystOutput,
  yesterdayUtc,
  classifySiteStatus,
  formatSlackDigest,
  formatEmailDigest,
} from './index';

describe('portfolio-analyst schema', () => {
  it('accepts empty input (defaults date)', () => {
    expect(PortfolioAnalystInput.parse({}).date).toBeUndefined();
  });
  it('accepts YYYY-MM-DD', () => {
    expect(PortfolioAnalystInput.parse({ date: '2026-05-08' }).date).toBe('2026-05-08');
  });
  it('rejects junk date', () => {
    expect(() => PortfolioAnalystInput.parse({ date: '2026/05/08' })).toThrow();
  });
  it('validates output', () => {
    expect(() =>
      PortfolioAnalystOutput.parse({
        date: '2026-05-08',
        sitesProcessed: 5,
        nichesProcessed: 2,
        redFlagsCount: 1,
      }),
    ).not.toThrow();
  });
});

describe('yesterdayUtc', () => {
  it('returns yesterday UTC for a known instant', () => {
    expect(yesterdayUtc(new Date('2026-05-08T00:00:00.000Z'))).toBe('2026-05-07');
  });
  it('handles month boundary', () => {
    expect(yesterdayUtc(new Date('2026-06-01T00:00:00.000Z'))).toBe('2026-05-31');
  });
});

describe('classifySiteStatus', () => {
  it('green when MRR > 5x costs', () => {
    expect(classifySiteStatus(100, 10, 0).status).toBe('green');
  });
  it('amber when MRR > costs but < 5x', () => {
    expect(classifySiteStatus(15, 10, 0).status).toBe('amber');
  });
  it('red when zero MRR for >30 days with costs', () => {
    expect(classifySiteStatus(0, 5, 31).status).toBe('red');
  });
  it('null when no activity', () => {
    expect(classifySiteStatus(0, 0, 0).status).toBeNull();
  });
});

describe('digest formatting', () => {
  const digestInputs = {
    perSite: [
      {
        siteId: 'a',
        niche: 'plumber',
        mrrUsd: 500,
        costsUsd: 50,
        callsCount: 5,
        leadsCount: 2,
        trialActiveCount: 0,
        tenantsActiveCount: 1,
        status: 'green' as const,
        rationale: 'good',
        city: 'Austin',
        state: 'TX',
      },
      {
        siteId: 'b',
        niche: 'roofer',
        mrrUsd: 0,
        costsUsd: 20,
        callsCount: 0,
        leadsCount: 0,
        trialActiveCount: 0,
        tenantsActiveCount: 0,
        status: 'red' as const,
        rationale: 'bad',
        city: 'Phoenix',
        state: 'AZ',
      },
    ],
    perNiche: [
      { niche: 'plumber', mrr: 500, costs: 50, sites: 1 },
      { niche: 'roofer', mrr: 0, costs: 20, sites: 1 },
    ],
    portfolio: { mrr: 500, costs: 70, sites: 2 },
    redStreaks: [{ siteId: 'b', niche: 'roofer', city: 'Phoenix', days: 45 }],
    recentFindings: [
      { siteId: 'a', category: 'ssl_expiry', severity: 'warning', detail: 'cert in 20d' },
    ],
  };

  it('builds slack text with all sections', () => {
    const text = formatSlackDigest('2026-05-08', digestInputs);
    expect(text).toContain('Portfolio Daily Digest');
    expect(text).toContain('Top 5 by MRR');
    expect(text).toContain('plumber Austin, TX');
    expect(text).toContain('Bottom 5 by ROI');
    expect(text).toContain('Kill candidates');
    expect(text).toContain('Double-down niches');
    expect(text).toContain('maintenance findings');
  });

  it('builds email html with subject', () => {
    const { subject, html } = formatEmailDigest('2026-05-08', digestInputs);
    expect(subject).toContain('2026-05-08');
    expect(subject).toContain('500.00 MRR');
    expect(html).toContain('<h1>');
    expect(html).toContain('plumber');
    expect(html).toContain('roofer');
  });

  it('escapes html in dynamic content', () => {
    const base = digestInputs.perSite[0]!;
    const { html } = formatEmailDigest('2026-05-08', {
      ...digestInputs,
      perSite: [{ ...base, niche: '<script>' }],
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
