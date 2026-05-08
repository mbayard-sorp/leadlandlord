# First-Close Postmortem (Phase C)

> Filled in during/after the first paid tenant close.

## Site selected
- Site:
- Niche × city:
- Why chosen (call volume, SEO traction, etc.):

## Prospect picked for first live outreach
- Business name:
- Phone / email:
- Source (Google Places / referral / etc.):

## Manual interventions during outreach (Day 0–5)
| Step | Auto/manual | Issue | Proposed fix |
|------|-------------|-------|--------------|

## Trial week call log
- Calls received:
- Won:
- Quoted:
- Lost:
- Notes:

## Closer call/email
- AI voice quality (1-5):
- Email open / click status:
- Stripe Checkout link delivered:
- Operator interventions:

## Stripe checkout
- Payment method captured:
- Subscription ID:
- First invoice paid:
- Issues:

## Time-to-MRR (in hours/days from initial outreach)

## Top 3 things to automate before next close

## Top 3 things that worked unexpectedly well

---

## Pre-flight known gaps (from Phase C audit)

These were identified during the Phase C dev-team prep pass and should be
considered before the first live close:

1. **Stripe Billing Portal stub** (`packages/agents/src/billing-dunning/index.ts`
   `buildPaymentUpdateUrl`) — points at `${OPERATOR_PUBLIC_URL}/billing/portal`
   which is not implemented. Before the first dunning step fires, mint a real
   Stripe Billing Portal session via
   `stripe.billingPortal.sessions.create({ customer, return_url })`. Not
   blocking the first close (only matters on payment failure).

2. **Trial Manager forwarding flip** (`packages/agents/src/trial-manager/index.ts`
   `startTrial`) — only updates `sites.forwardingNumber` in the DB; the
   Twilio voice webhook reads this per-call so functionally correct, but
   nothing calls `tracking-setup` to refresh Twilio's VoiceUrl on the
   IncomingPhoneNumber. Verify the number's VoiceUrl points at this
   operator's `/api/webhooks/twilio/voice` BEFORE trial start.

3. **Closer Agent Stripe Checkout** verified to call
   `createCheckoutLink` with `subscription_data.metadata.{trial_id, prospect_id, site_id}`
   — webhook (`apps/operator/app/api/webhooks/stripe/route.ts`) reads these
   from `session.metadata`. Confirmed wired for `checkout.session.completed`.

4. **Stripe webhook idempotency** — added in Phase C via
   `stripe_webhook_events` table + `INSERT ... ON CONFLICT DO NOTHING` at
   handler entry. Stripe retries on 5xx and re-delivers occasionally; this
   prevents double-tenant-creation.

5. **Dunning POBox/return address** in email body is the literal string
   `"PO Box (replace), USA"` — replace before the first dunning email.
