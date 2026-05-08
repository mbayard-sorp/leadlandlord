import { z } from 'zod';
import { eq } from 'drizzle-orm';
import {
  getDb,
  prospects,
  sites,
  outreachEvents,
  type Prospect,
  type Site,
} from '@leadlandlord/db';
import { sendSms } from '@leadlandlord/integrations/twilio';
import { sendEmail } from '@leadlandlord/integrations/resend';
import { startOutboundCall } from '@leadlandlord/integrations/elevenlabs';
import { BaseAgent, type AgentContext } from '../base';
import { ComplianceGuard } from '../compliance-guard/index';

/**
 * Outreach Agent — runs ONE outreach step against ONE prospect.
 *
 * Step ordering for the cold sequence (caller decides which step to run):
 *   - sms_day_0   — SMS, "Hey, free week of {niche} calls in {city}?"
 *   - email_day_1 — same offer in email form
 *   - voice_day_3 — ElevenLabs Conversational AI bridged via Twilio
 *   - sms_day_5   — final SMS, "Last shot, here's the link"
 *
 * Higher-level scheduling (which step to run when) is handled by an
 * orchestrator agent or cron — this agent just executes the step it's told
 * to. ComplianceGuard runs before every send; suppressed recipients are
 * blocker'd. Outreach events are recorded for full audit trail.
 *
 * Per-prospect dedupe key prevents the same step running twice on retries.
 */

export const OutreachStep = z.enum(['sms_day_0', 'email_day_1', 'voice_day_3', 'sms_day_5']);
export type OutreachStep = z.infer<typeof OutreachStep>;

export const OutreachAgentInput = z.object({
  prospect_id: z.string().uuid(),
  step: OutreachStep,
  /** Override the auto-rendered message body. */
  body_override: z.string().optional(),
  /**
   * Dry-run mode: render the script + persist an outreach_events row tagged
   * `metadata.dryRun: true` and channel `<channel>_dryrun`, but skip the
   * actual send and DO NOT advance prospect.status. Per-input override; if
   * unset, the env flag `OUTREACH_DRY_RUN=true` enables dry-run globally.
   * Used by the operator preview UI before the first live close.
   */
  dryRun: z.boolean().optional(),
});
export type OutreachAgentInput = z.infer<typeof OutreachAgentInput>;

export const OutreachAgentOutput = z.object({
  prospect_id: z.string().uuid(),
  step: OutreachStep,
  status: z.enum(['sent', 'blocked', 'skipped', 'failed', 'dryrun']),
  channel: z.enum(['sms', 'email', 'voice']),
  message: z.string().optional(),
  external_id: z.string().optional(),
  violations: z.array(z.unknown()).default([]),
});
export type OutreachAgentOutput = z.infer<typeof OutreachAgentOutput>;

export class OutreachAgent extends BaseAgent<typeof OutreachAgentInput, typeof OutreachAgentOutput> {
  private readonly compliance = new ComplianceGuard();

  constructor() {
    super({
      name: 'outreach-agent',
      inputSchema: OutreachAgentInput,
      outputSchema: OutreachAgentOutput,
      dedupeKeyFn: (i) => `${i.prospect_id}:${i.step}`,
      defaultDailyCapUsd: 10,
    });
  }

  protected async execute(
    input: OutreachAgentInput,
    ctx: AgentContext,
  ): Promise<OutreachAgentOutput> {
    const db = getDb();

    // Load prospect + site context.
    const prospect = (await db.select().from(prospects).where(eq(prospects.id, input.prospect_id)).limit(1))[0];
    if (!prospect) {
      throw new Error(`prospect ${input.prospect_id} not found`);
    }
    const site = (await db.select().from(sites).where(eq(sites.id, prospect.siteId)).limit(1))[0];
    if (!site) {
      throw new Error(`site ${prospect.siteId} not found`);
    }

    const channel = channelForStep(input.step);
    const recipient = recipientFor(prospect, channel);
    if (!recipient) {
      ctx.log.warn(
        { prospectId: prospect.id, step: input.step, channel },
        'outreach: no recipient on prospect — skipping',
      );
      await db
        .insert(outreachEvents)
        .values({
          prospectId: prospect.id,
          channel,
          templateId: input.step,
          response: null,
          metadata: { status: 'skipped', reason: 'no_recipient' },
        });
      return {
        prospect_id: prospect.id,
        step: input.step,
        status: 'skipped',
        channel,
        violations: [],
      };
    }

    const body = input.body_override ?? renderBody(input.step, prospect, site);

    // Compliance check — runs the suppression-list lookup + body checks.
    const compliance = await this.compliance.run(
      {
        scope: scopeForStep(input.step),
        text: body,
        recipient,
      },
      { siteId: site.id, parentRunId: ctx.runId },
    );

    if (!compliance.ok) {
      ctx.log.warn(
        { prospectId: prospect.id, step: input.step, violations: compliance.violations },
        'outreach blocked by compliance-guard',
      );
      await db.insert(outreachEvents).values({
        prospectId: prospect.id,
        channel,
        templateId: input.step,
        response: null,
        metadata: { status: 'blocked', violations: compliance.violations },
      });
      return {
        prospect_id: prospect.id,
        step: input.step,
        status: 'blocked',
        channel,
        violations: compliance.violations,
      };
    }

    // Dry-run short-circuit. Render the body + persist an outreach_events
    // row tagged for the operator preview UI, then return without touching
    // the live integrations. Prospect status is NOT advanced.
    const dryRun = input.dryRun ?? process.env.OUTREACH_DRY_RUN === 'true';
    if (dryRun) {
      ctx.log.info(
        { prospectId: prospect.id, step: input.step, channel },
        'outreach: dry-run — skipping live send',
      );
      await db.insert(outreachEvents).values({
        prospectId: prospect.id,
        channel: `${channel}_dryrun`,
        templateId: input.step,
        response: null,
        metadata: {
          status: 'dryrun',
          dryRun: true,
          recipient,
          body,
          ...(channel === 'email'
            ? { subject: renderSubject(input.step, prospect, site) }
            : {}),
        },
      });
      return {
        prospect_id: prospect.id,
        step: input.step,
        status: 'dryrun',
        channel,
        message: body,
        violations: [],
      };
    }

    // Dispatch.
    let externalId: string | undefined;
    let status: 'sent' | 'failed' = 'sent';
    let failMessage: string | undefined;
    try {
      switch (channel) {
        case 'sms': {
          const from = process.env.TWILIO_FROM_NUMBER;
          if (!from) throw new Error('TWILIO_FROM_NUMBER not set');
          const res = await sendSms({ to: recipient, from, body });
          externalId = res.sid;
          break;
        }
        case 'email': {
          const from = process.env.RESEND_FROM_ADDRESS;
          if (!from) throw new Error('RESEND_FROM_ADDRESS not set');
          const subject = renderSubject(input.step, prospect, site);
          const res = await sendEmail({ to: recipient, from, subject, text: body });
          externalId = res.messageId;
          break;
        }
        case 'voice': {
          const res = await startOutboundCall({
            toNumber: recipient,
            dynamicVariables: dynamicVarsFor(prospect, site),
            firstMessage: body, // first thing the agent says when the call connects
          });
          externalId = res.conversation_id;
          break;
        }
      }
    } catch (err) {
      status = 'failed';
      failMessage = err instanceof Error ? err.message : String(err);
      ctx.log.error(
        { prospectId: prospect.id, step: input.step, err: failMessage },
        'outreach send failed',
      );
    }

    await db.insert(outreachEvents).values({
      prospectId: prospect.id,
      channel,
      templateId: input.step,
      response: null,
      metadata: {
        status,
        external_id: externalId,
        body,
        ...(failMessage ? { error: failMessage } : {}),
      },
    });

    if (status === 'sent') {
      await db
        .update(prospects)
        .set({
          lastOutreachAt: new Date(),
          status: 'contacted',
        })
        .where(eq(prospects.id, prospect.id));
    }

    return {
      prospect_id: prospect.id,
      step: input.step,
      status,
      channel,
      message: failMessage,
      external_id: externalId,
      violations: [],
    };
  }
}

