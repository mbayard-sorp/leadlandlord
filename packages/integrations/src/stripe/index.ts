import { NotImplementedError } from '@leadlandlord/shared/errors';

export interface CreateCheckoutArgs {
  tenantId: string;
  monthlyRentUsd: number;
  successUrl: string;
  cancelUrl: string;
}

export async function createCheckoutLink(_args: CreateCheckoutArgs): Promise<{ url: string }> {
  // TODO(phase-3): Stripe Checkout session for monthly subscription.
  throw new NotImplementedError('stripe.createCheckoutLink');
}

export async function handleWebhook(_payload: unknown, _signature: string): Promise<void> {
  // TODO(phase-3): verify signature, route invoice.payment_failed to billing-dunning,
  // route subscription.deleted to churn-recovery.
  throw new NotImplementedError('stripe.handleWebhook');
}
