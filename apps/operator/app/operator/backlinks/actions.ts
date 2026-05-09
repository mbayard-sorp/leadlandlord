'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { getDb, backlinks, sites } from '@leadlandlord/db';
import { sendEmail as sendEmailResend } from '@leadlandlord/integrations/resend';
import { sendEmail as sendEmailZoho } from '@leadlandlord/integrations/zoho-mcp';
import { recordSend } from '@leadlandlord/db/email-throttle';

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
 * Triggers a Backlink Builder prospect run for the given site. Wraps the
 * existing agent — the agent itself enforces Apollo cap, dedupe, and
 * compliance. Returns the agent's structured output for UI feedback.
 */
export async function runProspectForSite(args: {
  siteId: string;
  competitorOverride?: string[];
  maxApolloEnrichments?: number;
  autoSend?: boolean;
}): Promise<ActionResult & { discovered?: number; enriched?: number; created?: number }> {
  const db = getDb();
  const site = (await db.select().from(sites).where(eq(sites.id, args.siteId)).limit(1))[0];
  if (!site) return { ok: false, message: 'site not found' };

  // Hard-gate against Apollo cap before invoking the agent.
  const usage = await getApolloMonthlyUsage();
  if (usage.remaining <= 0) {
    return {
      ok: false,
      message: `Apollo monthly cap reached (${usage.used}/${usage.cap}). Wait until ${nextMonthLabel()} or raise APOLLO_MONTHLY_CAP.`,
    };
  }

  // Lazy import — keeps the agents bundle out of the operator's edge build
  // when the action isn't called.
  const { BacklinkBuilder } = await import('@leadlandlord/agents/backlink-builder');
  const agent = new BacklinkBuilder();

  const requested = args.maxApolloEnrichments ?? 15;
  const capLimited = Math.min(requested, usage.remaining);

  try {
    // Operator-triggered runs override the agent's natural dedupe so a
    // fix-and-retry loop isn't blocked by a cached zero-result. Each UI
    // click is intentional, not an event-driven duplicate.
    const forceDedupeKey = `prospect:operator:${args.siteId}:${Date.now()}`;
    const out = await agent.run(
      {
        mode: 'prospect',
        siteId: args.siteId,
        competitorOverride: args.competitorOverride,
        maxApolloEnrichments: capLimited,
        autoSend: args.autoSend ?? false,
      },
      { siteId: args.siteId, dedupeKey: forceDedupeKey },
    );
    revalidatePath('/operator/backlinks/prospects');
    return {
      ok: true,
      discovered: out.prospectsDiscovered,
      enriched: out.prospectsEnriched,
      created: out.rowsCreated,
    };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

function nextMonthLabel(): string {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() + 1, 1);
  return d.toISOString().slice(0, 10);
}
