'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { getDb, backlinks, sites, agentEvents } from '@leadlandlord/db';
import { sendEmail as sendEmailResend } from '@leadlandlord/integrations/resend';
import { sendEmail as sendEmailZoho } from '@leadlandlord/integrations/zoho-mcp';
import { recordSend } from '@leadlandlord/db/email-throttle';
import { getAnthropicClient } from '@leadlandlord/integrations/anthropic';

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
  const { draftGuestPostPitch } = await import('@leadlandlord/agents/backlink-builder');
  let subject: string;
  let body: string;
  try {
    const drafted = await draftGuestPostPitch({
      targetDomain: row.sourceDomain,
      pitchTopic,
      niche: site.niche,
      city: site.city,
      state: site.state,
    });
    subject = drafted.subject;
    body = drafted.body;
  } catch (err) {
    return {
      ok: false,
      message: `draft failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  await db
    .update(backlinks)
    .set({
      pitchDraft: body,
      subjectLine: subject,
      metadata: {
        ...md,
        targetEditorEmail: trimmed,
        pitchTopic,
        prospect: {
          ...((md.prospect ?? {}) as Record<string, unknown>),
          needsManualEditor: false,
          editorEmailManual: true,
          draftedAt: new Date().toISOString(),
        },
      },
    })
    .where(eq(backlinks.id, id));
  revalidatePath('/operator/backlinks/prospects');
  return { ok: true };
}

/**
 * Operator-approved send for a queue-only prospect row. Reads the pitch
 * draft + recipient from the row's metadata, dispatches via the existing
 * Zoho/Resend pipeline, and flips status to `submitted`. Mirrors the
 * Backlink Builder guest_post send path so on-the-wire behavior matches
 * what we'll see when training wheels come off.
 */
export async function sendProspect(id: string): Promise<ActionResult> {
  const db = getDb();
  const row = (await db.select().from(backlinks).where(eq(backlinks.id, id)).limit(1))[0];
  if (!row) return { ok: false, message: 'backlink not found' };
  if (row.status !== 'pending') {
    return { ok: false, message: `cannot send row with status=${row.status}` };
  }
  if (row.type !== 'guest_post') {
    return { ok: false, message: `sendProspect only handles guest_post rows (got ${row.type})` };
  }

  const md = (row.metadata ?? {}) as Record<string, unknown>;
  const toAddress = typeof md.targetEditorEmail === 'string' ? md.targetEditorEmail : null;
  if (!toAddress) return { ok: false, message: 'metadata.targetEditorEmail missing' };

  // Draft on-the-fly if missing. Happens for rows whose email was saved
  // before the auto-draft logic landed, or any caller that supplies an
  // email without explicitly drafting first.
  let subject: string;
  let body: string;
  if (row.pitchDraft) {
    subject = row.subjectLine ?? `Guest post idea for ${row.sourceDomain}`;
    body = row.pitchDraft;
  } else {
    const site = (await db.select().from(sites).where(eq(sites.id, row.siteId)).limit(1))[0];
    if (!site) return { ok: false, message: 'site not found for backlink' };
    const pitchTopic =
      typeof md.pitchTopic === 'string'
        ? md.pitchTopic
        : `Guide to ${site.niche} for homeowners in ${site.city}`;
    try {
      const { draftGuestPostPitch } = await import('@leadlandlord/agents/backlink-builder');
      const drafted = await draftGuestPostPitch({
        targetDomain: row.sourceDomain,
        pitchTopic,
        niche: site.niche,
        city: site.city,
        state: site.state,
      });
      subject = drafted.subject;
      body = drafted.body;
      // Persist the freshly-drafted pitch so a re-send doesn't re-draft.
      await db
        .update(backlinks)
        .set({
          pitchDraft: body,
          subjectLine: subject,
          metadata: {
            ...md,
            pitchTopic,
            prospect: {
              ...((md.prospect ?? {}) as Record<string, unknown>),
              draftedAt: new Date().toISOString(),
            },
          },
        })
        .where(eq(backlinks.id, id));
    } catch (err) {
      return {
        ok: false,
        message: `draft failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  const useZoho = process.env.ZOHO_MCP_ENABLED === 'true';
  const mailbox = useZoho
    ? (process.env.ZOHO_DEFAULT_FROM ?? '')
    : (process.env.RESEND_FROM_ADDRESS ?? '');
  if (!mailbox) {
    return {
      ok: false,
      message: useZoho ? 'ZOHO_DEFAULT_FROM not set' : 'RESEND_FROM_ADDRESS not set',
    };
  }

  let externalId: string | undefined;
  let sendError: string | undefined;
  try {
    if (useZoho) {
      const res = await sendEmailZoho({ to: toAddress, from: mailbox, subject, text: body });
      externalId = res.messageId;
    } else {
      const res = await sendEmailResend({ to: toAddress, from: mailbox, subject, text: body });
      externalId = res.messageId;
    }
  } catch (err) {
    sendError = err instanceof Error ? err.message : String(err);
  }

  await recordSend({
    siteId: row.siteId,
    mailbox,
    toAddress,
    subject,
    purpose: 'guest_post',
    provider: useZoho ? 'zoho' : 'resend',
    externalId: externalId ?? null,
    status: sendError ? 'failed' : 'sent',
    errorMessage: sendError ?? null,
  });

  if (sendError) {
    return { ok: false, message: `send failed: ${sendError}` };
  }

  await db
    .update(backlinks)
    .set({
      status: 'submitted',
      metadata: {
        ...md,
        operatorApproved: true,
        operatorApprovedAt: new Date().toISOString(),
        externalId: externalId ?? null,
      },
    })
    .where(eq(backlinks.id, id));

  revalidatePath('/operator/backlinks');
  revalidatePath('/operator/backlinks/prospects');
  return { ok: true };
}

/**
 * Aggregate Apollo usage in the current calendar month. Each prospect row
 * with `metadata.prospect.apolloPersonId` consumed one Apollo person-reveal
 * credit. Used to gate runs against the free-tier 75-lookup cap surfaced
 * in the operator UI.
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
  // Count `prospect`-stamped backlink rows created this month. Each represents
  // exactly one Apollo enrichment (the agent only inserts a row after a
  // successful findEditorByDomain call).
  const rows = await db
    .select({ id: backlinks.id, metadata: backlinks.metadata, createdAt: backlinks.createdAt })
    .from(backlinks);
  let used = 0;
  for (const r of rows) {
    if (!r.createdAt || new Date(r.createdAt) < monthStart) continue;
    const md = (r.metadata ?? {}) as Record<string, unknown>;
    const p = md.prospect as Record<string, unknown> | undefined;
    if (p && p.apolloPersonId) used += 1;
  }
  return {
    used,
    cap,
    remaining: Math.max(0, cap - used),
    monthKey: monthStart.toISOString().slice(0, 7),
  };
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
}): Promise<ActionResult & { eventId?: string }> {
  if (!args.siteId) return { ok: false, message: 'siteId required' };

  const cap = Math.min(Math.max(1, args.maxApolloEnrichments ?? 15), 100);

  const db = getDb();
  const site = (await db.select({ id: sites.id }).from(sites).where(eq(sites.id, args.siteId)).limit(1))[0];
  if (!site) return { ok: false, message: 'site not found' };

  const [inserted] = await db
    .insert(agentEvents)
    .values({
      agent: 'operator',
      type: 'operator.prospect.requested',
      targetAgent: 'backlink-builder',
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