function channelForStep(step: OutreachStep): 'sms' | 'email' | 'voice' {
  switch (step) {
    case 'sms_day_0':
    case 'sms_day_5':
      return 'sms';
    case 'email_day_1':
      return 'email';
    case 'voice_day_3':
      return 'voice';
  }
}

function scopeForStep(step: OutreachStep): 'outreach_sms' | 'outreach_email' | 'outreach_voice' {
  const channel = channelForStep(step);
  return `outreach_${channel}` as const;
}

function recipientFor(prospect: Prospect, channel: 'sms' | 'email' | 'voice'): string | null {
  if (channel === 'email') return prospect.email;
  return prospect.phone;
}

function dynamicVarsFor(prospect: Prospect, site: Site): Record<string, string> {
  return {
    niche: site.niche,
    city: site.city,
    state: site.state,
    business_name: prospect.businessName,
    first_name: firstNameOf(prospect.contactName),
    tracking_number: site.trackingNumber ?? '',
  };
}

function firstNameOf(full: string | null | undefined): string {
  if (!full) return 'there';
  const trimmed = full.trim();
  if (!trimmed) return 'there';
  return trimmed.split(/\s+/)[0] ?? 'there';
}

/**
 * Render the message body for a given step. Kyle's casual tone — short,
 * direct, asks a single question. STOP keyword is appended automatically to
 * SMS bodies for compliance.
 */
function renderBody(step: OutreachStep, prospect: Prospect, site: Site): string {
  const firstName = firstNameOf(prospect.contactName);
  const niche = site.niche;
  const city = site.city;
  const trackingNumber = site.trackingNumber ?? '(call us)';

  switch (step) {
    case 'sms_day_0':
      return `Hey ${firstName}, I run a ${niche} site getting calls in ${city}. Want a free week of these calls forwarded to your line? Reply YES or STOP.`;
    case 'email_day_1':
      return [
        `Hi ${firstName},`,
        '',
        `I sent you a quick text yesterday but figured I'd follow up here too.`,
        '',
        `Quick version: I run a website that gets calls from people looking for ${niche} in ${city}. ` +
          `Right now those calls are coming in unattached — I'd rather forward them to a real local ${niche} business than let them sit.`,
        '',
        `If you'd like a free week of these calls forwarded to your line so you can see what they're worth, just hit reply with "yes" and I'll set it up. ` +
          `No contract, no fee — if it's a fit after the week, we work out a flat monthly rate for the calls. If not, no harm done.`,
        '',
        `— LeadLandlord`,
        ``,
        `If you'd rather not hear from me, reply with "unsubscribe" and you're out.`,
        ``,
        `LeadLandlord, PO Box (replace), ${city}`,
      ].join('\n');
    case 'voice_day_3':
      return `Hi ${firstName}, this is the ${niche} calls thing in ${city}. You free for a quick 60 seconds?`;
    case 'sms_day_5':
      return `Hey ${firstName} — last shot. Free week of ${niche} calls forwarded to ${trackingNumber}. Reply YES or STOP.`;
  }
}

function renderSubject(step: OutreachStep, _prospect: Prospect, site: Site): string {
  switch (step) {
    case 'email_day_1':
      return `${site.niche} calls in ${site.city} — free week if you want them`;
    default:
      return `${site.niche} in ${site.city}`;
  }
}
