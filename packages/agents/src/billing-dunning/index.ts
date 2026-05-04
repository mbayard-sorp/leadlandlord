import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { getDb, invoices, tenants, sites } from '@leadlandlord/db';
import { sendSms } from '@leadlandlord/integrations/twilio';
import { sendEmail } from '@leadlandlord/integrations/resend';
import { startOutboundCall } from '@leadlandlord/integrations/elevenlabs';
import { BaseAgent, type AgentContext } from '../base';

/**
 * Billing & Dunning — 7-day payment recovery sequence per the plan:
 *
 *   Day 1 → SMS    "Heads up, last invoice didn't go through. Update card here: …"
 *   Day 2 → email  full body with link
 *   Day 4 → voice  ElevenLabs Conversational AI calls the tenant
 *   Day 7 → SMS    "Last shot before we have to pause your calls"
 *
 * Triggered by `billing.invoice_failed` events emitted by the Stripe webhook
 * (P6.6) when `invoice.payment_failed` fires. The Operator schedules this
 * agent for each step on a calendar — for the MVP we expose `step` as input
 * and let the cron pass which step to run on a given day.
 *
 * Dedupe by (invoice_id, step) so retries within a day are no-ops.
 */

export const BillingDunningStep = z.enum(['sms_day_1', 'email_day_2', 'voice_day_4', 'sms_day_7']);
export type BillingDunningStep = z.infer<typeof BillingDunningStep>;

export const BillingDunningInput = z.object({
  invoice_id: z.string().uuid(),
  step: BillingDunningStep,
});
export type BillingDunningInput = z.infer<typeof BillingDunningInput>;

export const BillingDunningOutput = z.object({
  invoice_id: z.string().uuid(),
  step: BillingDunningStep,
  channel: z.enum(['sms', 'email', 'voice']),
  status: z.enum(['sent', 'skipped', 'failed', 'recovered']),
  message: z.string().optional(),
});
export type BillingDunningOutput = z.infer<typeof BillingDunningOutput>;

export class BillingDunning extends BaseAgent<typeof BillingDunningInput, typeof BillingDunningOutput> {
  constructor() {
    super({
      name: 'billing-dunning',
      inputSchema: BillingDunningInput,
      outputSchema: BillingDunningOutput,
      dedupeKeyFn: (i) => `${i.invoice_id}:${i.step}`,
      defaultDailyCapUsd: 3,
    });
  }

  protected async execute(
    input: BillingDunningInput,
    ctx: AgentContext,
  ): Promise<BillingDunningOutput> {
    const db = getDb();

    const invoice = (await db.select().from(invoices).where(eq(invoices.id, input.invoice_id)).limit(1))[0];
    if (!invoice) {
      throw new Error(`invoice ${input.invoice_id} not found`);
    }
    // If the invoice has already been paid (Stripe re-tried + succeeded), don't dunn.
    if (invoice.status === 'paid' || invoice.status === 'recovered') {
      return {
        invoice_id: invoice.id,
        step: input.step,
        channel: channelForStep(input.step),
        status: 'recovered',
        message: 'Invoice already settled — skipping outreach',
      };
    }

    const tenant = (await db.select().from(tenants).where(eq(tenants.id, invoice.tenantId)).limit(1))[0];
    if (!tenant) {
      throw new Error(`tenant ${invoice.tenantId} not found for invoice ${invoice.id}`);
    }
    const site = tenant.siteId
      ? (await db.select().from(sites).where(eq(sites.id, tenant.siteId)).limit(1))[0]
      : undefined;

    const channel = channelForStep(input.step);
    const updateUrl = buildPaymentUpdateUrl(tenant.stripeCustomerId);
    const amountUsd = Number.parseFloat(invoice.amountUsd);

    let status: 'sent' | 'skipped' | 'failed' = 'skipped';
    let message: string | undefined;

    try {
      switch (channel) {
        case 'sms': {
          const from = process.env.TWILIO_FROM_NUMBER;
          if (!from || !tenant.phone) {
            message = 'Missing TWILIO_FROM_NUMBER or tenant.phone';
            break;
          }
          const body = renderSms(input.step, tenant.businessName, amountUsd, updateUrl);
          await sendSms({ to: tenant.phone, from, body });
          status = 'sent';
          break;
        }
        case 'email': {
          const from = process.env.RESEND_FROM_ADDRESS;
          if (!from || !tenant.email) {
            message = 'Missing RESEND_FROM_ADDRESS or tenant.email';
            break;
          }
          const body = renderEmail(tenant.businessName, amountUsd, updateUrl);
          await sendEmail({
            to: tenant.email,
            from,
            subject: `Action required: payment for ${site?.niche ?? 'your subscription'} didn't go through`,
            text: body,
          });
          status = 'sent';
          break;
        }
        case 'voice': {
          if (!tenant.phone) {
            message = 'Tenant has no phone';
            break;
          }
          const res = await startOutboundCall({
            toNumber: tenant.phone,
            dynamicVariables: {
              first_name: firstNameOf(tenant.contactName),
              business_name: tenant.businessName,
              niche: site?.niche ?? 'lead-gen subscription',
              city: site?.city ?? '',
              amount_usd: amountUsd.toFixed(0),
              update_url: updateUrl,
            },
            firstMessage: `Hi ${firstNameOf(tenant.contactName)}, this is LeadLandlord — calling about a billing issue on your account. Got a quick second?`,
          });
          message = `Voice conversation ${res.conversation_id}`;
          status = 'sent';
          break;
        }
      }
    } catch (err) {
      status = 'failed';
      message = err instanceof Error ? err.message : String(err);
      ctx.log.error({ invoiceId: invoice.id, step: input.step, err: message }, 'dunning step failed');
    }

    ctx.log.info(
      { invoiceId: invoice.id, step: input.step, channel, status },
      'dunning step done',
    );

    return {
      invoice_id: invoice.id,
      step: input.step,
      channel,
      status,
      message,
    };
  }
}

