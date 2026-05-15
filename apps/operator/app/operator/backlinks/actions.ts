'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { getDb, backlinks, backlinkProspects, sites, agentEvents } from '@leadlandlord/db';
import { sendEmail as sendEmailResend } from '@leadlandlord/integrations/resend';
import { sendEmail as sendEmailZoho } from '@leadlandlord/integrations/zoho-mcp';
import { recordSend } from '@leadlandlord/db/email-throttle';
import { getAnthropicClient } from '@leadlandlord/integrations/anthropic';
import { requireOperatorSession } from '@/lib/auth';

export interface ActionResult {
  ok: boolean;
  message?: string;
}

export async function markSubmitted(id: string): Promise<ActionResult> {
  const db = getDb();
  const row = (await db.select().from(backlinks).where(eq(backlinks.id, id)).limit(1))[0];
  if (!row) return { ok: false, message: 'backlink not found' };
  await db
    .update(backlinks)
    .set({ status: 'submitted' })
    .where(eq(backlinks.id, id));
  revalidatePath('/operator/backlinks');
  return { ok: true };
}

export async function rejectBacklink(id: string, reason?: string): Promise<ActionResult> {
  const db = getDb();
  const row = (await db.select().from(backlinks).where(eq(backlinks.id, id)).limit(1))[0];
  if (!row) return { ok: false, message: 'backlink not found' };
  await db
    .update(backlinks)
    .set({ status: 'rejected', rejectionReason: reason ?? 'operator_rejected' })
    .where(eq(backlinks.id, id));
  revalidatePath('/operator/backlinks');
  revalidatePath('/operator/backlinks/prospects');
  return { ok: true };
}

/**
 * Operator manually supplies an editor email for a prospect row that
 * Apollo couldn't auto-enrich. Stamps the email into metadata, then
 * drafts the pitch via Claude so the operator can review it before
 * approving the send. Without this, sendProspect would bail on
 * "pitchDraft missing".
 */
export async function setProspectEditorEmail(
  id: string,
  email: string,
): Promise<ActionResult> {
  const trimmed = email.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return { ok: false, message: 'invalid email' };
  }
  const db = getDb();
  const row = (await db.select().from(backlinks).where(eq(backlinks.id, id)).limit(1))[0];
  if (!row) return { ok: false, message: 'backlink not found' };
  const md = (row.metadata ?? {}) as Record<string, unknown>;

  const site = (await db.select().from(sites).where(eq(sites.id, row.siteId)).limit(1))[0];
  if (!site) return { ok: false, message: 'site not found for backlink' };

  const pitchTopic =
    typeof md.pitchTopic === 'string'
      ? md.pitchTopic
      : `Guide to ${site.niche} for homeowners in ${site.city}`;

  // Draft the pitch now that we have a real recipient. If the row already
  // has a draft from a prior save, regenerate — operator may have changed
  // the email and the body should reflect the new domain context.
  throw new Error('backlink-builder removed in sprint-0/foundations; replacements arriving in sprint 3-4');
}

/**
 * Operator-approved send for a queue-only prospect row. Reads the pitch
 * draft + recipient from the row's metadata, dispatches via the existing
 * Zoho/Resend pipeline, and flips status to `submitted`. Mirrors the
 * Backlink Builder guest_post send path so on-the-wire behavior matches
 * what we'll see when training wheels come off.
 */
export async function sendProspect(_id: string): Promise<ActionResult> {
  throw new Error('backlink-builder removed in sprint-0/foundations; replacements arriving in sprint 3-4');
}

/**
 * Aggregate Apollo usage in the current calendar month. Apollo bills per
 * `findEditorByDomain` call regardless of whether the response is usable, so
 * we count both:
 *
 *   - Path A successes: `backlinks` rows stamped with
 *     `metadata.prospect.apolloPersonId` (Apollo returned a usable editor).
 *   - Path B failures: `backlink_prospects` rows where the agent recorded
 *     `metadata.apolloBudgetExhausted === false` (Apollo was called but
 *     returned masked email / no people / 404). PRIOR BUG: these were
 *     uncounted, so the meter never moved when most domains hit Path B.
 *
 * Used to gate runs against the free-tier 75-lookup cap surfaced in the
 * operator UI.
 */
