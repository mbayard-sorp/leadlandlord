# ADR 0013 — First-Party Core Web Vitals Field Data Collection

**Date:** 2026-05-20
**Status:** Accepted

---

## Context

LeadLandlord operates a multi-tenant site renderer (`apps/site-host`) serving tenant contractor sites keyed by Host header. We want first-party, early-warning CWV field data (LCP, CLS, INP, FCP, TTFB) across all four variant templates without paying for Vercel Speed Insights ($10/mo). GSC CrUX data is free but lags by weeks and requires traffic thresholds.

This is internal observability only — not a product analytics platform, not a selling point to tenants.

Key constraints:
- `apps/site-host` is NOT a full static export (`output: 'export'` is absent from `next.config.ts`). It uses ISR/RSC for page rendering but runs as a live Node.js Vercel deployment. Runtime route handlers work.
- The existing `/api/lead` proxy in site-host proves the pattern: site-host handles browser POSTs, strips context, forwards to operator with `x-leadlandlord-host`, operator owns the DB write.
- Operator DB is Drizzle + Neon Postgres. Schema already has `lighthouseAudits`, `seoMetricsDaily`, `ga4MetricsDaily` as precedent for time-series metric storage.
- Endpoint is public and unauthenticated — `sendBeacon` cannot set auth headers.

---

## Decision

### 1. Endpoint placement: site-host proxy + operator ingest

A `POST /api/cwv` route in site-host proxies to `apps/operator/app/api/cwv`. Identical to the `/api/lead` proxy:
- Browser sends `sendBeacon` to same-origin `/api/cwv` (no CORS friction).
- site-host attaches `x-leadlandlord-host` and forwards the stripped payload to operator.
- Operator route owns Zod validation, host-to-siteId resolution, and the DB upsert.
- site-host never imports `@leadlandlord/db`.

Alternative considered: operator-only endpoint with CORS. Rejected because CORS headers add complexity, `sendBeacon` to cross-origin URLs has subtle browser inconsistencies, and the proxy pattern is already load-bearing and understood.

### 2. Storage: pre-aggregated daily rollups, not raw samples

Table: `cwv_daily_rollups`, unique on `(site_id, metric_date, metric_name)`.

Columns: `sample_count`, `value_sum`, `p75_approx` (exponential moving average), `rating_good / rating_needs_improvement / rating_poor` counters, `variant` (theme name).

Upsert pattern on every ingest: `INSERT ... ON CONFLICT (site_id, metric_date, metric_name) DO UPDATE SET sample_count = sample_count + 1, value_sum = value_sum + EXCLUDED.value_sum, ...`

The `variant` column is the primary observability axis — it answers "is INP degrading on the premium template across all sites?" without joining to the sites table.

Retention: 90 days, enforced by extending the existing backups cron to `DELETE WHERE metric_date < NOW() - INTERVAL '90 days'`.

Raw per-pageview rows were rejected. At 50 sites x 2,000 sessions/month = 100,000+ rows/month growing unboundedly. The rollup approach costs one row per (site, day, metric) — at 50 sites x 5 metrics x 365 days = 91,250 rows/year, trivially small.

### 3. Client wiring

New `'use client'` component `WebVitalsReporter.tsx` mounted in `RootLayout`, server-side gated on `NODE_ENV === 'production'`.

Uses `useReportWebVitals` from Next.js App Router (no additional npm dependency — Next bundles web-vitals internally). Each metric callback fires `navigator.sendBeacon('/api/cwv', ...)`. Payload: `{ name, value, rating }` only. No URL, no user agent, no siteId — host resolution is server-side.

### 4. Abuse mitigations

- Unknown host: look up siteId from `x-leadlandlord-host`; if no match, return 200 and write nothing.
- Zod schema: `name` is an enum of 5 known metric names; `value` is an integer bounded by metric-specific max (60,000ms for timing metrics, 10,000 milli-units for CLS); `rating` is a 3-value enum.
- Volume cap: if `sample_count` for `(siteId, today, metricName)` exceeds 10,000, silently drop. Bots do not trigger Web Vitals lifecycle events.
- No PII stored in the rollup row.

---

## Consequences

**Positive:**
- Zero incremental cost (Neon storage for ~91k rows/year is negligible; site-host function invocations are already paid for).
- Variant-level regression detection before GSC CrUX has enough traffic.
- Follows established proxy seam — reviewers already understand the pattern.
- No new npm dependencies in site-host.

**Negative / watch:**
- `p75_approx` via EMA is an approximation, not a true p75. Sufficient for trend detection; inadequate for SLA enforcement. Acceptable for this use case.
- The site-host proxy adds one cross-region fetch per beacon. `sendBeacon` fires on page unload — this is background latency, invisible to the user. `after()` could be used in the proxy to avoid blocking the 200 response back to the browser.
- If `useReportWebVitals` import path changes between Next minor versions, the component silently stops collecting. Pin the import; test after Next upgrades.

---

## Files

| Action | Path |
|--------|------|
| New | `apps/site-host/app/api/cwv/route.ts` |
| New | `apps/site-host/components/shared/WebVitalsReporter.tsx` |
| New | `apps/operator/app/api/cwv/route.ts` |
| New | `packages/db/migrations/0029_cwv_daily_rollups.sql` |
| Modified | `packages/db/src/schema.ts` |
| Modified | `apps/site-host/app/layout.tsx` |
