import { z } from 'zod';
import { BaseAgent, type AgentContext } from '../base';
import { getDb, lighthouseAudits } from '@leadlandlord/db';
import { IntegrationError } from '@leadlandlord/shared/errors';

/**
 * Lighthouse Audit agent — runs Google PageSpeed Insights (PSI) v5 against
 * a single URL and persists category scores + web vitals to
 * `lighthouse_audits`.
 *
 * Auth: optional API key via `PAGESPEED_API_KEY`. PSI v5 works without a
 * key for low volume (free quota: 25k/day with key, much smaller without).
 *
 * Mock mode: set `LIGHTHOUSE_DRY_RUN=true` to skip the network call and
 * return synthetic scores — used by scripts/dry-run.ts and integration
 * tests so we don't burn quota.
 *
 * Dedupe key: `<siteId>:<url>:<strategy>:<YYYY-MM-DD>` so the weekly
 * scheduler can re-fan-out events idempotently.
 *
 * Docs: https://developers.google.com/speed/docs/insights/v5/get-started
 */

export const LighthouseAuditInput = z.object({
  siteId: z.string().uuid(),
  url: z.string().url(),
  strategy: z.enum(['mobile', 'desktop']).default('mobile'),
});

export const LighthouseAuditOutput = z.object({
  siteId: z.string().uuid(),
  url: z.string(),
  performance: z.number().int().min(0).max(100).nullable(),
  accessibility: z.number().int().min(0).max(100).nullable(),
  bestPractices: z.number().int().min(0).max(100).nullable(),
  seo: z.number().int().min(0).max(100).nullable(),
});

const PSI_ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';

interface PsiCategory {
  score?: number | null;
}
interface PsiAudit {
  numericValue?: number;
}
interface PsiLighthouseResult {
  categories?: {
    performance?: PsiCategory;
    accessibility?: PsiCategory;
    'best-practices'?: PsiCategory;
    seo?: PsiCategory;
  };
  audits?: {
    'largest-contentful-paint'?: PsiAudit;
    'first-contentful-paint'?: PsiAudit;
    interactive?: PsiAudit;
    'cumulative-layout-shift'?: PsiAudit;
  };
}
interface PsiResponse {
  lighthouseResult?: PsiLighthouseResult;
}

function scoreToInt(score: number | null | undefined): number | null {
  if (score === null || score === undefined) return null;
  return Math.round(score * 100);
}

function numericOrNull(audit: PsiAudit | undefined): number | null {
  if (!audit || audit.numericValue === undefined) return null;
  return Math.round(audit.numericValue);
}

function clsToMilli(audit: PsiAudit | undefined): number | null {
  if (!audit || audit.numericValue === undefined) return null;
  return Math.round(audit.numericValue * 1000);
}

function buildSyntheticResult(): PsiLighthouseResult {
  return {
    categories: {
      performance: { score: 0.85 },
      accessibility: { score: 0.92 },
      'best-practices': { score: 0.9 },
      seo: { score: 0.95 },
    },
    audits: {
      'largest-contentful-paint': { numericValue: 2400 },
      'first-contentful-paint': { numericValue: 1500 },
      interactive: { numericValue: 3200 },
      'cumulative-layout-shift': { numericValue: 0.05 },
    },
  };
}

async function callPsi(url: string, strategy: 'mobile' | 'desktop'): Promise<PsiLighthouseResult> {
  const params = new URLSearchParams();
  params.set('url', url);
  params.set('strategy', strategy);
  for (const c of ['performance', 'accessibility', 'best-practices', 'seo']) {
    params.append('category', c);
  }
  const apiKey = process.env.PAGESPEED_API_KEY;
  if (apiKey) params.set('key', apiKey);

  const res = await fetch(`${PSI_ENDPOINT}?${params.toString()}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new IntegrationError(
      'pagespeed-insights',
      `PSI request failed: ${res.status} ${res.statusText} — ${body.slice(0, 500)}`,
    );
  }
  const json = (await res.json()) as PsiResponse;
  if (!json.lighthouseResult) {
    throw new IntegrationError('pagespeed-insights', 'PSI response missing lighthouseResult');
  }
  return json.lighthouseResult;
}

export class LighthouseAudit extends BaseAgent<typeof LighthouseAuditInput, typeof LighthouseAuditOutput> {
  constructor() {
    super({
      name: 'lighthouse-audit',
      inputSchema: LighthouseAuditInput,
      outputSchema: LighthouseAuditOutput,
      defaultDailyCapUsd: 5,
      dedupeKeyFn: (input) => {
        const day = new Date().toISOString().slice(0, 10);
        return `${input.siteId}:${input.url}:${input.strategy}:${day}`;
      },
    });
  }

  protected async execute(
    input: z.infer<typeof LighthouseAuditInput>,
    ctx: AgentContext,
  ): Promise<z.infer<typeof LighthouseAuditOutput>> {
    const dryRun = process.env.LIGHTHOUSE_DRY_RUN === 'true';
    ctx.log.info({ url: input.url, strategy: input.strategy, dryRun }, 'lighthouse audit starting');

    const result: PsiLighthouseResult = dryRun
      ? buildSyntheticResult()
      : await callPsi(input.url, input.strategy);

    const cats = result.categories ?? {};
    const audits = result.audits ?? {};

    const performance = scoreToInt(cats.performance?.score);
    const accessibility = scoreToInt(cats.accessibility?.score);
    const bestPractices = scoreToInt(cats['best-practices']?.score);
    const seo = scoreToInt(cats.seo?.score);

    const lcpMs = numericOrNull(audits['largest-contentful-paint']);
    const fcpMs = numericOrNull(audits['first-contentful-paint']);
    const ttiMs = numericOrNull(audits.interactive);
    const clsMilli = clsToMilli(audits['cumulative-layout-shift']);

    // Trim rawJson — keep just the bits we care about so we don't bloat
    // the row with the full ~1MB PSI payload.
    const rawJson = {
      categories: cats,
      audits: {
        'largest-contentful-paint': audits['largest-contentful-paint'],
        'first-contentful-paint': audits['first-contentful-paint'],
        interactive: audits.interactive,
        'cumulative-layout-shift': audits['cumulative-layout-shift'],
      },
      strategy: input.strategy,
    };

    const db = getDb();
    await db.insert(lighthouseAudits).values({
      siteId: input.siteId,
      url: input.url,
      performance,
      accessibility,
      bestPractices,
      seo,
      lcpMs,
      fcpMs,
      ttiMs,
      clsMilli,
      rawJson,
    });

    ctx.log.info(
      { performance, accessibility, bestPractices, seo, lcpMs, fcpMs, ttiMs, clsMilli },
      'lighthouse audit complete',
    );

    return {
      siteId: input.siteId,
      url: input.url,
      performance,
      accessibility,
      bestPractices,
      seo,
    };
  }
}
