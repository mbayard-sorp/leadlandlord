# Deprecations

| Item | Status | Reason | Sprint | Date |
|------|--------|--------|--------|------|
| `packages/agents/src/backlink-builder/` | Removed | Replaced by backlink-copycat + citation-runner (Sprint 3-4) | 0 | 2026-05-14 |
| `scripts/test-agent-zoho-send.ts` | Removed | Coupled to backlink-builder; no replacement needed | 0 | 2026-05-14 |
| Architectural voice overlay (system.md) | Applied | Locale-saturation rules + forbidden patterns + stuffing limits added to content-engine prompt | 0 | 2026-05-14 |
| `backlink-builder` registry entry | Removed | Agent deleted; nudge scheduler and actions.ts stubs updated with TODO(sprint-3) | 0 | 2026-05-14 |
| `MollyNudge` dispatch to `backlink-builder` | Stubbed | Now targets `molly`; full replacement in sprint 3 | 0 | 2026-05-14 |
| `closer-agent` | pending | Phase-6 outbound; out of MVP scope | pending | — |
| `billing-dunning` | pending | Phase-6 outbound; out of MVP scope | pending | — |
| `churn-recovery` | pending | Phase-6 outbound; out of MVP scope | pending | — |
| `compliance-guard` | pending | Phase-6 compliance automation; deferred | pending | — |
