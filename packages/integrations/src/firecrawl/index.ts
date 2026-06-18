/**
 * Firecrawl integration — R4.2 scope: receptivity scrape + contact discovery.
 *
 * Uses the Firecrawl HTTP API (https://api.firecrawl.dev/v1/scrape).
 * Requires env var: FIRECRAWL_API_KEY
 *
 * Cost: ~$0.005 per scrapeReceptivity call (3 URL attempts, Firecrawl
 * Starter tier pricing as of 2026-05). Cap at 3 URLs per domain to bound cost.
 * scrapeContact uses the same per-request cost; probes up to 3 contact paths.
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
      // 30 s outer abort guard. Firecrawl's own server timeout is 15 s (passed
      // in the JSON body), so this fires only if the connection itself stalls.
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
        signal: AbortSignal.timeout(30_000),
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

// ── Contact paths probed by scrapeContact (order matters: most likely first) ──

const CONTACT_PROBE_PATHS = ['/contact', '/about', '/write-for-us'];

/**
 * Email address regex — matches typical mailto/plain email patterns.
 * Anchored to exclude image filenames, noreply, and example.com addresses.
 */
const EMAIL_REGEX = /\b([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})\b/g;

/** Addresses we consider garbage and skip. */
function isSpuriousEmail(email: string): boolean {
  const lower = email.toLowerCase();
  return (
    lower.startsWith('noreply') ||
    lower.startsWith('no-reply') ||
    lower.startsWith('donotreply') ||
    lower.endsWith('@example.com') ||
    lower.endsWith('@domain.com') ||
    // Filenames that contain @ (e.g. 2.0@2x.png)
    /\.(png|jpg|gif|svg|webp|ico|pdf)$/i.test(lower)
  );
}

/**
 * Optional name extraction: look for a line near the email match that looks
 * like a personal name (Title Case, 2-4 words). Returns the first plausible
 * match or undefined.
 */
function extractNearbyName(text: string, emailIndex: number): string | undefined {
  // Search a 300-char window before the email for a name-like token.
  const window = text.slice(Math.max(0, emailIndex - 300), emailIndex);
  // Match 2-4 Title Case words (likely a person name, not a heading).
  const nameMatch = window.match(/([A-Z][a-z]+(?: [A-Z][a-z]+){1,3})\s*[\n\r,|]/);
  if (nameMatch) return nameMatch[1];
  return undefined;
}

export interface ContactResult {
  email: string;
  name?: string;
  sourceUrl: string;
}

/**
 * Probe up to 3 contact-style paths on a domain to extract the first plausible
 * email address and optionally a name. Used by MollyScorer to pre-fill
 * contactEmail/contactName on top-5 flagged prospects.
 *
 * Probe order: /contact, /about, /write-for-us
 * Stops as soon as a usable email is found. Returns null on any failure or when
 * no email is found — never throws. Cost: up to 3 Firecrawl scrape credits.
 *
 * Skips addresses that look like noreply/example/image-filename false positives.
 */
export async function scrapeContact(domain: string): Promise<ContactResult | null> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    throw new IntegrationError('firecrawl', 'FIRECRAWL_API_KEY is not set');
  }

  const bare = domain.replace(/^https?:\/\//, '').replace(/\/$/, '');

  for (const path of CONTACT_PROBE_PATHS) {
    const url = `https://${bare}${path}`;
    try {
      // 30 s outer abort guard (same as scrapeReceptivity). Firecrawl's own
      // server timeout is 15 s in the body; this guards against stalled TCP.
      const res = await fetch(`${FIRECRAWL_BASE}/scrape`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url,
          formats: ['markdown'],
          includeTags: ['p', 'h1', 'h2', 'h3', 'li', 'a', 'address'],
          excludeTags: ['nav', 'script', 'style'],
          onlyMainContent: true,
          timeout: 15000,
        }),
        signal: AbortSignal.timeout(30_000),
      });

      if (!res.ok) {
        if (res.status !== 404) {
          log.warn({ domain, path, status: res.status }, 'firecrawl scrapeContact non-ok');
        }
        continue;
      }

      const json = (await res.json()) as { success?: boolean; data?: { markdown?: string } };
      if (!json.success || !json.data?.markdown) continue;

      // Cap at 8 000 chars; contact pages rarely need more.
      const text = json.data.markdown.slice(0, 8000);

      // Find all email-like matches and return the first non-spurious one.
      let match: RegExpExecArray | null;
      const re = new RegExp(EMAIL_REGEX.source, 'g');
      while ((match = re.exec(text)) !== null) {
        const email = match[1]!;
        if (isSpuriousEmail(email)) continue;

        const name = extractNearbyName(text, match.index);
        return { email, name, sourceUrl: url };
      }
    } catch (err) {
      log.warn(
        { domain, path, err: err instanceof Error ? err.message : err },
        'firecrawl scrapeContact error — skipping path',
      );
    }
  }

  return null;
}

/**
 * Fetch a single URL and return its main-content markdown.
 *
 * Used by MollyCopywriter (R4.5) to pull voice samples from a target
 * blog before generating a guest-post draft. Returns null on any failure
 * (404, timeout, integration error) — caller is expected to fall back to
 * "no voice signal" rather than throw.
 *
 * Caps content at 10 000 chars so a single huge page doesn't blow the
 * downstream Haiku input budget.
 */
export async function scrapeUrlMarkdown(url: string): Promise<string | null> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    throw new IntegrationError('firecrawl', 'FIRECRAWL_API_KEY is not set');
  }
  try {
    // 30 s outer abort guard. Firecrawl's own server timeout is 15 s in the
    // body; this guards against stalled TCP connections consuming lambda time.
    const res = await fetch(`${FIRECRAWL_BASE}/scrape`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url,
        formats: ['markdown'],
        includeTags: ['p', 'h1', 'h2', 'h3', 'h4', 'li', 'blockquote'],
        excludeTags: ['nav', 'footer', 'script', 'style', 'aside'],
        onlyMainContent: true,
        timeout: 15000,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      if (res.status !== 404) {
        log.warn({ url, status: res.status }, 'firecrawl scrapeUrlMarkdown non-ok');
      }
      return null;
    }
    const json = (await res.json()) as { success?: boolean; data?: { markdown?: string } };
    if (!json.success || !json.data?.markdown) return null;
    return json.data.markdown.slice(0, 10000);
  } catch (err) {
    log.warn(
      { url, err: err instanceof Error ? err.message : err },
      'firecrawl scrapeUrlMarkdown error',
    );
    return null;
  }
}
