/**
 * Live citation probe — the deferred seam referenced in checks.ts's header
 * and in `geo_seo_audits.liveCitationProbe` (packages/db/src/schema.ts).
 *
 * `checks.ts::citationReadiness` is a *structural* proxy (llms.txt + schema +
 * answer-extractability + entity consistency). This module is the honest
 * seam for actually asking an answer engine a real question and checking
 * whether the site's own domain shows up in the citations — i.e. "does this
 * page get cited", not "is this page well-formed".
 *
 * SPIKE (2026-07-12): the installed Anthropic SDK
 * (@anthropic-ai/sdk@0.39.0, see packages/integrations/src/anthropic.ts)
 * does NOT expose a `web_search` server tool. Its `ToolUnion` type
 * (node_modules/@anthropic-ai/sdk/resources/messages/messages.d.ts:527) is
 * `Tool | ToolBash20250124 | ToolTextEditor20250124` — no web-search variant
 * exists to enable. There is also no search-capable integration anywhere in
 * packages/integrations: the only search-adjacent one is
 * `packages/integrations/src/indexnow/index.ts`, which *submits* URLs to
 * IndexNow-participating engines (Bing/Brave/Yandex/Seznam) — it has no read
 * path, so it cannot be used to run a query and inspect results.
 *
 * Given that, this module ships:
 *  - a typed probe result shape (`LiveCitationProbeSnapshot`), persisted
 *    verbatim into `geo_seo_audits.live_citation_probe` so it trends over
 *    time once a real backend exists,
 *  - deterministic, testable query sampling (`sampleProbeQueries`) so the
 *    "3 per site per run, spread across weeks" policy is real and reusable
 *    the moment a backend lands,
 *  - citation classification (`classifyCitation`) — domain-in-citations
 *    matching, also fully unit-testable without network access,
 *  - `runLiveCitationProbe`, which currently always returns
 *    `status: 'unavailable'` with an explicit `reason`. It never fabricates
 *    citation data. Swapping in a real backend (SDK upgrade exposing
 *    web_search, or a new Brave/Bing Search API integration with its own
 *    key) only requires replacing the body of `runLiveCitationProbe` — the
 *    sampling/classification helpers and the caller contract stay the same.
 */

import { extractHeadings, isQuestionHeading } from './checks';

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

export interface CitationProbeQuery {
  /** The literal question text pulled from a question-style H2/H3 heading. */
  query: string;
  /** The page the question was sourced from. */
  sourcePage: string;
}

export interface CitationProbeQueryResult extends CitationProbeQuery {
  /** null when the probe didn't actually run (status !== 'ok'). */
  cited: boolean | null;
  /** Citation URLs/hostnames that matched the site's own domain, if any. */
  citedUrls: string[];
}

export interface LiveCitationProbeSnapshot {
  status: 'ok' | 'unavailable' | 'error';
  /** Human-readable reason, required whenever status !== 'ok'. */
  reason?: string;
  probedAt: string;
  /** ISO-8601 week key (checks.ts::isoWeek) — drives the deterministic sample rotation. */
  week: string;
  queries: CitationProbeQueryResult[];
  sampledCount: number;
  citedCount: number;
}

// ────────────────────────────────────────────────────────────
// Deterministic query sampling
// ────────────────────────────────────────────────────────────

/** FNV/djb2-style string hash — deterministic, no crypto dependency needed. */
function hashString(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  }
  return h;
}

/**
 * Deterministically sample up to `n` FAQ/question-style queries drawn from
 * question-style H2/H3 headings across the fetched pages. The starting
 * offset into the (stably sorted) candidate list rotates by ISO week, so a
 * site with more than `n` questions gets different questions probed on
 * different weeks rather than always the same three — while any single call
 * with the same inputs is 100% reproducible (no Math.random / Date.now).
 */
export function sampleProbeQueries(
  pages: Array<{ url: string; html: string }>,
  week: string,
  n = 3,
): CitationProbeQuery[] {
  const candidates: CitationProbeQuery[] = [];
  for (const p of pages) {
    for (const level of ['h2', 'h3'] as const) {
      for (const heading of extractHeadings(p.html, level)) {
        const query = heading.trim();
        if (query && isQuestionHeading(query)) {
          candidates.push({ query, sourcePage: p.url });
        }
      }
    }
  }
  if (candidates.length === 0) return [];

  // Stable, deterministic ordering regardless of page/extraction order.
  candidates.sort((a, b) => a.query.localeCompare(b.query) || a.sourcePage.localeCompare(b.sourcePage));

  const start = hashString(week) % candidates.length;
  const count = Math.min(n, candidates.length);
  const out: CitationProbeQuery[] = [];
  for (let i = 0; i < count; i++) {
    out.push(candidates[(start + i) % candidates.length]!);
  }
  return out;
}

// ────────────────────────────────────────────────────────────
// Citation classification
// ────────────────────────────────────────────────────────────

/** Strip scheme/path/www and lowercase, for loose apex-domain comparison. */
function apexDomain(input: string): string {
  let host = input.trim().toLowerCase();
  host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  host = (host.split('/')[0] ?? host).split(':')[0] ?? host;
  host = host.replace(/^www\./, '');
  return host;
}

/**
 * Domain-in-citations matching: does `citationUrls` contain the probed
 * site's own apex domain? Comparison is scheme/www/path-insensitive so
 * `https://www.example.com/faq` and `example.com` both match `example.com`.
 */
export function classifyCitation(
  domain: string,
  citationUrls: string[],
): { cited: boolean; citedUrls: string[] } {
  const target = apexDomain(domain);
  const citedUrls = citationUrls.filter((u) => apexDomain(u) === target);
  return { cited: citedUrls.length > 0, citedUrls };
}

// ────────────────────────────────────────────────────────────
// Probe execution (currently unavailable — see module header)
// ────────────────────────────────────────────────────────────

export const LIVE_CITATION_PROBE_UNAVAILABLE_REASON =
  'web_search server tool is unavailable in @anthropic-ai/sdk@0.39.0 (ToolUnion has no web_search variant) and no search-capable integration exists in packages/integrations (indexnow only submits URLs, it cannot query). Swap the body of runLiveCitationProbe() once an SDK upgrade or a real search-API integration lands.';

/**
 * Run the live citation probe for a site.
 *
 * Always returns `status: 'unavailable'` today (see module header) — this is
 * intentional and MUST NOT be replaced with fabricated citation data. The
 * sampled queries are still computed and persisted (with `cited: null`) so
 * the seam is real, typed, and trend-able the moment a backend exists.
 */
export async function runLiveCitationProbe(args: {
  domain: string | null;
  pages: Array<{ url: string; html: string }>;
  week: string;
  sampleSize?: number;
}): Promise<LiveCitationProbeSnapshot> {
  const probedAt = new Date().toISOString();
  const { domain, pages, week, sampleSize = 3 } = args;

  if (!domain) {
    return {
      status: 'unavailable',
      reason: 'site has no domain — nothing to probe',
      probedAt,
      week,
      queries: [],
      sampledCount: 0,
      citedCount: 0,
    };
  }

  const sampled = sampleProbeQueries(pages, week, sampleSize);
  return {
    status: 'unavailable',
    reason: LIVE_CITATION_PROBE_UNAVAILABLE_REASON,
    probedAt,
    week,
    queries: sampled.map((q) => ({ ...q, cited: null, citedUrls: [] })),
    sampledCount: sampled.length,
    citedCount: 0,
  };
}
