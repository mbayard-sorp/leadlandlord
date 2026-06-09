import Stripe from 'stripe';
import { stripeSecretKey } from '@leadlandlord/shared/env';
import { IntegrationError } from '@leadlandlord/shared/errors';
import { log } from '@leadlandlord/shared/log';
import { assertNotAuditing } from '../audit-guard';

let cached: Stripe | null = null;

/** Resolve the active Stripe client (test by default; live when STRIPE_FORCE_LIVE=true). */
export function getStripe(): Stripe {
  if (cached) return cached;
  const key = stripeSecretKey();
  if (!key) {
    throw new IntegrationError(
      'stripe',
      'No Stripe key set — add STRIPE_SECRET_KEY_TEST or STRIPE_SECRET_KEY to .env.local',
    );
  }
  cached = new Stripe(key, {
    // SDK default API version — set explicitly via the API version pin in
    // the Stripe dashboard rather than here so the same code works across
    // SDK upgrades.
    appInfo: { name: 'leadlandlord', version: '0.1.0' },
  });
  return cached;
}

export interface CreateCheckoutArgs {
  /** Site UUID — used as Stripe customer metadata for cross-link. */
  siteId: string;
  /** Tenant business email (used as Stripe customer email). Optional. */
  tenantEmail?: string;
  /** Tenant phone (E.164). Stored on customer for receipts. */
  tenantPhone?: string;
  /** Tenant business name. Used on Stripe customer + invoices. */
  tenantBusinessName: string;
  /** Recurring monthly rent in USD (e.g. 750.00). */
  monthlyRentUsd: number;
  /** What we're selling — niche + city, e.g. "Tree-removal calls in Tucson, AZ". */
  productName: string;
  /** Where Stripe sends the user after a successful checkout. */
  successUrl: string;
  /** Where Stripe sends the user if they cancel. */
  cancelUrl: string;
  /** Optional metadata to attach to the subscription for our own audit trail. */
  metadata?: Record<string, string>;
}

export interface CreateCheckoutResult {
  /** Hosted Checkout URL — SMS this to the prospect or include in the close call. */
  url: string;
  /** Stripe checkout session id (cs_test_... in sandbox). */
  sessionId: string;
}

/**
 * Create a Stripe Checkout session for a recurring monthly subscription.
 *
 * Uses `price_data` inline (no pre-created Price object) so we can quote a
 * custom monthly rent per-prospect. Stripe creates the Customer + Price +
 * Subscription on first checkout — no setup beyond the one-time API key.
 *
 * Set `success_url` to `https://leadlandlord-operator.vercel.app/operator/...`
 * for now; we'll have a "trial converted" page in a future commit.
 */
export async function createCheckoutLink(args: CreateCheckoutArgs): Promise<CreateCheckoutResult> {
  assertNotAuditing('stripe.createCheckoutLink');
  const stripe = getStripe();
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    success_url: args.successUrl,
    cancel_url: args.cancelUrl,
    customer_email: args.tenantEmail,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: Math.round(args.monthlyRentUsd * 100),
          recurring: { interval: 'month' },
          product_data: {
            name: args.productName,
            description: `LeadLandlord lead-gen subscription for ${args.tenantBusinessName}`,
          },
        },
      },
    ],
    subscription_data: {
      metadata: {
        site_id: args.siteId,
        tenant_business_name: args.tenantBusinessName,
        tenant_phone: args.tenantPhone ?? '',
        ...(args.metadata ?? {}),
      },
    },
    metadata: {
      site_id: args.siteId,
      tenant_business_name: args.tenantBusinessName,
    },
    allow_promotion_codes: true,
    billing_address_collection: 'required',
    phone_number_collection: { enabled: true },
  });
  if (!session.url) {
    throw new IntegrationError('stripe', `checkout session created but no URL: ${session.id}`);
  }
  log.info({ sessionId: session.id, monthlyRentUsd: args.monthlyRentUsd }, 'stripe checkout session created');
  return { url: session.url, sessionId: session.id };
}

/**
 * Verify the Stripe webhook signature and parse the event. Used by
 * /api/webhooks/stripe to authenticate incoming events.
 *
 * Throws IntegrationError on signature mismatch — caller should return 400.
 */
export function verifyWebhookSignature(
  rawBody: string,
  signature: string,
  secret: string,
): Stripe.Event {
  const stripe = getStripe();
  try {
    return stripe.webhooks.constructEvent(rawBody, signature, secret);
  } catch (err) {
    throw new IntegrationError(
      'stripe',
      `webhook signature verification failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** Convenience for Closer Agent: 10-20% of estimated tenant monthly revenue. */
export function recommendedMonthlyRent(estTenantRevenueMonthly: number): number {
  // 15% midpoint, clamped to floor of $250 and ceil of $5,000.
  const raw = estTenantRevenueMonthly * 0.15;
  if (raw < 250) return 250;
  if (raw > 5000) return Math.round(raw / 100) * 100;
  return Math.round(raw / 50) * 50; // round to nearest $50
}
