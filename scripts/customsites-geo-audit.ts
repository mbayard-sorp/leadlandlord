#!/usr/bin/env -S tsx
/**
 * LeadLandlord — Custom Sites GEO/AEO audit (ADR 0033 Amendment 1, decision D8).
 *
 * Standalone, read-only score report for a `csSite`. Reuses the pure,
 * dependency-free scoring functions in
 * `packages/agents/src/geo-aeo-auditor/checks.ts` directly (imported by
 * relative path, NOT via the agent's `index.ts` — that module is
 * Postgres-coupled: it selects from `sites`/`tenants` and writes
 * `geoSeoAudits`/`seoRecommendations` FKs, both of which ADR 0033 D4 forbids
 * for this line). This script fetches `llms.txt`, a handful of live pages,
 * and their `.md` twins over plain `fetch` — the same technique as the
 * agent's `fetchLiveAssets`/`fetchMarkdownTwins` — and feeds them into the
 * same `runChecks` used for tenant sites, for full parity on all six
 * subscores.
 *
 * Where results go — nowhere durable. Per D8 this script prints a
 * human-readable report to stdout ONLY on every run. It does NOT write to
 * `geoSeoAudits`, does NOT create a new `csAudit` Sanity doc type, does NOT
 * emit an `agent_events` row, and does NOT write any file artifact. This is
 * intentional — see D8's "report nobody consumes" rationale — not an
 * oversight. Do not add persistence to this script "for convenience"; if you
 * think it needs a persistence layer, that's a decision for the architect,
 * not a scope creep here (D8's trigger condition: ≥3 live Custom Sites, or a
 * Custom Sites operator UI existing for other reasons).
 *
 * Preview base-url support: the production domain isn't DNS-cut-over yet, so
 * a site is reachable today at `https://leadlandlord-sites.vercel.app/?cs=<siteKey>`.
 * `proxy.ts` resolves Custom Sites mode either by a hardcoded host->siteKey
 * map (`CUSTOM_HOSTS`) or by the `?cs=<siteKey>` query param (sticky via the
 * `ll_cs` cookie for browser nav — irrelevant here since this script issues
 * independent `fetch()` calls with no cookie jar). Whenever `--base-url` is
 * passed, EVERY derived request URL gets `?cs=<siteKey>` appended explicitly
 * — silently omitting it would 404 every page and produce a score built on
 * garbage. When `--base-url` is omitted, the default base is
 * `https://<csSite.customDomain>` and no `cs` param is added (the real host
 * is expected to resolve via `CUSTOM_HOSTS` once DNS is live).
 *
 * Usage:
 *   pnpm customsites-geo-audit                                          # audit every csSite doc at https://<customDomain>
 *   pnpm customsites-geo-audit --site constructionadr                   # audit one site at its own domain
 *   pnpm customsites-geo-audit --site constructionadr \
 *     --base-url https://leadlandlord-sites.vercel.app                  # audit via the live preview (?cs= threaded automatically)
 *
 * Flags:
 *   --site <siteKey>       Restrict to one csSite (default: audit all).
 *   --base-url <url>       Override the site's own domain as the fetch base.
 *                          `?cs=<siteKey>` is appended to every request built
 *                          from this base (see above).
 *   --timeout-ms <n>       Per-request fetch timeout (default: 10000).
 *   --help                 Print this usage and exit.
 *
 * Exit codes: non-zero on a genuine fetch failure (network/DNS/timeout
 * exception, or the requested --site not found in Sanity) so this is
 * CI-usable later. A merely-low GEO score is NOT a failure — this always
 * exits 0 for that case. HTTP-level 404s (e.g. llms.txt/.md twins gated
 * behind `robotsDisallow`) are reported as findings/caveats, not treated as
 * script failures — that's expected launch-noindexed behavior per D6, not a
 * broken audit run.
 */
import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
function findEnvFile(start: string, name: string): string | undefined {
  let dir = start;
  for (let i = 0; i < 8; i++) {
    const candidate = resolve(dir, name);
    if (existsSync(candidate)) return candidate;
    const parent = resolve(dir, '..');
    if (parent === dir) return undefined;
    dir = parent;
  }
  return undefined;
}
const envLocal = findEnvFile(__dirname, '.env.local');
if (envLocal) loadEnv({ path: envLocal, override: true });

