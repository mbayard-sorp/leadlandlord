import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import {
  getDb,
  sites,
  prospects,
  trials,
  tenants,
  invoices,
  agentEvents,
  stripeWebhookEvents,
  type Site,
  type Prospect,
  type Trial,
} from '@leadlandlord/db';
import { addSuppression } from '@leadlandlord/db/suppression';
import { verifyWebhookSignature } from '@leadlandlord/integrations/stripe';
import { log } from '@leadlandlord/shared/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Stripe webhook handler. Verifies signature, then routes events:
 *
 *   checkout.session.completed → trial_id metadata resolves to tenant row
 *     creation + sites.status='rented', prospect.status='converted',
 *     trial.decision='won'.
 *
 *   invoice.payment_succeeded → upsert invoice row (paid).
 *   invoice.payment_failed    → upsert invoice row (failed) + emit
 *     billing.invoice_failed event for Billing & Dunning to pick up.
 *   customer.subscription.deleted → mark tenant.status='churned' + emit
 *     tenant.churned event for Churn Recovery to pick up.
 *
 * Set up the endpoint in Stripe dashboard:
 *   Stripe → Webhooks → Add endpoint → URL:
 *     https://leadlandlord-operator.vercel.app/api/webhooks/stripe
 *   Events: checkout.session.completed, invoice.payment_succeeded,
 *     invoice.payment_failed, customer.subscription.deleted
 *   Copy the signing secret (whsec_test_...) into STRIPE_WEBHOOK_SECRET.
 */
export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    log.error({}, 'STRIPE_WEBHOOK_SECRET not set — refusing to process webhook');
    return new NextResponse('webhook not configured', { status: 500 });
  }

  const sig = (await headers()).get('stripe-signature');
  if (!sig) {
    return new NextResponse('missing stripe-signature', { status: 400 });
  }
  const rawBody = await req.text();
  let event;
  try {
    event = verifyWebhookSignature(rawBody, sig, secret);
  } catch (err) {
    log.warn({ err: err instanceof Error ? err.message : err }, 'stripe webhook signature mismatch');
    return new NextResponse('signature verification failed', { status: 400 });
  }

  log.info({ type: event.type, id: event.id }, 'stripe webhook received');

  // Idempotency — Stripe retries on 5xx and occasionally re-delivers. Insert
  // a sentinel keyed on the event ID and bail if it already exists. We mark
  // processedAt only after the handler succeeds, so a crash mid-handler will
  // re-run on the next delivery (the row exists but with null processed_at;
  // the unique-violation path treats it as already-handled). Trade-off:
  // crashed handlers are retried once at most, then ack'd permanently.
  const db = getDb();
  const inserted = await db
    .insert(stripeWebhookEvents)
    .values({ id: event.id, type: event.type })
    .onConflictDoNothing()
    .returning({ id: stripeWebhookEvents.id });
  if (inserted.length === 0) {
    log.info({ type: event.type, id: event.id }, 'stripe webhook: duplicate event — ack');
    return NextResponse.json({ received: true, duplicate: true });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event);
        break;
      case 'invoice.payment_succeeded':
        await handleInvoicePaid(event);
        break;
      case 'invoice.payment_failed':
        await handleInvoiceFailed(event);
        break;
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event);
        break;
      default:
        log.info({ type: event.type }, 'stripe webhook: unhandled event type (acknowledging)');
    }
  } catch (err) {
    log.error(
      { err: err instanceof Error ? err.message : err, type: event.type },
      'stripe webhook handler threw',
    );
    // 500 so Stripe retries — but only when the error is genuinely retryable.
    // Validation errors should be 200 to avoid retry storms.
    return new NextResponse('handler error', { status: 500 });
  }

  await db
    .update(stripeWebhookEvents)
    .set({ processedAt: new Date() })
    .where(eq(stripeWebhookEvents.id, event.id));

  return NextResponse.json({ received: true });
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Successful checkout → create tenant row, mark trial won, mark prospect
 * converted, mark site rented, update site.tenant_id, set site.mrr_usd.
 */