export async function getApolloMonthlyUsage(): Promise<{
  used: number;
  cap: number;
  remaining: number;
  monthKey: string;
}> {
  const db = getDb();
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const cap = Number(process.env.APOLLO_MONTHLY_CAP ?? '75');

  let used = 0;

  // Path A — Apollo succeeded, backlinks row created with apolloPersonId.
  const blRows = await db
    .select({ metadata: backlinks.metadata, createdAt: backlinks.createdAt })
    .from(backlinks);
  for (const r of blRows) {
    if (!r.createdAt || new Date(r.createdAt) < monthStart) continue;
    const md = (r.metadata ?? {}) as Record<string, unknown>;
    const p = md.prospect as Record<string, unknown> | undefined;
    if (p && p.apolloPersonId) used += 1;
  }

  // Path B — Apollo was called but result wasn't usable; the agent landed
  // the row in backlink_prospects with apolloBudgetExhausted=false.
  const bpRows = await db
    .select({ metadata: backlinkProspects.metadata, createdAt: backlinkProspects.createdAt })
    .from(backlinkProspects);
  for (const r of bpRows) {
    if (!r.createdAt || new Date(r.createdAt) < monthStart) continue;
    const md = (r.metadata ?? {}) as Record<string, unknown>;
    if (md.apolloBudgetExhausted === false) used += 1;
  }

  return {
    used,
    cap,
    remaining: Math.max(0, cap - used),
    monthKey: monthStart.toISOString().slice(0, 7),
  };
}

/**
 * Drain the agent_events queue immediately instead of waiting up to 60s for
 * the next operator-tick cron. Operator-only — calls into the same
 * runOperatorTick() helper Vercel Cron uses, so behavior matches exactly.
 *
 * Use case: operator just queued a prospect run and doesn't want to stare
 * at "Run queued — polling for progress…" wondering if the cron is alive.
 */
export async function triggerOperatorTick(): Promise<
  ActionResult & { claimed?: number; dispatched?: string[] }
> {
  try {
    await requireOperatorSession();
  } catch {
    return { ok: false, message: 'unauthorized' };
  }
  try {
    // Lazy import: pulls the entire agent registry transitively. Keeping
    // it inside the function prevents the page render path
    // (page → ProspectWorkflow → SeedEditor → actions.ts) from loading
    // every agent at module init, which can 500 the page if any agent's
    // module-load throws (e.g. missing env var).
    const { runOperatorTick } = await import('@/lib/operator-tick');
    const result = await runOperatorTick();
    return { ok: true, claimed: result.claimed, dispatched: result.dispatched };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'tick failed' };
  }
}

/**
 * Fire-and-forget prospect run. Inserts an `operator.prospect.requested`
 * event into `agentEvents`; the cron dispatcher picks it up and invokes
 * BacklinkBuilder with `mode: 'prospect'`. Returns immediately with the
 * new event id so the UI can poll `/status` for progress.
 *
 * Apollo cap enforcement moved into BacklinkBuilder.runProspect so it runs
 * at agent-entry on the cron process rather than at request time.
 */
export async function requestProspectRun(args: {
  siteId: string;
  maxApolloEnrichments?: number;
  skipApollo?: boolean;
}): Promise<ActionResult & { eventId?: string }> {
  if (!args.siteId) return { ok: false, message: 'siteId required' };

  const cap = args.skipApollo
    ? 0
    : Math.min(Math.max(1, args.maxApolloEnrichments ?? 15), 100);

  const db = getDb();
  const site = (await db.select({ id: sites.id }).from(sites).where(eq(sites.id, args.siteId)).limit(1))[0];
  if (!site) return { ok: false, message: 'site not found' };

  const [inserted] = await db
    .insert(agentEvents)
    .values({
      agent: 'operator',
      type: 'operator.prospect.requested',
      // TODO(sprint-3): backlink-builder removed; wire to replacement agent
      targetAgent: 'molly',
      payload: {
        mode: 'prospect',
        siteId: args.siteId,
        site_id: args.siteId,
        maxApolloEnrichments: cap,
      },
    })
    .returning({ id: agentEvents.id });

  revalidatePath('/operator/backlinks/prospects');
  return { ok: true, eventId: inserted?.id };
}