// eslint-disable-next-line import/order
import { createReadClient } from '@leadlandlord/sanity-schema/client';
// eslint-disable-next-line import/order
import {
  runChecks,
  geoScore,
  type SiteContext,
  type FetchedPage,
  type FetchedMarkdownPage,
  type GeoSubscores,
  type Finding,
  type RecommendationCandidate,
  // Imported directly from the pure checks module per D8 — NEVER from
  // geo-aeo-auditor/index.ts, which is Postgres-coupled.
} from '../packages/agents/src/geo-aeo-auditor/checks';

// ────────────────────────────────────────────────────────────
// CLI args
// ────────────────────────────────────────────────────────────

const USAGE = `
LeadLandlord — Custom Sites GEO/AEO audit (read-only, ADR 0033 D8)

Usage:
  pnpm customsites-geo-audit
  pnpm customsites-geo-audit --site <siteKey>
  pnpm customsites-geo-audit --site <siteKey> --base-url <url>

Flags:
  --site <siteKey>     Restrict to one csSite (default: audit all csSite docs)
  --base-url <url>     Override the fetch base (e.g. the Vercel preview host).
                        '?cs=<siteKey>' is appended to every request built
                        from this base automatically.
  --timeout-ms <n>      Per-request fetch timeout in ms (default: 10000)
  --help                Print this message and exit
`;

interface Args {
  site: string | null;
  baseUrl: string | null;
  timeoutMs: number;
}