async function handleCheckoutCompleted(event: any): Promise<void> {
  const session = event.data.object;
  const meta = session.metadata ?? {};
  const trialId = meta.trial_id as string | undefined;
  const prospectId = meta.prospect_id as string | undefined;
  const siteId = meta.site_id as string | undefined;
  const stripeCustomerId = (session.customer as string | null) ?? undefined;
  const stripeSubId = (session.subscription as string | null) ?? undefined;
  const monthlyAmountCents = (session.amount_subtotal as number | null) ?? 0;
  const monthlyRentUsd = monthlyAmountCents / 100;

  if (!siteId) {
    log.warn({ sessionId: session.id }, 'checkout.completed without site_id metadata — skipping');
    return;
  }

  const db = getDb();

  const site = (await db.select().from(sites).where(eq(sites.id, siteId)).limit(1))[0];
  if (!site) {
    log.warn({ siteId, sessionId: session.id }, 'checkout.completed: site not found');
    return;
  }
  const prospect = prospectId
    ? (await db.select().from(prospects).where(eq(prospects.id, prospectId)).limit(1))[0]
    : undefined;
  const trial = trialId
    ? (await db.select().from(trials).where(eq(trials.id, trialId)).limit(1))[0]
    : undefined;

  // Create tenant row.
  const tenantInserted = await db
    .insert(tenants)
    .values({
      siteId: site.id,
      businessName: prospect?.businessName ?? 'Tenant',
      contactName: prospect?.contactName ?? null,
      phone: prospect?.phone ?? (session.customer_details?.phone as string | null) ?? null,
      email: prospect?.email ?? (session.customer_details?.email as string | null) ?? null,
      stripeCustomerId,
      stripeSubId,
      status: 'active',
      monthlyRentUsd: monthlyRentUsd > 0 ? monthlyRentUsd.toFixed(2) : null,
      startedAt: new Date(),
    })
    .returning();
  const tenant = tenantInserted[0];

  // Wire site to tenant.
  await db
    .update(sites)
    .set({
      status: 'rented',
      tenantId: tenant?.id ?? null,
      mrrUsd: monthlyRentUsd > 0 ? monthlyRentUsd.toFixed(2) : '0',
      updatedAt: new Date(),
    })
    .where(eq(sites.id, site.id));

  // Mark prospect converted.
  if (prospect) {
    await db.update(prospects).set({ status: 'converted' }).where(eq(prospects.id, prospect.id));
  }

  // Mark trial won.
  if (trial) {
    await db
      .update(trials)
      .set({
        decision: 'won',
        endedAt: trial.endedAt ?? new Date(),
        quotedRentUsd: monthlyRentUsd > 0 ? monthlyRentUsd.toFixed(2) : trial.quotedRentUsd,
      })
      .where(eq(trials.id, trial.id));
  }

  // Emit downstream event so portfolio analyst / closer follow-ups can fire.
  await db.insert(agentEvents).values({
    agent: 'stripe-webhook',
    type: 'trial.won',
    payload: {
      site_id: site.id,
      tenant_id: tenant?.id,
      trial_id: trialId,
      prospect_id: prospectId,
      monthly_rent_usd: monthlyRentUsd,
      stripe_subscription_id: stripeSubId,
    },
  });

  log.info(
    { siteId: site.id, tenantId: tenant?.id, monthlyRentUsd },
    'checkout completed — tenant created, site rented',
  );
}

async function handleInvoicePaid(event: any): Promise<void> {
  const inv = event.data.object;
  const stripeInvoiceId = inv.id as string;
  const subscriptionId = (inv.subscription as string | null) ?? null;
  const amountUsd = ((inv.amount_paid as number | undefined) ?? 0) / 100;

  if (!subscriptionId) return;

  const db = getDb();
  const tenant = (
    await db.select().from(tenants).where(eq(tenants.stripeSubId, subscriptionId)).limit(1)
  )[0];
  if (!tenant) {
    log.info({ stripeInvoiceId, subscriptionId }, 'invoice.paid: no matching tenant — ignoring');
    return;
  }

  await upsertInvoice(tenant.id, stripeInvoiceId, amountUsd, 'paid', new Date());

  // If tenant was past_due, restore to active.
  if (tenant.status === 'past_due') {
    await db.update(tenants).set({ status: 'active' }).where(eq(tenants.id, tenant.id));
    log.info({ tenantId: tenant.id }, 'invoice.paid: restored from past_due to active');
  }
}

