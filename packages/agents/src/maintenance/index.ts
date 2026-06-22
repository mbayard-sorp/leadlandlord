/**
 * Maintenance Agent — daily site-health watchdog.
 *
 * For one site (when `siteId` is given) or every active site, runs a battery
 * of checks:
 *
 *  1. SSL certificate expiry (skips *.vercel.app — Vercel manages those)
 *  2. Domain expiry (registered_at + 1y - now())
 *  3. Vercel deploy failures (last 24h)
 *  4. Broken internal links from Sanity-published pages
 *  5. Missing tracking number
 *  6. No calls in 30d (sites old enough that this is a yellow flag)
 *  7. GA4 traffic drop > 50% week-over-week
 *
 * Each finding is upserted into `maintenance_findings` keyed on
 * (siteId, category) where status='open' — repeated detection refreshes
 * detail/severity rather than spawning duplicates.
 *
 * Auto-fix is conservative: missing tracking number emits a tracking-setup
 * event; everything else is logged for the operator (and the portfolio
 * analyst's daily digest) to triage.
 */
import * as tls from 'node:tls';
import { z } from 'zod';
import { and, eq, sql } from 'drizzle-orm';
import {
  getDb,
  sites,
  domainCandidates,
  ga4MetricsDaily,
  maintenanceFindings,
  type Site,
} from '@leadlandlord/db';
import { BaseAgent, type AgentContext } from '../base';
import { verifyCrossLinks } from './cross-link-verifier';

// ────────────────────────────────────────────────────────────
// Schema
// ────────────────────────────────────────────────────────────

export const MaintenanceInput = z.object({
  siteId: z.string().uuid().optional(),
});
export type MaintenanceInput = z.infer<typeof MaintenanceInput>;

export const MaintenanceOutput = z.object({
  siteId: z.string().uuid().optional(),
  sitesChecked: z.number().int().nonnegative(),
  findingsCount: z.number().int().nonnegative(),
  autoFixedCount: z.number().int().nonnegative(),
  crossLinksChecked: z.number().int().nonnegative().optional(),
  crossLinksReaped: z.number().int().nonnegative().optional(),
});
export type MaintenanceOutput = z.infer<typeof MaintenanceOutput>;

export type FindingCategory =
  | 'ssl_expiry'
  | 'domain_expiry'
  | 'deploy_failure'
  | 'broken_link'
  | 'no_tracking'
  | 'no_calls_30d'
  | 'ga4_traffic_drop';

export type Severity = 'info' | 'warning' | 'critical';

export interface DraftFinding {
  category: FindingCategory;
  severity: Severity;
  detail: string;
  metadata?: Record<string, unknown>;
}

// ────────────────────────────────────────────────────────────
// Pure helpers (testable without DB)
// ────────────────────────────────────────────────────────────

export function classifySslExpiry(daysUntilExpiry: number): Severity | null {
  if (daysUntilExpiry < 14) return 'critical';
  if (daysUntilExpiry < 30) return 'warning';
  return null;
}

export function shouldSkipSslCheck(domain: string | null): boolean {
  if (!domain) return true;
  const d = domain.toLowerCase();
  return d.endsWith('.vercel.app');
}

export function classifyDomainExpiry(daysUntilExpiry: number): Severity | null {
  if (daysUntilExpiry < 0) return 'critical';
  if (daysUntilExpiry < 30) return 'warning';
  return null;
}

export function classifyTrafficDrop(
  recentSum: number,
  priorSum: number,
): { drop: boolean; ratio: number } {
  if (priorSum < 20) return { drop: false, ratio: 0 };
  const ratio = recentSum / priorSum;
  return { drop: ratio < 0.5, ratio };
}

/** Parse markdown links + bare <a href> from a string. Returns hrefs. */
export function extractLinks(body: string): string[] {
  const out: string[] = [];
  const md = /\[[^\]]*\]\(([^)\s]+)\)/g;
  for (const m of body.matchAll(md)) {
    if (m[1]) out.push(m[1]);
  }
  const html = /<a\s[^>]*href=["']([^"']+)["']/gi;
  for (const m of body.matchAll(html)) {
    if (m[1]) out.push(m[1]);
  }
  return out;
}

/** Resolve relative URL against site domain, return full URL or null if not http(s). */
export function resolveLink(href: string, domain: string | null): string | null {
  if (!href) return null;
  if (href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('#')) return null;
  if (href.startsWith('http://') || href.startsWith('https://')) return href;
  if (!domain) return null;
  if (href.startsWith('/')) return `https://${domain}${href}`;
  return `https://${domain}/${href}`;
}

