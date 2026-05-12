/**
 * Firecrawl integration — R4.2 scope: receptivity scrape only.
 *
 * Uses the Firecrawl HTTP API (https://api.firecrawl.dev/v1/scrape).
 * Requires env var: FIRECRAWL_API_KEY
 *
 * Cost: ~$0.005 per scrapeReceptivity call (3 URL attempts, Firecrawl
 * Starter tier pricing as of 2026-05). Cap at 3 URLs per domain to bound cost.
 *
 * R4.5 (sitemap + voice calibration) and R4.7 (published-URL verification)
 * will add more exports here. Keep this file small until those phases land.
 */

import { IntegrationError } from '@leadlandlord/shared/errors';
import { log } from '@leadlandlord/shared/log';

const FIRECRAWL_BASE = 'https://api.firecrawl.dev/v1';

/** Regex patterns indicating a blog accepts guest contributions. */
const RECEPTIVITY_PATTERNS =
  /guest\s*post|contribute|submission|write\s+for\s+us|guest\s+author|guest\s+contributor/i;

/** URL path suffixes to probe in order (stops at first successful scrape). */
const PROBE_PATHS = ['/write-for-us', '/contribute', '/contact', '/about'];

export interface ReceptivityResult {
  /** True if at least one signal keyword was found on any probed URL. */
  receptive: boolean;
  /** Matched keyword substrings (may be empty). */
  signals: string[];
  /** URLs that were successfully fetched (may be fewer than PROBE_PATHS). */
  sampledUrls: string[];
}

/**
 * Scrape up to 3 pages on `domain` looking for guest-post receptivity signals.
 *
 * Strategy:
 *  1. Try each path in PROBE_PATHS until 3 successful fetches or all exhausted.
 *  2. Regex-test the scraped markdown for RECEPTIVITY_PATTERNS.
 *  3. Return matched substrings so MollyScorer can surface them in rationale.
 *
 * Returns `{ receptive: false, signals: [], sampledUrls: [] }` on any
 * integration failure — never throws. Callers should treat non-receptive as
 * "unknown" rather than a hard block when signals is empty and sampledUrls is
 * also empty (indicates a scrape failure, not genuine non-receptivity).
 */
export async function scrapeReceptivity(domain: string): Promise<ReceptivityResult> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    throw new IntegrationError('firecrawl', 'FIRECRAWL_API_KEY is not set');
  }

  const bare = domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const signals: string[] = [];
  const sampledUrls: string[] = [];

  const MAX_FETCHES = 3;
  let fetches = 0;

  for (const path of PROBE_PATHS) {
    if (fetches >= MAX_FETCHES) break;

    const url = `https://${bare}${path}`;
    try {
      const res = await fetch(`${FIRECRAWL_BASE}/scrape`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url,
          formats: ['markdown'],
          // Limit content to first 5 000 chars to cap processing cost.
          actions: [],
          includeTags: ['p', 'h1', 'h2', 'h3', 'li', 'a'],
          excludeTags: ['nav', 'footer', 'script', 'style'],
          onlyMainContent: true,
          timeout: 15000,
        }),
      });

      if (!res.ok) {
        // 404 is expected for paths that don't exist — skip silently.
        if (res.status !== 404) {
          log.warn({ domain, path, status: res.status }, 'firecrawl scrape non-ok');
        }
        continue;
      }

      fetches++;
      const json = (await res.json()) as { success?: boolean; data?: { markdown?: string } };

      if (!json.success || !json.data?.markdown) continue;

      const text = json.data.markdown.slice(0, 5000);
      sampledUrls.push(url);

      // Collect all matches for the signals field.
      const matches = text.match(new RegExp(RECEPTIVITY_PATTERNS.source, 'gi'));
      if (matches) {
        for (const m of matches) {
          const lower = m.toLowerCase().trim();
          if (!signals.includes(lower)) signals.push(lower);
        }
      }

      // Stop early once we have a positive signal.
      if (signals.length > 0) break;
    } catch (err) {
      log.warn(
        { domain, path, err: err instanceof Error ? err.message : err },
        'firecrawl scrape error — skipping path',
      );
    }
  }

  return {
    receptive: signals.length > 0,
    signals,
    sampledUrls,
  };
}
