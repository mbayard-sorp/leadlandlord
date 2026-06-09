import { and, eq } from 'drizzle-orm';
import { getDb, agentApprovals } from '@leadlandlord/db';
import { MOLLY_OUTREACH_KIND, MOLLY_AGENT_NAME, executeMollyOutreach } from '../molly/approval';
import { decideBcc, recordBccSend } from '../molly/bcc';
import type { ScheduledEvent } from './types';

/**
 * Molly post-approval send sweep — the execute-on-approval half of the
 * approve-before-send gate (ADR-0006 R4.x).
 *
 * Molly's outbound external sends (initial pitch, each nudge, draft delivery)
 * never go out inline. The gate at each send site calls `queueMollyOutreach`,
 * which inserts an `agentApprovals` row (`kind='molly_outreach'`,
 * `status='pending'`) capturing the verbatim email and then SKIPS the direct
 * send. An operator approves the row in the operator UI, flipping it to
 * `status='approved'`. Nothing else in the codebase reads approved rows and
 * dispatches the side effect — this sweep is that dispatcher.
 *
 * Each tick:
 *   1. Select `molly_outreach` rows that are `approved` (not yet `executed`).
 *   2. Re-evaluate the BCC graduation decision NOW (it is intentionally not
 *      persisted on the approval payload — a row may sit in the queue for days
 *      and graduation state can change in that window).
 *   3. Call `executeMollyOutreach(id, { bcc })`, which sends (Zoho reply for
 *      nudges, Zoho/Resend otherwise), records to `email_sends`, writes
 *      `backlinks.messageId` for pitches, and marks the row `executed` so a
 *      re-run cannot double-send.
 *   4. On a successful send, increment the BCC graduation counter.
 *
 * This function performs side effects directly (sends) rather than emitting
 * `ScheduledEvent`s, because the send is fully self-contained in
 * `executeMollyOutreach` and there is no executor agent in the registry. It
 * returns an empty event list to satisfy the `Scheduler` shape the cron route
 * expects.
 *
 * Dedupe/idempotency: `executeMollyOutreach` is idempotency-guarded — it only
 * acts on `approved`/`auto_approved` rows and flips them to `executed`, so a
 * duplicate cron tick that re-selects a now-`executed` row is a no-op there.
 */
export async function scheduleMollyApprovals(): Promise<ScheduledEvent[]> {
  const db = getDb();

  // ZOHO_MOLLY_ENABLED is the master switch — short-circuit when off so we
  // don't dispatch sends while Molly is disabled. Approved rows simply wait.
  if (process.env.ZOHO_MOLLY_ENABLED !== 'true') return [];

  const rows = await db
    .select({ id: agentApprovals.id })
    .from(agentApprovals)
    .where(
      and(
        eq(agentApprovals.kind, MOLLY_OUTREACH_KIND),
        eq(agentApprovals.status, 'approved'),
      ),
    );

  for (const r of rows) {
    // Re-evaluate graduation at execute time (pure read — does not increment).
    const decision = await decideBcc(MOLLY_AGENT_NAME);
    const result = await executeMollyOutreach(r.id, { bcc: decision.bcc, db });

    // Only count a send against the BCC graduation counter when it actually
    // went out. Skipped/failed rows leave the counter untouched.
    if (result.sent) {
      await recordBccSend(MOLLY_AGENT_NAME);
    }
  }

  return [];
}