// ────────────────────────────────────────────────────────────
// Network helpers
// ────────────────────────────────────────────────────────────

/** Fetch SSL cert validTo from a host. Returns ms-since-epoch or null on error. */
export async function fetchCertValidTo(host: string, timeoutMs = 5000): Promise<number | null> {
  return new Promise((resolve) => {
    const socket = tls.connect(
      { host, port: 443, servername: host, timeout: timeoutMs },
      () => {
        const cert = socket.getPeerCertificate();
        socket.end();
        if (!cert || !cert.valid_to) {
          resolve(null);
          return;
        }
        const t = Date.parse(cert.valid_to);
        resolve(Number.isFinite(t) ? t : null);
      },
    );
    socket.on('error', () => resolve(null));
    socket.on('timeout', () => {
      socket.destroy();
      resolve(null);
    });
  });
}

interface VercelDeploymentRow {
  uid: string;
  state: string;
  createdAt?: number;
  url?: string;
}

/** Query Vercel API for failed deployments in the last 24h. */
export async function fetchRecentVercelFailures(
  projectId: string,
  windowMs = 24 * 60 * 60 * 1000,
): Promise<VercelDeploymentRow[]> {
  const token = process.env.VERCEL_TOKEN;
  if (!token) return [];
  const since = Date.now() - windowMs;
  const url = `https://api.vercel.com/v6/deployments?projectId=${encodeURIComponent(projectId)}&state=ERROR&limit=5&since=${since}`;
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return [];
    const json = (await res.json()) as { deployments?: VercelDeploymentRow[] };
    return json.deployments ?? [];
  } catch {
    return [];
  }
}

/** HEAD a URL; return status or null on network failure. */
export async function headStatus(url: string, timeoutMs = 5000): Promise<number | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, { method: 'HEAD', signal: ctrl.signal });
    clearTimeout(t);
    return res.status;
  } catch {
    return null;
  }
}

// ────────────────────────────────────────────────────────────
// Sanity (lazy import — keeps test surface clean)
// ────────────────────────────────────────────────────────────

interface SitePageDoc {
  slug?: { current?: string };
  body?: string;
  title?: string;
}
async function fetchSitePages(siteId: string): Promise<SitePageDoc[]> {
  try {
    const mod = (await import('@leadlandlord/integrations/sanity')) as unknown as {
      createReadClient?: () => {
        fetch: <T>(q: string, params?: Record<string, unknown>) => Promise<T>;
      };
      createWriteClient?: () => {
        fetch: <T>(q: string, params?: Record<string, unknown>) => Promise<T>;
      };
    };
    const client = mod.createReadClient?.() ?? mod.createWriteClient?.();
    if (!client) return [];
    const query = `*[_type == "page" && site._ref == $siteRef]{ slug, body, title }`;
    return await client.fetch<SitePageDoc[]>(query, { siteRef: `site-${siteId}` });
  } catch {
    return [];
  }
}

// ────────────────────────────────────────────────────────────
// Per-site checks
// ────────────────────────────────────────────────────────────

async function checkSsl(site: Site): Promise<DraftFinding | null> {
  if (shouldSkipSslCheck(site.domain)) return null;
  if (!site.domain) return null;
  const validTo = await fetchCertValidTo(site.domain);
  if (!validTo) return null;
  const days = Math.floor((validTo - Date.now()) / (24 * 60 * 60 * 1000));
  const sev = classifySslExpiry(days);
  if (!sev) return null;
  return {
    category: 'ssl_expiry',
    severity: sev,
    detail: `SSL cert for ${site.domain} expires in ${days} day(s).`,
    metadata: { domain: site.domain, daysUntilExpiry: days, validTo },
  };
}

async function checkDomainExpiry(site: Site): Promise<DraftFinding | null> {
  if (!site.domain) return null;
  const db = getDb();
  const rows = await db
    .select()
    .from(domainCandidates)
    .where(and(eq(domainCandidates.siteId, site.id), eq(domainCandidates.domain, site.domain)))
    .limit(1);
  const row = rows[0];
  if (!row || !row.registeredAt) return null;
  const renewalAt = new Date(row.registeredAt).getTime() + 365 * 24 * 60 * 60 * 1000;
  const days = Math.floor((renewalAt - Date.now()) / (24 * 60 * 60 * 1000));
  const sev = classifyDomainExpiry(days);
  if (!sev) return null;
  return {
    category: 'domain_expiry',
    severity: sev,
    detail: `Domain ${site.domain} renews in ${days} day(s).`,
    metadata: { domain: site.domain, daysUntilExpiry: days },
  };
}

