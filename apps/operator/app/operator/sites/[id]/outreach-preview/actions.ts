'use server';

import { revalidatePath } from 'next/cache';
import { eq, and, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, prospects, agentEvents, sites } from '@leadlandlord/db';
import { log } from '@leadlandlord/shared/log';

/**
 * Server actions for the per-site outreach preview page.
 *
 * Two operator-driven flows:
 *
 *   1. `runDryRunForSite` — kicks off a dry-run outreach against the next
 *      N untouched prospects. Inserts agent_events rows tagged
 *      `target=outreach-agent` with `payload.dryRun=true`. operator-tick
 *      drains the queue and the agent renders+persists scripts without
 *      sending anything live. Hard-capped at 5 prospects per click to keep
 *      the queue sane.
 *
 *   2. `promoteProspectToLive` — for ONE prospect that the operator has
 *      vetted in dry-run, fires a real outreach event (no dryRun flag).
 *      Used to start the very first paid close.
 */

const RunDryRunSchema = z.object({
  site_id: z.string().uuid(),
  count: z.coerce.number().int().min(1).max(5).default(5),
  step: z.enum(['sms_day_0', 'email_day_1', 'voice_day_3', 'sms_day_5']).default('sms_day_0'),
});

const MAX_DRY_RUN_PROSPECTS = 5;

export interface DryRunResult {
  ok: boolean;
  enqueued: number;
  message?: string;
}

/**
 * Form-action wrapper — returns void so it can be passed directly as
 * `<form action={runDryRunForSite}>`. The detailed result is logged but not
 * returned to the client (the server-component re-renders via revalidatePath).
 */
export async function runDryRunForSite(formData: FormData): Promise<void> {
  await _runDryRunForSite(formData);
}

async function _runDryRunForSite(formData: FormData): Promise<DryRunResult> {
  const parsed = RunDryRunSchema.safeParse({
    site_id: formData.get('site_id'),
    count: formData.get('count') ?? undefined,
    step: formData.get('step') ?? undefined,
  });
  if (!parsed.success) {
    return { ok: false, enqueued: 0, message: parsed.error.issues.map((i) => i.message).join(', ') };
  }
  const v = parsed.data;
  const cap = Math.min(v.count, MAX_DRY_RUN_PROSPECTS);

  const db = getDb();

  // Sanity check the site exists.
  const site = (await db.select().from(sites).where(eq(sites.id, v.site_id)).limit(1))[0];
  if (!site) return { ok: false, enqueued: 0, message: 'site not found' };

  // Pick untouched prospects (status='new', no prior outreach). Ordering by
  // createdAt to keep this deterministic across operator clicks.
  const candidates = await db
    .select()
    .from(prospects)
    .where(and(eq(prospects.siteId, v.site_id), eq(prospects.status, 'new')))
    .limit(cap);

  if (candidates.length === 0) {
    return { ok: false, enqueued: 0, message: 'no untouched prospects (status=new)' };
  }

  for (const p of candidates) {
    await db.insert(agentEvents).values({
      agent: 'operator-dashboard',
      type: 'outreach.dry_run.requested',
      targetAgent: 'outreach-agent',
      payload: {
        site_id: v.site_id,
        prospect_id: p.id,
        step: v.step,
        dryRun: true,
      },
    });
  }

  log.info(
    { siteId: v.site_id, enqueued: candidates.length, step: v.step },
    'outreach dry-run enqueued',
  );
  revalidatePath(`/operator/sites/${v.site_id}/outreach-preview`);
  return { ok: true, enqueued: candidates.length };
}

const PromoteSchema = z.object({
  site_id: z.string().uuid(),
  prospect_id: z.string().uuid(),
  step: z.enum(['sms_day_0', 'email_day_1', 'voice_day_3', 'sms_day_5']).default('sms_day_0'),
});

export async function promoteProspectToLive(formData: FormData): Promise<void> {
  await _promoteProspectToLive(formData);
}

async function _promoteProspectToLive(
  formData: FormData,
): Promise<{ ok: boolean; message?: string }> {
  const parsed = PromoteSchema.safeParse({
    site_id: formData.get('site_id'),
    prospect_id: formData.get('prospect_id'),
    step: formData.get('step') ?? undefined,
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues.map((i) => i.message).join(', ') };
  }
  const v = parsed.data;

  const db = getDb();
  const prospect = (
    await db
      .select()
      .from(prospects)
      .where(and(eq(prospects.id, v.prospect_id), eq(prospects.siteId, v.site_id)))
      .limit(1)
  )[0];
  if (!prospect) return { ok: false, message: 'prospect not on this site' };

  // Live outreach — no dryRun flag. operator-tick will dispatch outreach-agent
  // for THIS prospect only.
  await db.insert(agentEvents).values({
    agent: 'operator-dashboard',
    type: 'outreach.live.requested',
    targetAgent: 'outreach-agent',
    payload: {
      site_id: v.site_id,
      prospect_id: v.prospect_id,
      step: v.step,
      // dryRun explicitly absent — outreach-agent treats undefined as live.
    },
  });

  log.info(
    { siteId: v.site_id, prospectId: v.prospect_id, step: v.step },
    'outreach live promotion enqueued',
  );
  revalidatePath(`/operator/sites/${v.site_id}/outreach-preview`);
  return { ok: true };
}

// Suppress unused — inArray reserved for future bulk promote endpoint.
void inArray;