function parseCliArgs(): Args {
  const { values } = parseArgs({
    options: {
      site: { type: 'string' },
      'base-url': { type: 'string' },
      'timeout-ms': { type: 'string', default: '10000' },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help) {
    console.log(USAGE);
    process.exit(0);
  }
  return {
    site: values.site ?? null,
    baseUrl: values['base-url'] ?? null,
    timeoutMs: Math.max(1000, Number.parseInt(values['timeout-ms'] ?? '10000', 10)),
  };
}

// ────────────────────────────────────────────────────────────
// Sanity reads (independent GROQ, no import from apps/site-host —
// customsites-sanity.ts is being edited concurrently by another agent in
// this repo; this script deliberately does not depend on it)
// ────────────────────────────────────────────────────────────

interface CsSiteRow {
  siteKey: string;
  name: string;
  customDomain: string | null;
  phone: string | null;
  cellPhone: string | null;
  organizationType: string | null;
  robotsDisallow: boolean | null;
  address: { city: string | null; state: string | null } | null;
}

interface CsPracticeAreaSlugRow {
  slug: string;
}

const CS_SITE_PROJECTION = `{
  siteKey, name, customDomain, phone, cellPhone, organizationType, robotsDisallow,
  address{ city, state }
}`;

async function fetchAllCsSites(client: ReturnType<typeof createReadClient>): Promise<CsSiteRow[]> {
  const rows = await client.fetch<CsSiteRow[]>(
    `*[_type=="csSite" && defined(siteKey)]${CS_SITE_PROJECTION} | order(siteKey asc)`,
  );
  return rows ?? [];
}

async function fetchOneCsSite(
  client: ReturnType<typeof createReadClient>,
  siteKey: string,
): Promise<CsSiteRow | null> {
  const row = await client.fetch<CsSiteRow | null>(
    `*[_type=="csSite" && siteKey==$siteKey][0]${CS_SITE_PROJECTION}`,
    { siteKey },
  );
  return row ?? null;
}

async function fetchPracticeAreaSlugs(
  client: ReturnType<typeof createReadClient>,
  siteKey: string,
): Promise<string[]> {
  const rows = await client.fetch<CsPracticeAreaSlugRow[]>(
    `*[_type=="csPracticeArea" && site->siteKey==$siteKey && defined(slug.current)]{ "slug": slug.current }`,
    { siteKey },
  );
  return (rows ?? []).map((r) => r.slug).filter(Boolean);
}

// ────────────────────────────────────────────────────────────
// URL building — the ?cs= threading described in the header comment
// ────────────────────────────────────────────────────────────

/** Builds an absolute URL under `base` + `path`, appending `?cs=<siteKey>` when `appendCs`. */
function buildUrl(base: string, path: string, siteKey: string, appendCs: boolean): string {
  const url = new URL(path, base);
  if (appendCs) url.searchParams.set('cs', siteKey);
  return url.toString();
}

// ────────────────────────────────────────────────────────────
// Fetch helpers — mirror geo-aeo-auditor/index.ts's fetchLiveAssets /
// fetchMarkdownTwins technique, adapted for a script (no AgentContext logger,
// no DB). Every network exception is recorded so the script can exit
// non-zero on a genuine fetch failure without treating expected 404s
// (robotsDisallow-gated llms.txt / .md twins) as failures.
// ────────────────────────────────────────────────────────────

interface FetchOutcome {
  ok: boolean;
  status: number | null;
  contentType: string | null;
  text: string | null;
  networkError: string | null;
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<FetchOutcome> {
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': 'LeadLandlord-CustomSitesGeoAudit/1.0' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = res.ok ? await res.text() : '';
    return {
      ok: res.ok,
      status: res.status,
      contentType: res.headers.get('content-type'),
      text: res.ok ? text : null,
      networkError: null,
    };
  } catch (err) {
    // A thrown fetch is a genuine network failure (DNS, timeout, refused
    // connection) — NOT an HTTP-level 404/403, which resolves normally above.
    return {
      ok: false,
      status: null,
      contentType: null,
      text: null,
      networkError: err instanceof Error ? err.message : String(err),
    };
  }
}

// ────────────────────────────────────────────────────────────
// Sitemap-driven URL derivation, with the documented fallback
// ────────────────────────────────────────────────────────────

const LOC_RE = /<loc>([^<]+)<\/loc>/g;

interface UrlSetResult {
  /** Path only (e.g. '/', '/contact', '/practice-areas/mediation'). */
  paths: string[];
  source: 'sitemap' | 'fallback';
  note: string;
}

async function deriveUrlSet(
  base: string,
  site: CsSiteRow,
  timeoutMs: number,
  appendCs: boolean,
  sanity: ReturnType<typeof createReadClient>,
): Promise<UrlSetResult> {
  const sitemapUrl = buildUrl(base, '/sitemap.xml', site.siteKey, appendCs);
  const res = await fetchWithTimeout(sitemapUrl, timeoutMs);
  if (res.ok && res.text) {
    const locs = [...res.text.matchAll(LOC_RE)].map((m) => m[1]!.trim()).filter(Boolean);
    const paths = locs
      .map((loc) => {
        try {
          return new URL(loc).pathname;
        } catch {
          return null;
        }
      })
      .filter((p): p is string => p !== null);
    if (paths.length > 0) {
      return { paths, source: 'sitemap', note: `${paths.length} URL(s) from live /sitemap.xml` };
    }
  }

  // Fallback: sitemap.ts returns [] whenever robotsDisallow is true (D6's
  // launch-noindexed invariant) — that IS the current state for the only
  // live Custom Site as of this writing, so this is the path that actually
  // runs today. Known-route allowlist + practice-area slugs from Sanity
  // directly (the sitemap can't reveal them when gated).
  const practiceAreaSlugs = await fetchPracticeAreaSlugs(sanity, site.siteKey);
  const paths = ['/', '/contact', '/publications', ...practiceAreaSlugs.map((s) => `/practice-areas/${s}`)];
  return {
    paths,
    source: 'fallback',
    note:
      `sitemap.xml returned 0 URLs (expected while robotsDisallow=${String(site.robotsDisallow)}) — ` +
      `used fallback route allowlist (/, /contact, /publications) + ${practiceAreaSlugs.length} practice-area slug(s) from Sanity`,
  };
}

// ────────────────────────────────────────────────────────────
// Live asset fetch (llms.txt + pages) — mirrors fetchLiveAssets
// ────────────────────────────────────────────────────────────

interface LiveAssets {
  llmsTxt: string | null;
  pages: FetchedPage[];
  fetchFindings: Finding[];
  networkErrors: string[];
}

async function fetchLiveAssets(
  base: string,
  site: CsSiteRow,
  paths: string[],
  timeoutMs: number,
  appendCs: boolean,
): Promise<LiveAssets> {
  const fetchFindings: Finding[] = [];
  const networkErrors: string[] = [];

  const llmsUrl = buildUrl(base, '/llms.txt', site.siteKey, appendCs);
  const llmsRes = await fetchWithTimeout(llmsUrl, timeoutMs);
  if (llmsRes.networkError) {
    networkErrors.push(`${llmsUrl}: ${llmsRes.networkError}`);
  } else if (!llmsRes.ok) {
    fetchFindings.push({
      check: 'fetch',
      severity: 'warn',
      message: `${llmsUrl} -> HTTP ${llmsRes.status ?? '???'}${
        site.robotsDisallow ? ' (expected: robotsDisallow=true gates llms.txt to 404)' : ''
      }`,
    });
  }

  const pages: FetchedPage[] = [];
  for (const path of paths) {
    const url = buildUrl(base, path, site.siteKey, appendCs);
    // eslint-disable-next-line no-await-in-loop
    const res = await fetchWithTimeout(url, timeoutMs);
    if (res.networkError) {
      networkErrors.push(`${url}: ${res.networkError}`);
      pages.push({ url, html: '', isSubpage: path !== '/' });
      continue;
    }
    if (!res.ok) {
      fetchFindings.push({ check: 'fetch', severity: 'warn', message: `${url} -> HTTP ${res.status ?? '???'}` });
      pages.push({ url, html: '', isSubpage: path !== '/' });
      continue;
    }
    pages.push({ url, html: res.text ?? '', isSubpage: path !== '/' });
  }

  return { llmsTxt: llmsRes.ok ? llmsRes.text : null, pages, fetchFindings, networkErrors };
}

// ────────────────────────────────────────────────────────────
// Markdown twin fetch — mirrors fetchMarkdownTwins
// ────────────────────────────────────────────────────────────

interface MarkdownAssets {
  pages: FetchedMarkdownPage[];
  llmsFullTxtOk: boolean;
  networkErrors: string[];
}

/** HTML path -> .md path, same convention as proxy.ts's .md rewrite: '/' -> /index.md, '/foo' -> /foo.md. */
function mdPathFor(htmlPath: string): string {
  return htmlPath === '/' ? '/index.md' : `${htmlPath.replace(/\/+$/, '')}.md`;
}

async function fetchMarkdownTwins(
  base: string,
  site: CsSiteRow,
  pages: FetchedPage[],
  timeoutMs: number,
  appendCs: boolean,
): Promise<MarkdownAssets> {
  const networkErrors: string[] = [];
  const mdPages: FetchedMarkdownPage[] = [];

  for (const page of pages) {
    let htmlPath = '/';
    try {
      htmlPath = new URL(page.url).pathname;
    } catch {
      // keep '/'
    }
    const url = buildUrl(base, mdPathFor(htmlPath), site.siteKey, appendCs);
    // eslint-disable-next-line no-await-in-loop
    const res = await fetchWithTimeout(url, timeoutMs);
    if (res.networkError) networkErrors.push(`${url}: ${res.networkError}`);
    mdPages.push({
      url,
      status: res.status,
      contentType: res.contentType,
      body: res.text ?? '',
      // Custom Sites have no dedicated /faq route (FAQs are embedded inline
      // on csPracticeArea pages, not a separate markdown twin) — unlike the
      // tenant line's /faq index, so this is always false here. Documented
      // limitation, not a bug: markdownCoverage's FAQ-section check never
      // fires for Custom Sites today.
      expectFaq: false,
    });
  }

  const llmsFullUrl = buildUrl(base, '/llms-full.txt', site.siteKey, appendCs);
  const llmsFullRes = await fetchWithTimeout(llmsFullUrl, timeoutMs);
  if (llmsFullRes.networkError) networkErrors.push(`${llmsFullUrl}: ${llmsFullRes.networkError}`);
  const llmsFullTxtOk = llmsFullRes.ok && (llmsFullRes.text ?? '').trim().length > 0;

  return { pages: mdPages, llmsFullTxtOk, networkErrors };
}

// ────────────────────────────────────────────────────────────
// Reporting
// ────────────────────────────────────────────────────────────

const SEVERITY_ORDER: Record<Finding['severity'], number> = { fail: 0, warn: 1, info: 2 };

function printSubscores(subscores: GeoSubscores): void {
  const rows: Array<[string, number]> = [
    ['llmsTxtCompleteness', subscores.llmsTxtCompleteness],
    ['schemaCoverage', subscores.schemaCoverage],
    ['answerExtractability', subscores.answerExtractability],
    ['entityConsistency', subscores.entityConsistency],
    ['citationReadiness', subscores.citationReadiness],
    ['markdownCoverage', subscores.markdownCoverage],
  ];
  for (const [name, score] of rows) {
    console.log(`    ${name.padEnd(24)} ${String(score).padStart(3)} / 100`);
  }
}

function printFindings(findings: Finding[]): void {
  const sorted = [...findings].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  if (sorted.length === 0) {
    console.log('    (no findings)');
    return;
  }
  for (const f of sorted) {
    const tag = f.severity === 'fail' ? 'FAIL' : f.severity === 'warn' ? 'WARN' : 'INFO';
    console.log(`    [${tag}] (${f.check}) ${f.message}`);
  }
}

function printCandidates(candidates: RecommendationCandidate[]): void {
  if (candidates.length === 0) {
    console.log('    (none)');
    return;
  }
  for (const c of candidates) {
    console.log(`    - [${c.riskLevel}] ${c.type}${c.targetPage ? ` @ ${c.targetPage}` : ''}`);
    console.log(`      ${c.rationale}`);
  }
}

// ────────────────────────────────────────────────────────────
// Per-site audit
// ────────────────────────────────────────────────────────────

async function auditSite(
  site: CsSiteRow,
  args: Args,
  sanity: ReturnType<typeof createReadClient>,
): Promise<{ networkErrors: string[] }> {
  const line = '─'.repeat(78);
  console.log(`\n${line}`);
  console.log(`  Custom Site GEO/AEO audit — ${site.name} (${site.siteKey})`);
  console.log(line);

  if (!site.customDomain && !args.baseUrl) {
    console.log('  No customDomain set and no --base-url given — cannot audit. Skipping.');
    return { networkErrors: [`${site.siteKey}: no customDomain and no --base-url override`] };
  }

  const base = args.baseUrl ?? `https://${site.customDomain}`;
  const appendCs = args.baseUrl !== null;
  console.log(`  Base URL      : ${base}${appendCs ? ' (threading ?cs=' + site.siteKey + ' on every request)' : ''}`);
  console.log(`  robotsDisallow: ${String(site.robotsDisallow ?? true)}`);
  if (site.robotsDisallow !== false) {
    console.log(
      '  CAVEAT: robotsDisallow is not explicitly false — llms.txt, sitemap.xml entries, and .md twins are',
    );
    console.log(
      '          gated to 404 by design (D6 launch-noindexed invariant). Subscores below reflect that gate,',
    );
    console.log('          not a broken site. Re-run after DNS cutover flips this for an accurate live baseline.');
  }

  const { paths, source, note } = await deriveUrlSet(base, site, args.timeoutMs, appendCs, sanity);
  console.log(`  URL set source: ${source} — ${note}`);

  const assets = await fetchLiveAssets(base, site, paths, args.timeoutMs, appendCs);
  const markdown = await fetchMarkdownTwins(base, site, assets.pages, args.timeoutMs, appendCs);
  const networkErrors = [...assets.networkErrors, ...markdown.networkErrors];

  const ctx: SiteContext = {
    siteId: site.siteKey,
    domain: site.customDomain,
    niche: site.organizationType ?? 'Legal Services',
    city: site.address?.city ?? '',
    state: site.address?.state ?? '',
    businessName: site.name,
    trackingNumber: site.phone ?? site.cellPhone ?? null,
  };

  const result = runChecks({
    ctx,
    llmsTxt: assets.llmsTxt,
    pages: assets.pages,
    markdown: { pages: markdown.pages, llmsFullTxtOk: markdown.llmsFullTxtOk },
  });
  const allFindings = [...assets.fetchFindings, ...result.findings];
  const score = geoScore(result.subscores);

  console.log(`\n  Overall GEO score: ${score} / 100\n`);
  console.log('  Subscores:');
  printSubscores(result.subscores);

  console.log('\n  Findings/deficits:');
  printFindings(allFindings);

  console.log('\n  Recommendation candidates (informational only — NOT written anywhere per D8):');
  printCandidates(result.candidates);

  if (networkErrors.length > 0) {
    console.log('\n  NETWORK ERRORS (genuine fetch failures, not HTTP status codes):');
    for (const e of networkErrors) console.log(`    - ${e}`);
  }

  return { networkErrors };
}

// ────────────────────────────────────────────────────────────
// Entry point
// ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseCliArgs();
  const sanity = createReadClient();

  let sites: CsSiteRow[];
  if (args.site) {
    const one = await fetchOneCsSite(sanity, args.site);
    if (!one) {
      console.error(`No csSite doc found with siteKey="${args.site}".`);
      process.exit(1);
    }
    sites = [one];
  } else {
    sites = await fetchAllCsSites(sanity);
    if (sites.length === 0) {
      console.log('No csSite docs found in this dataset. Nothing to audit.');
      return;
    }
  }

  const allNetworkErrors: string[] = [];
  for (const site of sites) {
    // eslint-disable-next-line no-await-in-loop
    const { networkErrors } = await auditSite(site, args, sanity);
    allNetworkErrors.push(...networkErrors);
  }

  console.log(`\n${'─'.repeat(78)}`);
  console.log(
    `Audited ${sites.length} site(s). Results printed above ONLY — nothing written to Sanity, Postgres, or disk (ADR 0033 D8).`,
  );

  if (allNetworkErrors.length > 0) {
    console.error(`\n${allNetworkErrors.length} genuine fetch failure(s) occurred — exiting non-zero.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('customsites-geo-audit failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