async function checkVercelDeploys(site: Site): Promise<DraftFinding | null> {
  if (!site.vercelProjectId) return null;
  const failures = await fetchRecentVercelFailures(site.vercelProjectId);
  if (failures.length === 0) return null;
  return {
    category: 'deploy_failure',
    severity: 'warning',
    detail: `${failures.length} Vercel deploy failure(s) in last 24h on project ${site.vercelProjectId}.`,
    metadata: { failures: failures.map((f) => ({ uid: f.uid, createdAt: f.createdAt })) },
  };
}

async function checkBrokenLinks(site: Site): Promise<DraftFinding | null> {
  if (!site.domain) return null;
  const pages = await fetchSitePages(site.id);
  if (pages.length === 0) return null;
  const seen = new Set<string>();
  const broken: Array<{ url: string; status: number | null }> = [];
  for (const page of pages) {
    const body = typeof page.body === 'string' ? page.body : '';
    if (!body) continue;
    const links = extractLinks(body);
    for (const href of links) {
      const url = resolveLink(href, site.domain);
      if (!url) continue;
      if (seen.has(url)) continue;
      seen.add(url);
      // Limit how many we hit per site so a content-heavy site doesn't blow
      // the agent's run window.
      if (seen.size > 50) break;
      const status = await headStatus(url);
      if (status !== null && status >= 400) {
        broken.push({ url, status });
      }
    }
    if (seen.size > 50) break;
  }
  if (broken.length === 0) return null;
  return {
    category: 'broken_link',
    severity: 'warning',
    detail: `${broken.length} broken link(s) detected on ${site.domain}.`,
    metadata: { broken: broken.slice(0, 25) },
  };
}

function checkTracking(site: Site): DraftFinding | null {
  if (site.trackingNumber) return null;
  if (site.status !== 'warming' && site.status !== 'live' && site.status !== 'rented') {
    return null;
  }
  return {
    category: 'no_tracking',
    severity: 'warning',
    detail: `Site ${site.id} has no tracking number assigned.`,
    metadata: { siteStatus: site.status },
  };
}

function checkNoCalls(site: Site): DraftFinding | null {
  if (site.status !== 'warming' && site.status !== 'live') return null;
  if (site.calls30d > 0) return null;
  const ageMs = Date.now() - new Date(site.createdAt).getTime();
  if (ageMs < 30 * 24 * 60 * 60 * 1000) return null;
  return {
    category: 'no_calls_30d',
    severity: 'info',
    detail: `Site ${site.niche} ${site.city} has 0 calls in the last 30 days.`,
    metadata: { calls30d: site.calls30d },
  };
}

async function checkGa4Drop(site: Site): Promise<DraftFinding | null> {
  const db = getDb();
  const today = new Date();
  const day = (offset: number) => {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - offset);
    return d.toISOString().slice(0, 10);
  };
  const recentStart = day(7);
  const recentEnd = day(1);
  const priorStart = day(14);
  const priorEnd = day(8);
  const rows = (await db.execute(sql`
    SELECT date, sessions
    FROM ${ga4MetricsDaily}
    WHERE site_id = ${site.id} AND date >= ${priorStart} AND date <= ${recentEnd}
  `)) as unknown as { rows: Array<{ date: string; sessions: number }> } | Array<{ date: string; sessions: number }>;
  const list = Array.isArray(rows) ? rows : rows.rows;
  let recent = 0;
  let prior = 0;
  for (const r of list) {
    const sessions = Number(r.sessions) || 0;
    if (r.date >= recentStart && r.date <= recentEnd) recent += sessions;
    else if (r.date >= priorStart && r.date <= priorEnd) prior += sessions;
  }
  const result = classifyTrafficDrop(recent, prior);
  if (!result.drop) return null;
  return {
    category: 'ga4_traffic_drop',
    severity: 'critical',
    detail: `GA4 sessions dropped ${Math.round((1 - result.ratio) * 100)}% week-over-week (${prior} → ${recent}).`,
    metadata: { recent, prior, ratio: result.ratio },
  };
}

// ────────────────────────────────────────────────────────────
// Persistence
// ────────────────────────────────────────────────────────────

