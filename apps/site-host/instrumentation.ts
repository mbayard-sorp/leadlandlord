/**
 * Next.js instrumentation hook. Loads Sentry server / edge configs when a
 * DSN is configured. No-ops when NEXT_PUBLIC_SENTRY_DSN is unset so dev /
 * preview builds without an org Sentry project don't try to phone home.
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

export { captureRequestError as onRequestError } from '@sentry/nextjs';
