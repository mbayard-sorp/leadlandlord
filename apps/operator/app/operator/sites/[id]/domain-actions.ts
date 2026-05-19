'use server';

import { revalidatePath } from 'next/cache';
import { eq, and, max } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import {
  getDb,
  sites,
  domainCandidates,
  agentEvents,
  type DomainCandidate,
} from '@leadlandlord/db';
import { namecheap } from '@leadlandlord/integrations';
import { log } from '@leadlandlord/shared/log';

export interface ActionResult {
  ok: boolean;
  message?: string;
}

export type DomainCandidateRow = DomainCandidate;

/**
 * Enqueue a domain-procurer 'search' event for a site. The agent walks
 * registrar APIs and inserts rows into domainCandidates with status
 * 'available' or 'pending_approval'.
 */
export async function searchDomainsForSite(siteId: string): Promise<ActionResult> {
  const db = getDb();
  const site = (await db.select().from(sites).where(eq(sites.id, siteId)).limit(1))[0];
  if (!site) return { ok: false, message: 'site not found' };
  await db.insert(agentEvents).values({
    id: randomUUID(),
    agent: 'operator-dashboard',
    type: 'domain.search-requested',
    targetAgent: 'domain-procurer',
    payload: {
      site_id: siteId,
      action: 'search',
      niche: site.niche,
      city: site.city,
      state: site.state,
      niche_id: site.nicheId ?? undefined,
    },
  });
  log.info({ siteId }, 'domain search enqueued');
  // Drain immediately so the operator doesn't wait up to 60s for the cron.
  // Same pattern as triggerOperatorTick in backlinks/actions.ts. Lazy import
  // to avoid pulling the agent registry at module init.
  try {
    const { runOperatorTick } = await import('@/lib/operator-tick');
    await runOperatorTick();
  } catch (err) {
    log.warn(
      { siteId, err: err instanceof Error ? err.message : err },
      'inline operator-tick after domain search failed — cron will pick up',
    );
  }
  revalidatePath(`/operator/sites/${siteId}`);
  return { ok: true };
}

export interface ManualCheckResult {
  ok: boolean;
  domain?: string;
  available?: boolean;
  isPremium?: boolean;
  priceUsd?: number | null;
  message?: string;
}

function normalizeDomain(input: string): string | null {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return null;
  // Strip protocol + path if user pasted a URL.
  const stripped = trimmed
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0] ?? '';
  if (!stripped) return null;
  if (!/^[a-z0-9][a-z0-9-]*(\.[a-z0-9-]+)+$/.test(stripped)) return null;
  return stripped;
}

/**
 * Manually check a single domain's availability against Namecheap. Does NOT
 * persist anything — the operator can call addManualCandidate after to add
 * an available domain to the candidates list.
 */
export async function checkDomainAvailability(domain: string): Promise<ManualCheckResult> {
  const normalized = normalizeDomain(domain);
  if (!normalized) return { ok: false, message: 'invalid domain format' };
  try {
    const result = await namecheap.checkSingleAvailability(normalized);
    return {
      ok: true,
      domain: normalized,
      available: result.available,
      priceUsd: result.price_usd ?? null,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ domain: normalized, err: msg }, 'manual domain check failed');
    return { ok: false, domain: normalized, message: msg };
  }
}

/**
 * Insert an operator-supplied domain as a pending_approval candidate. The
 * domain must have been verified available via checkDomainAvailability; we
 * re-check here so a stale UI state can't slip a taken domain into the
 * approval queue (and ultimately into a registerDomain call that would
 * waste a Namecheap retail API hit).
 */