/**
 * Upsert a finding: if an open row for (siteId, category) exists, update
 * detail/severity/metadata. Otherwise insert a new row. Returns true when
 * inserted (i.e. genuinely new), false on update.
 */
export async function upsertFinding(siteId: string, finding: DraftFinding): Promise<boolean> {
  const db = getDb();
  const existing = await db
    .select()
    .from(maintenanceFindings)
    .where(
      and(
        eq(maintenanceFindings.siteId, siteId),
        eq(maintenanceFindings.category, finding.category),
        eq(maintenanceFindings.status, 'open'),
      ),
    )
    .limit(1);
  if (existing[0]) {
    await db
      .update(maintenanceFindings)
      .set({
        severity: finding.severity,
        detail: finding.detail,
        metadata: finding.metadata ?? null,
      })
      .where(eq(maintenanceFindings.id, existing[0].id));
    return false;
  }
  await db.insert(maintenanceFindings).values({
    siteId,
    category: finding.category,
    severity: finding.severity,
    detail: finding.detail,
    metadata: finding.metadata ?? null,
  });
  return true;
}

// ────────────────────────────────────────────────────────────
// Agent
// ────────────────────────────────────────────────────────────

export class MaintenanceAgent extends BaseAgent<typeof MaintenanceInput, typeof MaintenanceOutput> {
  constructor() {
    super({
      name: 'maintenance',
      inputSchema: MaintenanceInput,
      outputSchema: MaintenanceOutput,
      defaultDailyCapUsd: 5,
      dedupeKeyFn: (input) => {
        const day = new Date().toISOString().slice(0, 10);
        return `maintenance:${input.siteId ?? 'all'}:${day}`;
      },
    });
  }

  protected async execute(
    input: z.infer<typeof MaintenanceInput>,
    ctx: AgentContext,
  ): Promise<z.infer<typeof MaintenanceOutput>> {
    const db = getDb();
    let siteList: Site[];
    if (input.siteId) {
      siteList = await db.select().from(sites).where(eq(sites.id, input.siteId)).limit(1);
    } else {
      siteList = (await db.execute(sql`
        SELECT * FROM ${sites} WHERE status IN ('warming', 'live', 'rented')
      `)) as unknown as Site[] extends infer T ? T : never;
      // Fallback for non-array shape
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r: any = siteList;
      if (!Array.isArray(r) && Array.isArray(r?.rows)) siteList = r.rows;
    }
    ctx.log.info({ count: siteList.length }, 'maintenance: scanning sites');

    let findingsCount = 0;
    let autoFixedCount = 0;

    for (const site of siteList) {
      const drafts: DraftFinding[] = [];
      const checks = await Promise.allSettled([
        checkSsl(site),
        checkDomainExpiry(site),
        checkVercelDeploys(site),
        checkBrokenLinks(site),
        Promise.resolve(checkTracking(site)),
        Promise.resolve(checkNoCalls(site)),
        checkGa4Drop(site),
      ]);
      for (const c of checks) {
        if (c.status === 'fulfilled' && c.value) drafts.push(c.value);
        else if (c.status === 'rejected') {
          ctx.log.warn({ err: String(c.reason), siteId: site.id }, 'maintenance: check failed');
        }
      }

      for (const d of drafts) {
        const inserted = await upsertFinding(site.id, d);
        if (inserted) findingsCount += 1;

        // Conservative auto-fix policy
        if (d.category === 'no_tracking') {
          await ctx.emitNextStepEvent({
            type: 'tracking-setup.requested',
            targetAgent: 'tracking-setup',
            payload: { siteId: site.id },
          });
          autoFixedCount += 1;
        }
      }
    }

    // Network-wide cross-link verification + dead-link reaping. Only on the
    // full-fleet pass (no specific siteId) so it runs once per daily sweep.
    let crossLinksChecked = 0;
    let crossLinksReaped = 0;
    if (!input.siteId) {
      try {
        const res = await verifyCrossLinks();
        crossLinksChecked = res.checked;
        crossLinksReaped = res.reaped;
        ctx.log.info(res, 'maintenance: cross-link verification complete');
      } catch (err) {
        ctx.log.warn({ err: String(err) }, 'maintenance: cross-link verification failed');
      }
    }

    return {
      siteId: input.siteId,
      sitesChecked: siteList.length,
      findingsCount,
      autoFixedCount,
      crossLinksChecked,
      crossLinksReaped,
    };
  }
}
