import type { ErrorEvent, EventHint } from '@sentry/nextjs';
type Event = ErrorEvent;

/**
 * Drop-list for site-host. The shared site renderer rarely throws but when
 * it does, the noisy-but-expected cases we suppress are:
 *   - 404 from `notFound()` calls (Next throws an internal NEXT_NOT_FOUND)
 *   - Sanity client read timeouts (handled at the page level — Suspense
 *     fallback renders, no user impact)
 *   - PageNotFoundError / unrecognized host while DNS is propagating
 */
export function beforeSend(event: Event, hint: EventHint): Event | null {
  const err = hint?.originalException;
  const errName = (err as { name?: string } | undefined)?.name ?? '';
  const errMessage = (err as { message?: string } | undefined)?.message ?? event.message ?? '';
  const digest = (err as { digest?: string } | undefined)?.digest ?? '';

  if (digest === 'NEXT_NOT_FOUND' || /NEXT_NOT_FOUND/.test(errMessage)) return null;
  if (errName === 'PageNotFoundError') return null;
  if (/sanity.*timeout|sanity.*ETIMEDOUT/i.test(errMessage)) return null;

  return event;
}
