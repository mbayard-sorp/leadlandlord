import type { ErrorEvent, EventHint } from '@sentry/nextjs';
type Event = ErrorEvent;

/**
 * Drop-list for known noise. We deliberately don't page on:
 *   - Twilio webhook timeouts (Twilio retries on its own; we ack idempotently)
 *   - Stripe retry attempts (the second event lands the work)
 *   - KillSwitchActiveError / BudgetExceededError (intentional refusals — the
 *     operator is already informed via the kill-switch UI / budget panel)
 *   - AgentDisabledError (deliberate operator action)
 *
 * Returning null drops the event before transport — Sentry quota saved.
 */
export function beforeSend(event: Event, hint: EventHint): Event | null {
  const err = hint?.originalException;
  const errName = (err as { name?: string } | undefined)?.name ?? '';
  const errMessage = (err as { message?: string } | undefined)?.message ?? event.message ?? '';
  const errCode = (err as { code?: string } | undefined)?.code ?? '';

  if (
    errName === 'KillSwitchActiveError' ||
    errName === 'BudgetExceededError' ||
    errName === 'AgentDisabledError' ||
    errCode === 'KILL_SWITCH_ACTIVE' ||
    errCode === 'BUDGET_EXCEEDED' ||
    errCode === 'AGENT_DISABLED'
  ) {
    return null;
  }

  if (/twilio.*timeout|ECONNRESET.*twilio|twilio.*ETIMEDOUT/i.test(errMessage)) {
    return null;
  }
  if (/stripe.*retry|stripe-signature.*timestamp/i.test(errMessage)) {
    return null;
  }

  return event;
}
