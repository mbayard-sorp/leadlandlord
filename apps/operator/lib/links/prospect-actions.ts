'use server';

import { revalidatePath } from 'next/cache';
import { eq, and, inArray, sql } from 'drizzle-orm';
import {
  getDb,
  backlinkProspects,
  backlinks,
  sites,
  agentEvents,
  backlinkNicheTastes,
} from '@leadlandlord/db';
import { requireOperatorSession } from '@/lib/auth';

export interface ActionResult {
  ok: boolean;
  message?: string;
}

/**
 * Approve a flagged_top5 prospect.
 * Guards: contactEmail must be present; footprint guard (same domain approved/pitched on another site).
 */
export async function approveProspect(
  prospectId: string,
  contactEmail?: string,
): Promise<ActionResult> {
  await requireOperatorSession();
  const db = getDb();

  const row = (
    await db.select().from(backlinkProspects).where(eq(backlinkProspects.id, prospectId)).limit(1)
  )[0];
  if (!row) return { ok: false, message: 'prospect not found' };
  if (row.status === 'approved' || row.status === 'pitched') {
    return { ok: false, message: `prospect is already ${row.status}` };
  }

  const email = contactEmail?.trim() || row.contactEmail?.trim();
  if (!email) {
    return { ok: false, message: 'contact email required before approving' };
  }

  // Footprint guard: reject if another site already has this domain approved/pitched.
  const conflicts = await db
    .select({ id: backlinkProspects.id, siteId: backlinkProspects.siteId })
    .from(backlinkProspects)
    .where(
      and(
        eq(backlinkProspects.domain, row.domain),
        inArray(backlinkProspects.status, ['approved', 'pitched']),
      ),
    )
    .limit(1);

  const otherSiteConflict = conflicts.find((c) => c.siteId !== row.siteId);
  if (otherSiteConflict) {
    return {
      ok: false,
      message: `Footprint guard: domain ${row.domain} is already approved or pitched for another site.`,
    };
  }

  const now = new Date();
  await db
    .update(backlinkProspects)
    .set({
      status: 'approved',
      approvedAt: now,
      updatedAt: now,
      contactEmail: email,
    })
    .where(eq(backlinkProspects.id, prospectId));

  await db.insert(agentEvents).values({
    agent: 'operator-ui',
    type: 'prospect.approved',
    targetAgent: 'molly',
    payload: {
      mode: 'prospect_approved',
      siteId: row.siteId,
      prospectId,
    },
  });

  revalidatePath('/operator/links');
  return { ok: true };
}

/**
 * Reject a flagged_top5 prospect. Returns it to 'prospected', clears top-5
 * fields, and inserts a backlinkNicheTastes row for future scoring guidance.
 */
export async function rejectProspect(
  prospectId: string,
  reason: string,
): Promise<ActionResult> {
  await requireOperatorSession();
  const db = getDb();

  const row = (
    await db
      .select()
      .from(backlinkProspects)
      .where(eq(backlinkProspects.id, prospectId))
      .limit(1)
  )[0];
  if (!row) return { ok: false, message: 'prospect not found' };

  // Get site niche for the taste record.
  const site = row.siteId
    ? (await db.select({ niche: sites.niche }).from(sites).where(eq(sites.id, row.siteId)).limit(1))[0]
    : null;

  const niche = (site?.niche ?? '').toLowerCase().trim();
  const now = new Date();
  const existing = (row.metadata ?? {}) as Record<string, unknown>;

  await db
    .update(backlinkProspects)
    .set({
      status: 'prospected',
      flaggedTop5At: null,
      score: null,
      rationale: null,
      updatedAt: now,
      metadata: { ...existing, rejectedAt: now.toISOString(), rejectionReason: reason },
    })
    .where(eq(backlinkProspects.id, prospectId));

  // Insert taste record unless a (niche, domain) duplicate exists within 30 days.
  if (niche) {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);
    const existing30 = await db
      .select({ id: backlinkNicheTastes.id })
      .from(backlinkNicheTastes)
      .where(
        and(
          eq(backlinkNicheTastes.niche, niche),
          eq(backlinkNicheTastes.domain, row.domain),
          sql`${backlinkNicheTastes.recordedAt} > ${thirtyDaysAgo.toISOString()}`,
        ),
      )
      .limit(1);

    if (existing30.length === 0) {
      await db.insert(backlinkNicheTastes).values({
        niche,
        domain: row.domain,
        reason: reason.trim() || 'operator_rejected',
        prospectId,
      });
    }
  }

  revalidatePath('/operator/links');
  return { ok: true };
}

/**
 * Snooze a prospect for N days. Sets metadata.snoozedUntil + snoozeReason.
 */
export async function snoozeProspect(
  prospectId: string,
  days: number,
  reason?: string,
): Promise<ActionResult> {
  await requireOperatorSession();
  const db = getDb();

  const row = (
    await db
      .select({ id: backlinkProspects.id, metadata: backlinkProspects.metadata })
      .from(backlinkProspects)
      .where(eq(backlinkProspects.id, prospectId))
      .limit(1)
  )[0];
  if (!row) return { ok: false, message: 'prospect not found' };

  const until = new Date(Date.now() + days * 86400000).toISOString();
  const existing = (row.metadata ?? {}) as Record<string, unknown>;

  await db
    .update(backlinkProspects)
    .set({
      metadata: { ...existing, snoozedUntil: until, snoozeReason: reason ?? '' },
      updatedAt: new Date(),
    })
    .where(eq(backlinkProspects.id, prospectId));

  revalidatePath('/operator/links');
  return { ok: true };
}

/**
 * Update contact fields on a prospect. Sets contactState to 'guessed' since the
 * operator is supplying the information.
 */
export async function setProspectContact(
  prospectId: string,
  email: string,
  name?: string,
): Promise<ActionResult> {
  await requireOperatorSession();
  const trimmed = email.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return { ok: false, message: 'invalid email' };
  }

  const db = getDb();
  const row = (
    await db
      .select({ id: backlinkProspects.id })
      .from(backlinkProspects)
      .where(eq(backlinkProspects.id, prospectId))
      .limit(1)
  )[0];
  if (!row) return { ok: false, message: 'prospect not found' };

  await db
    .update(backlinkProspects)
    .set({
      contactEmail: trimmed,
      contactName: name?.trim() || null,
      contactState: 'guessed',
      updatedAt: new Date(),
    })
    .where(eq(backlinkProspects.id, prospectId));

  revalidatePath('/operator/links');
  return { ok: true };
}