export async function addManualCandidate(
  siteId: string,
  domain: string,
): Promise<ActionResult> {
  const normalized = normalizeDomain(domain);
  if (!normalized) return { ok: false, message: 'invalid domain format' };

  const db = getDb();
  const site = (await db.select().from(sites).where(eq(sites.id, siteId)).limit(1))[0];
  if (!site) return { ok: false, message: 'site not found' };

  // Re-verify availability before insert.
  let check: { available: boolean; price_usd?: number };
  try {
    check = await namecheap.checkSingleAvailability(normalized);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, message: `availability check failed: ${msg}` };
  }
  if (!check.available) {
    return { ok: false, message: 'domain not available' };
  }

  const tld = (() => {
    const i = normalized.lastIndexOf('.');
    return i === -1 ? null : normalized.slice(i);
  })();

  // Place after existing rows by rank so manual adds slot in at the bottom.
  const [{ maxRank } = { maxRank: null as number | null }] = await db
    .select({ maxRank: max(domainCandidates.rank) })
    .from(domainCandidates)
    .where(eq(domainCandidates.siteId, siteId));

  await db
    .insert(domainCandidates)
    .values({
      siteId,
      domain: normalized,
      registrar: 'namecheap',
      priceUsd: check.price_usd != null ? check.price_usd.toFixed(2) : null,
      tld,
      matchType: 'exact',
      rank: (maxRank ?? 0) + 1,
      status: 'pending_approval',
    })
    .onConflictDoNothing({ target: [domainCandidates.siteId, domainCandidates.domain] });

  log.info({ siteId, domain: normalized }, 'manual domain candidate added');
  revalidatePath(`/operator/sites/${siteId}`);
  return { ok: true };
}

/**
 * Add the Google Search Console verification TXT record on the site's
 * registered domain via Namecheap. The operator pastes the value Google
 * gives them on the property-add screen — we accept either the bare token
 * or the full `google-site-verification=...` form. Idempotent via
 * namecheap.addTxtRecord which replaces an existing TXT at the same host.
 *
 * Once this returns ok, the operator clicks "Verify" in GSC.
 */
export async function addGscVerificationTxt(
  siteId: string,
  token: string,
): Promise<ActionResult & { value?: string }> {
  const raw = token.trim();
  if (!raw) return { ok: false, message: 'paste the verification value from GSC' };

  // GSC accepts either `google-site-verification=TOKEN` or the bare TOKEN.
  // Normalize to the prefixed form so the record matches what Google looks for.
  const value = raw.startsWith('google-site-verification=')
    ? raw
    : `google-site-verification=${raw}`;

  const db = getDb();
  const site = (await db.select().from(sites).where(eq(sites.id, siteId)).limit(1))[0];
  if (!site) return { ok: false, message: 'site not found' };
  if (!site.domain) return { ok: false, message: 'site has no registered domain yet' };

  try {
    const result = await namecheap.addTxtRecord({
      domain: site.domain,
      hostName: '@',
      value,
    });
    log.info(
      { siteId, domain: site.domain, replaced: result.replaced },
      'gsc verification TXT written',
    );
    return { ok: true, value };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ siteId, domain: site.domain, err: msg }, 'gsc verification TXT failed');
    return { ok: false, message: msg };
  }
}

/**
 * Approve a pending_approval domain candidate. Flips the row to 'approved'
 * and emits a `domain.approval.granted` event for Domain Procurer to pick
 * up and register.
 */
export async function approveDomainCandidate(
  siteId: string,
  candidateId: string,
): Promise<ActionResult> {
  const db = getDb();
  const candidate = (
    await db
      .select()
      .from(domainCandidates)
      .where(and(eq(domainCandidates.id, candidateId), eq(domainCandidates.siteId, siteId)))
      .limit(1)
  )[0];
  if (!candidate) return { ok: false, message: 'candidate not found' };
  if (candidate.status !== 'pending_approval') {
    return { ok: false, message: `cannot approve from status=${candidate.status}` };
  }
  await db
    .update(domainCandidates)
    .set({ status: 'approved' })
    .where(eq(domainCandidates.id, candidateId));
  await db.insert(agentEvents).values({
    id: randomUUID(),
    agent: 'operator-dashboard',
    type: 'domain.approval.granted',
    targetAgent: 'domain-procurer',
    payload: {
      site_id: siteId,
      candidate_id: candidateId,
      domain: candidate.domain,
      registrar: candidate.registrar,
      action: 'register',
      human_approved: true,
    },
  });
  log.info({ siteId, candidateId, domain: candidate.domain }, 'domain approval granted');
  revalidatePath(`/operator/sites/${siteId}`);
  return { ok: true };
}
