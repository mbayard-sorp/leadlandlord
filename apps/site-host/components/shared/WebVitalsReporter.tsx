'use client';

import { useReportWebVitals } from 'next/web-vitals';

/**
 * ADR 0013 — First-party Core Web Vitals field data collection.
 *
 * Fires navigator.sendBeacon('/api/cwv') on each metric callback. sendBeacon
 * is fire-and-forget: it runs on page unload without blocking navigation and
 * cannot set auth headers (which is why the operator route is unauthenticated).
 *
 * Mounted in RootLayout gated on NODE_ENV === 'production' so dev builds are
 * not polluted with beacon noise. Wrapped in try/catch so any error in this
 * component can never break page rendering.
 *
 * Import: 'next/web-vitals' — the hook is bundled inside Next.js (no
 * additional npm dependency). Verify this path after Next.js major upgrades.
 */
export function WebVitalsReporter() {
  useReportWebVitals((metric) => {
    try {
      const payload = JSON.stringify({
        name: metric.name,
        value: metric.value,
        rating: metric.rating,
      });
      if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
        navigator.sendBeacon('/api/cwv', new Blob([payload], { type: 'application/json' }));
      }
    } catch {
      // Observability must never break the page.
    }
  });

  return null;
}
