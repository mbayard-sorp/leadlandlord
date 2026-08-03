# Deprecations

<!-- compliance-guard was previously listed here as deferred; it is live (ON) as of 2026-07-20 — see orchestrator/disposition.ts. -->

| Item | Status | Reason | Sprint | Date |
|------|--------|--------|--------|------|
| `packages/agents/src/backlink-builder/` | Removed | Replaced by backlink-copycat + citation-runner (Sprint 3-4) | 0 | 2026-05-14 |
| `scripts/test-agent-zoho-send.ts` | Removed | Coupled to backlink-builder; no replacement needed | 0 | 2026-05-14 |
| Architectural voice overlay (system.md) | Applied | Locale-saturation rules + forbidden patterns + stuffing limits added to content-engine prompt | 0 | 2026-05-14 |
| `backlink-builder` registry entry | Removed | Agent deleted; nudge scheduler and actions.ts stubs updated with TODO(sprint-3) | 0 | 2026-05-14 |
| `MollyNudge` dispatch to `backlink-builder` | Stubbed | Now targets `molly`; full replacement in sprint 3 | 0 | 2026-05-14 |
| `closer-agent` | Gated off | Built; disposition-gated OFF until trials exist (Phase-6 outbound) | 6 | 2026-07-20 |
| `billing-dunning` | Gated off | Built; disposition-gated OFF until paying tenants exist (Stripe; Phase-6 outbound) | 6 | 2026-07-20 |
| `churn-recovery` | Gated off | Built; disposition-gated OFF until paying tenants exist (Phase-6 outbound) | 6 | 2026-07-20 |
| `molly-digest` | Superseded | Superseded by fleet-digest; disposition OFF. Vercel/seed cron still present — full cron/seed removal tracked as BL-025 (blocked on PR #262 which owns seed-agent-schedules.ts). | 5 | 2026-07-20 |
| `wave-launcher` | Gated off | Built; disposition-gated OFF (`skips backlinks; revisit later`) — see orchestrator/disposition.ts:93. Registered but not launched. Row added to close the same reconciliation gap BL-004 fixed for the closer/billing/churn trio. | 5 | 2026-07-27 |
| `tenant-prospector` | Gated off | Built; disposition-gated OFF (`until tenants; Apollo/Places creds`) — see orchestrator/disposition.ts:82. Cron-scheduled (`vercel.json` `0 14 * * 1`) but not firing. Row added to close the same reconciliation gap BL-004/BL-036 fixed for other OFF agents. | 6 | 2026-08-03 |
| `outreach-agent` | Gated off | Built; disposition-gated OFF (`until tenants; sends real email`) — see orchestrator/disposition.ts:83. Cron-scheduled (`vercel.json` `0 15 * * *`) but not firing. Row added to close the same reconciliation gap BL-004/BL-036 fixed for other OFF agents. | 6 | 2026-08-03 |
| `trial-manager` | Gated off | Built; disposition-gated OFF (`until trials exist`) — see orchestrator/disposition.ts:84. Cron-scheduled (`vercel.json` `0 16 * * *`) but not firing. Row added to close the same reconciliation gap BL-004/BL-036 fixed for other OFF agents. | 6 | 2026-08-03 |
| `backlink-copycat` | Deferred | Disposition-gated OFF (`deferred — not built`) — see orchestrator/disposition.ts:94. Registered in the disposition table but not yet implemented; no cron entry. Row added to complete the OFF-agent roster alongside the tenant-pipeline trio. | 6 | 2026-08-03 |
