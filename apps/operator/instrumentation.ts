/**
 * Next.js instrumentation hook. Loads Sentry server / edge configs in the
 * appropriate runtime. Re-exports onRequestError so server-side errors get
 * captured by Sentry automatically.
 *
 * Docs: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */
export async function register() {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

// Sentry's onRequestError captures server-side errors thrown by RSC + route
// handlers + server actions. Wired here so any new route handler we add
// participates without per-route boilerplate.
export { captureRequestError as onRequestError } from '@sentry/nextjs';