function channelForStep(step: BillingDunningStep): 'sms' | 'email' | 'voice' {
  switch (step) {
    case 'sms_day_1':
    case 'sms_day_7':
      return 'sms';
    case 'email_day_2':
      return 'email';
    case 'voice_day_4':
      return 'voice';
  }
}

function buildPaymentUpdateUrl(stripeCustomerId: string | null): string {
  // Stripe Billing Portal — tenants can update their payment method without
  // any custom UI on our side. We'd typically POST to /v1/billing_portal/sessions
  // to mint a fresh link with a return_url; for now point at a stub the
  // operator can replace with a real billing-portal redirect handler.
  const base = (process.env.OPERATOR_PUBLIC_URL ?? 'https://leadlandlord-operator.vercel.app').replace(/\/$/, '');
  if (!stripeCustomerId) return `${base}/billing/portal`;
  return `${base}/billing/portal?customer=${encodeURIComponent(stripeCustomerId)}`;
}

function renderSms(step: BillingDunningStep, businessName: string, amountUsd: number, updateUrl: string): string {
  const amount = amountUsd > 0 ? `$${amountUsd.toFixed(0)}` : '';
  switch (step) {
    case 'sms_day_1':
      return `LeadLandlord: heads up — last invoice ${amount} for ${businessName} didn't go through. Update your card to keep calls flowing: ${updateUrl}. Reply STOP to opt out.`;
    case 'sms_day_7':
      return `LeadLandlord: last shot — ${businessName}'s invoice ${amount} is still unpaid. Calls will pause if not resolved. Update card: ${updateUrl}. Reply STOP to opt out.`;
    default:
      return `LeadLandlord: payment update needed for ${businessName}. ${updateUrl}. Reply STOP to opt out.`;
  }
}

function renderEmail(businessName: string, amountUsd: number, updateUrl: string): string {
  const amount = amountUsd > 0 ? `$${amountUsd.toFixed(2)}` : 'your invoice';
  return [
    `Hi,`,
    '',
    `Heads up — your last LeadLandlord invoice (${amount}) for ${businessName} didn't go through. Most often it's an expired card or a temporary bank issue.`,
    '',
    `Update your payment method here so we can keep forwarding calls to you:`,
    updateUrl,
    '',
    `If you'd like to cancel instead, just reply with "cancel" and we'll wind it down. Otherwise we'll keep sending calls.`,
    '',
    `— LeadLandlord`,
    '',
    `If you'd rather not hear from us, reply with "unsubscribe".`,
    `LeadLandlord, PO Box (replace), USA`,
  ].join('\n');
}

function firstNameOf(full: string | null | undefined): string {
  if (!full) return 'there';
  return full.trim().split(/\s+/)[0] ?? 'there';
}