export async function updateCompetitorSeeds(
  siteId: string,
  seeds: string[],
): Promise<ActionResult> {
  if (!siteId) return { ok: false, message: 'siteId required' };
  const cleaned = [...new Set(seeds.map((s) => s.trim()).filter(Boolean))];
  const db = getDb();
  const row = (await db.select({ id: sites.id }).from(sites).where(eq(sites.id, siteId)).limit(1))[0];
  if (!row) return { ok: false, message: 'site not found' };
  await db.update(sites).set({ competitorSeeds: cleaned }).where(eq(sites.id, siteId));
  revalidatePath('/operator/backlinks/prospects');
  return { ok: true };
}

const HOST_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;

function normalizeHost(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  let s = input.trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]!.split('?')[0]!;
  return HOST_RE.test(s) ? s : null;
}

export async function suggestCompetitorSeeds(
  siteId: string,
): Promise<ActionResult & { suggestions?: Array<{ domain: string; rationale: string }> }> {
  if (!siteId) return { ok: false, message: 'siteId required' };
  const db = getDb();
  const site = (
    await db
      .select({ id: sites.id, niche: sites.niche, city: sites.city, state: sites.state, domain: sites.domain })
      .from(sites)
      .where(eq(sites.id, siteId))
      .limit(1)
  )[0];
  if (!site) return { ok: false, message: 'site not found' };

  const prompt = `You are an SEO competitive-research assistant. The operator runs a local-service lead-gen site and needs 3 seed competitor domains to feed a backlink-prospecting tool (DataForSEO domain intersection).

Site:
  - Niche: ${site.niche}
  - City: ${site.city}, ${site.state}
  ${site.domain ? `- Own domain (exclude): ${site.domain}` : ''}

Pick 3 high-authority domains that rank well for this niche in this metro. Mix national directories/aggregators (Yelp, Angi, HomeAdvisor, Thumbtack, BBB, etc.) with the strongest local independents you know. Bare hosts only — no protocol, no www., no paths.

Respond ONLY with JSON, no prose, no markdown:
{
  "suggestions": [
    { "domain": "example.com", "rationale": "One short sentence." }
  ]
}`;

  let parsed: { suggestions?: Array<{ domain?: unknown; rationale?: unknown }> };
  let rawText = '';
  try {
    const anthropic = getAnthropicClient();
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    });
    rawText = msg.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('')
      .trim();
    // Tolerate markdown fences or surrounding prose by extracting the
    // outermost {...} block.
    const start = rawText.indexOf('{');
    const end = rawText.lastIndexOf('}');
    const jsonSlice = start !== -1 && end > start ? rawText.slice(start, end + 1) : rawText;
    if (!jsonSlice) throw new Error('empty AI response');
    parsed = JSON.parse(jsonSlice);
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'AI suggestion failed';
    const preview = rawText ? ` (raw: ${rawText.slice(0, 120)})` : '';
    return { ok: false, message: `${detail}${preview}` };
  }

  const ownHost = normalizeHost(site.domain);
  const suggestions: Array<{ domain: string; rationale: string }> = [];
  for (const s of parsed.suggestions ?? []) {
    const domain = normalizeHost(s.domain);
    if (!domain || domain === ownHost) continue;
    if (suggestions.some((x) => x.domain === domain)) continue;
    const rationale = typeof s.rationale === 'string' ? s.rationale.trim() : '';
    suggestions.push({ domain, rationale });
    if (suggestions.length >= 3) break;
  }

  if (suggestions.length === 0) return { ok: false, message: 'no valid suggestions returned' };
  return { ok: true, suggestions };
}

/**
 * Operator manually marks a backlink as `accepted` (e.g. an editor said yes
 * outside the Zoho inbox flow). Emits the same `guest_post.accepted` event
 * MollyInbox emits so MollyCopywriter picks the row up on the next
 * operator-tick. Without this, manually-flipped rows would sit at `accepted`
 * indefinitely.
 */
export async function manuallyAcceptBacklink(id: string): Promise<ActionResult> {
  const db = getDb();
  const row = (await db.select().from(backlinks).where(eq(backlinks.id, id)).limit(1))[0];
  if (!row) return { ok: false, message: 'backlink not found' };
  await db.update(backlinks).set({ status: 'accepted' }).where(eq(backlinks.id, id));
  await db.insert(agentEvents).values({
    agent: 'operator',
    type: 'guest_post.accepted',
    targetAgent: 'molly-copywriter',
    payload: { backlinkId: row.id, site_id: row.siteId },
  });
  revalidatePath('/operator/backlinks');
  return { ok: true };
}

