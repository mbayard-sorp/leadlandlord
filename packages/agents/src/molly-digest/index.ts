import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { getDb } from '@leadlandlord/db';
import { sendEmail as sendEmailZoho } from '@leadlandlord/integrations/zoho-mcp';
import { sendEmail as sendEmailResend } from '@leadlandlord/integrations/resend';
import { BaseAgent, type AgentContext } from '../base';
import { MOLLY_PERSONA } from '../molly/persona';

/**
 * Daily 7am MST digest for Molly outreach activity. Counts last-24h sends,
 * replies, escalations, and per-site activity, then emails a single summary
 * to a human reviewer.
 *
 * Activated only after Molly graduates from BCC mode (ADR-0006). The
 * `molly-digest` scheduler enforces this; the agent itself runs the email
 * unconditionally because its dedupe key (`molly-digest:<date>`) prevents
 * duplicate sends on cron retry.
 *
 * Recipient resolution: MOLLY_DIGEST_TO env, then MOLLY_BCC_ADDRESS, then
 * abort (logged warning, not an error — there's no work to do if nobody is
 * configured to receive the digest).
 */

const MollyDigestInput = z.object({
  /** YYYY-MM-DD of the digest window. Used for dedupe + subject line. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const MollyDigestOutput = z.object({
  date: z.string(),
  sent: z.boolean(),
  recipient: z.string().nullable(),
  counts: z.object({
    pitchesSent: z.number(),
    repliesReceived: z.number(),
    escalated: z.number(),
    perSite: z.array(z.object({ siteId: z.string(), pitches: z.number() })),
  }),
});

export class MollyDigest extends BaseAgent<typeof MollyDigestInput, typeof MollyDigestOutput> {
  constructor() {
    super({
      name: 'molly-digest',
      inputSchema: MollyDigestInput,
      outputSchema: MollyDigestOutput,
      defaultDailyCapUsd: 1,
      dedupeKeyFn: (input) => `molly-digest:${input.date}`,
    });
  }

  protected async execute(
    input: z.infer<typeof MollyDigestInput>,
    ctx: AgentContext,
  ): Promise<z.infer<typeof MollyDigestOutput>> {
    const db = getDb();
    const mollyMailbox = process.env.ZOHO_MOLLY_FROM ?? MOLLY_PERSONA.mailbox;

    // 24h window ending at "now". Using the scheduler's natural cron tick as
    // the boundary rather than a calendar-day cutoff so a slightly-late cron
    // run still reports the full day.
    const sendsRows = (await db.execute(sql`
      SELECT site_id, COUNT(*)::int AS pitches
      FROM email_sends
      WHERE mailbox = ${mollyMailbox}
        AND purpose = 'guest_post'
        AND status = 'sent'
        AND sent_at >= NOW() - INTERVAL '24 hours'
      GROUP BY site_id
    `)) as unknown as { rows: Array<{ site_id: string | null; pitches: number }> }
      | Array<{ site_id: string | null; pitches: number }>;
    const sendsList = Array.isArray(sendsRows) ? sendsRows : sendsRows.rows;
    const pitchesSent = sendsList.reduce((acc, r) => acc + Number(r.pitches), 0);
    const perSite = sendsList
      .filter((r) => r.site_id)
      .map((r) => ({ siteId: r.site_id as string, pitches: Number(r.pitches) }));

    // Reply / escalation counts come from backlink status transitions. The
    // status enum was extended in 0018; rows will populate once R4.4
    // (MollyInbox) is shipped. Until then these read zero, which is
    // accurate.
    const replyRows = (await db.execute(sql`
      SELECT COUNT(*)::int AS n
      FROM backlinks
      WHERE type = 'guest_post'
        AND status = 'reply_received'
        AND updated_at >= NOW() - INTERVAL '24 hours'
    `)) as unknown as { rows: Array<{ n: number }> } | Array<{ n: number }>;
    const escRows = (await db.execute(sql`
      SELECT COUNT(*)::int AS n
      FROM backlinks
      WHERE type = 'guest_post'
        AND status = 'escalated'
        AND updated_at >= NOW() - INTERVAL '24 hours'
    `)) as unknown as { rows: Array<{ n: number }> } | Array<{ n: number }>;
    const repliesReceived = Number(
      (Array.isArray(replyRows) ? replyRows[0] : replyRows.rows[0])?.n ?? 0,
    );
    const escalated = Number(
      (Array.isArray(escRows) ? escRows[0] : escRows.rows[0])?.n ?? 0,
    );

    const recipient = process.env.MOLLY_DIGEST_TO ?? process.env.MOLLY_BCC_ADDRESS ?? null;
    const counts = { pitchesSent, repliesReceived, escalated, perSite };

    if (!recipient) {
      ctx.log.warn({ date: input.date }, 'molly-digest: no recipient configured — skipping send');
      return { date: input.date, sent: false, recipient: null, counts };
    }

    const subject = `Molly daily digest — ${input.date}`;
    const lines = [
      `Molly outreach summary for ${input.date}:`,
      ``,
      `  Pitches sent (last 24h):    ${pitchesSent}`,
      `  Replies received:           ${repliesReceived}`,
      `  Escalated to human review:  ${escalated}`,
      ``,
    ];
    if (perSite.length > 0) {
      lines.push(`Per-site breakdown:`);
      for (const s of perSite) lines.push(`  ${s.siteId}: ${s.pitches} pitch${s.pitches === 1 ? '' : 'es'}`);
    } else {
      lines.push(`No site activity in this window.`);
    }
    lines.push(``);
    lines.push(`— Molly Digest (post-graduation auto-report)`);
    const body = lines.join('\n');

    const useZoho = process.env.ZOHO_MOLLY_ENABLED === 'true' || process.env.ZOHO_MCP_ENABLED === 'true';
    const from = useZoho
      ? (process.env.ZOHO_MOLLY_FROM ?? MOLLY_PERSONA.mailbox)
      : (process.env.RESEND_FROM_ADDRESS ?? mollyMailbox);

    try {
      if (useZoho) {
        await sendEmailZoho({ to: recipient, from, subject, text: body });
      } else {
        await sendEmailResend({ to: recipient, from, subject, text: body });
      }
      ctx.log.info({ recipient, pitchesSent, repliesReceived, escalated }, 'molly-digest: sent');
      return { date: input.date, sent: true, recipient, counts };
    } catch (err) {
      ctx.log.error(
        { err: err instanceof Error ? err.message : String(err), recipient },
        'molly-digest: send failed',
      );
      return { date: input.date, sent: false, recipient, counts };
    }
  }
}