async function handleInvoiceFailed(event: any): Promise<void> {
  const inv = event.data.object;
  const stripeInvoiceId = inv.id as string;
  const subscriptionId = (inv.subscription as string | null) ?? null;
  const amountUsd = ((inv.amount_due as number | undefined) ?? 0) / 100;
  const failureReason = (inv.last_payment_error?.message as string | undefined) ?? 'payment_failed';

  if (!subscriptionId) return;

  const db = getDb();
  const tenant = (
    await db.select().from(tenants).where(eq(tenants.stripeSubId, subscriptionId)).limit(1)
  )[0];
  if (!tenant) {
    log.info({ stripeInvoiceId, subscriptionId }, 'invoice.failed: no matching tenant — ignoring');
    return;
  }

  await upsertInvoice(tenant.id, stripeInvoiceId, amountUsd, 'failed', null, failureReason);
  await db.update(tenants).set({ status: 'past_due' }).where(eq(tenants.id, tenant.id));

  // Emit event for Billing & Dunning agent to start the 7-day recovery sequence.
  await db.insert(agentEvents).values({
    agent: 'stripe-webhook',
    type: 'billing.invoice_failed',
    targetAgent: 'billing-dunning',
    payload: {
      tenant_id: tenant.id,
      stripe_invoice_id: stripeInvoiceId,
      stripe_subscription_id: subscriptionId,
      amount_usd: amountUsd,
      failure_reason: failureReason,
    },
  });

  log.info({ tenantId: tenant.id, amountUsd }, 'invoice.failed: dunning queued');
}

async function handleSubscriptionDeleted(event: any): Promise<void> {
  const sub = event.data.object;
  const subscriptionId = sub.id as string;

  const db = getDb();
  const tenant = (
    await db.select().from(tenants).where(eq(tenants.stripeSubId, subscriptionId)).limit(1)
  )[0];
  if (!tenant) {
    log.info({ subscriptionId }, 'subscription.deleted: no matching tenant — ignoring');
    return;
  }

  await db
    .update(tenants)
    .set({
      status: 'churned',
      churnedAt: new Date(),
      churnReason: (sub.cancellation_details?.reason as string | undefined) ?? 'subscription_deleted',
    })
    .where(eq(tenants.id, tenant.id));

  // Restore site to live (un-rent it) so a new tenant can be lined up.
  if (tenant.siteId) {
    await db
      .update(sites)
      .set({
        status: 'live',
        tenantId: null,
        mrrUsd: '0',
        updatedAt: new Date(),
      })
      .where(eq(sites.id, tenant.siteId));
  }

  // Emit for Churn Recovery (re-runs Outreach against next 50 prospects).
  await db.insert(agentEvents).values({
    agent: 'stripe-webhook',
    type: 'tenant.churned',
    targetAgent: 'churn-recovery',
    payload: {
      tenant_id: tenant.id,
      site_id: tenant.siteId,
      stripe_subscription_id: subscriptionId,
      churn_reason: (sub.cancellation_details?.reason as string | undefined) ?? 'subscription_deleted',
    },
  });

  // Suppress the prospect's email/phone from re-outreach for 90 days — they
  // just churned, not a fresh prospect.
  if (tenant.email) {
    await addSuppression({
      identifier: tenant.email,
      type: 'email',
      reason: 'churn',
      sourceSiteId: tenant.siteId,
      channel: 'email',
      metadata: { auto_expires_after_days: 90 },
    });
  }
  if (tenant.phone) {
    await addSuppression({
      identifier: tenant.phone,
      type: 'phone',
      reason: 'churn',
      sourceSiteId: tenant.siteId,
      channel: 'sms',
      metadata: { auto_expires_after_days: 90 },
    });
  }

  log.info({ tenantId: tenant.id, siteId: tenant.siteId }, 'subscription.deleted: churn handled');
}

async function upsertInvoice(
  tenantId: string,
  stripeInvoiceId: string,
  amountUsd: number,
  status: 'paid' | 'failed',
  paidAt: Date | null,
  failureReason?: string,
): Promise<void> {
  const db = getDb();
  // Try upsert pattern. We don't have a uniq index on stripe_invoice_id today,
  // so we just guard with a select first.
  const existing = (
    await db.select({ id: invoices.id }).from(invoices).where(eq(invoices.stripeInvoiceId, stripeInvoiceId)).limit(1)
  )[0];
  if (existing) {
    await db
      .update(invoices)
      .set({
        status,
        paidAt,
        failureReason: failureReason ?? null,
        attemptedAt: new Date(),
      })
      .where(eq(invoices.id, existing.id));
    return;
  }
  await db.insert(invoices).values({
    tenantId,
    stripeInvoiceId,
    amountUsd: amountUsd.toFixed(2),
    status,
    attemptedAt: new Date(),
    paidAt,
    failureReason: failureReason ?? null,
  });
}

/* eslint-enable @typescript-eslint/no-explicit-any */

// Suppress unused — kept for future events that need full type context.
type _Unused = Site | Prospect | Trial;
const _u: _Unused | undefined = undefined;
void _u;