/**
 * Operator approves a MollyCopywriter draft. Flips `draft_pending_review`
 * → `draft_approved`. Delivery is R4.7 — no send happens here.
 */
export async function approveDraft(id: string): Promise<ActionResult> {
  const db = getDb();
  const row = (await db.select().from(backlinks).where(eq(backlinks.id, id)).limit(1))[0];
  if (!row) return { ok: false, message: 'backlink not found' };
  if (row.status !== 'draft_pending_review') {
    return { ok: false, message: `cannot approve row with status=${row.status}` };
  }
  const md = (row.metadata ?? {}) as Record<string, unknown>;
  await db
    .update(backlinks)
    .set({
      status: 'draft_approved',
      metadata: { ...md, draftApprovedAt: new Date().toISOString() },
    })
    .where(eq(backlinks.id, id));
  revalidatePath('/operator/backlinks');
  revalidatePath(`/operator/backlinks/${id}/draft`);
  return { ok: true };
}

/**
 * Operator rejects a MollyCopywriter draft. Returns the row to `accepted`
 * with the rejection reason stamped on metadata.draftRejection so a
 * follow-up regenerate can incorporate it (R4.6 will auto-retry; for R4.5
 * the operator clicks Regenerate explicitly).
 *
 * Clears `draft_markdown` and `anchor_type` so the agent re-runs cleanly.
 */
export async function rejectDraft(id: string, reason: string): Promise<ActionResult> {
  const trimmed = reason.trim();
  if (trimmed.length === 0) return { ok: false, message: 'rejection reason required' };
  const db = getDb();
  const row = (await db.select().from(backlinks).where(eq(backlinks.id, id)).limit(1))[0];
  if (!row) return { ok: false, message: 'backlink not found' };
  if (row.status !== 'draft_pending_review') {
    return { ok: false, message: `cannot reject row with status=${row.status}` };
  }
  const md = (row.metadata ?? {}) as Record<string, unknown>;
  const history = Array.isArray(md.draftRejectionHistory)
    ? (md.draftRejectionHistory as unknown[])
    : [];
  await db
    .update(backlinks)
    .set({
      status: 'accepted',
      draftMarkdown: null,
      anchorType: null,
      metadata: {
        ...md,
        draftRejection: { reason: trimmed, at: new Date().toISOString() },
        draftRejectionHistory: [
          ...history,
          { reason: trimmed, at: new Date().toISOString() },
        ].slice(-10),
      },
    })
    .where(eq(backlinks.id, id));
  revalidatePath('/operator/backlinks');
  revalidatePath(`/operator/backlinks/${id}/draft`);
  return { ok: true };
}

/**
 * Operator re-enqueues MollyCopywriter for an `accepted` row whose previous
 * draft was rejected. Inserts a fresh `guest_post.accepted` event — the
 * agent's per-backlink dedupe key already collapses duplicate events, but
 * the cached-run short-circuit checks `findExistingSuccess` against the
 * dedupe key. To force a regenerate, we override the dedupe key with a
 * timestamped variant via a wrapper run. Easier path: directly invoke the
 * agent here with an explicit dedupe override.
 */
export async function regenerateDraft(id: string): Promise<ActionResult> {
  const db = getDb();
  const row = (await db.select().from(backlinks).where(eq(backlinks.id, id)).limit(1))[0];
  if (!row) return { ok: false, message: 'backlink not found' };
  if (row.status !== 'accepted') {
    return { ok: false, message: `cannot regenerate from status=${row.status}` };
  }
  try {
    const { MollyCopywriter } = await import('@leadlandlord/agents/molly-copywriter');
    const agent = new MollyCopywriter();
    await agent.run(
      { backlinkId: id },
      {
        siteId: row.siteId,
        dedupeKey: `molly-copywriter:${id}:regen:${Date.now()}`,
      },
    );
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
  revalidatePath('/operator/backlinks');
  revalidatePath(`/operator/backlinks/${id}/draft`);
  return { ok: true };
}
