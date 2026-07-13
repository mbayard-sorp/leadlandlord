# Improvement Backlog

Durable memory of the agent improvement loop ([operating doc](agent-improvement-loop.md), [ADR 0027](adr/0027-agent-improvement-loop.md)). Format and status lifecycle: `.claude/skills/improvement-cycle/references/backlog-format.md`.

Lifecycle: `proposed → accepted → in-pr (#NNN) → merged → verified` | `rejected`. IDs never reused. Dedupe before adding.

| ID | Item | Source | Severity | Tier | Status | Updated | Evidence / notes |
|---|---|---|---|---|---|---|---|
| BL-001 | `metadata.ts` claimed wave-launcher is "gated by approvals"; code has no gate (`wave-launcher/index.ts:8,220`) | seed audit | P2 | T1 | in-pr (bootstrap) | 2026-07-07 | Fixed in bootstrap PR — description now matches code |
| BL-002 | `.env.example` claimed agents use `@anthropic-ai/claude-agent-sdk`; they use plain `@anthropic-ai/sdk` | seed audit | P3 | T0 | in-pr (bootstrap) | 2026-07-07 | Fixed in bootstrap PR |
| BL-003 | `next-engineer.md` + `leadlandlord-architect.md` referenced a machine-local `~/.claude/plans/...` file that doesn't exist in cloud sessions | seed audit | P2 | T1 | in-pr (bootstrap) | 2026-07-07 | Fixed in bootstrap PR — now reference DEPRECATIONS.md + README phase table |
| BL-004 | DEPRECATIONS.md marks closer-agent / billing-dunning / churn-recovery / compliance-guard "pending, out of MVP scope", yet all four are registered and three are cron-scheduled (`apps/operator/vercel.json:9-11`). Decide: pause the schedules, or update the deprecation status | seed audit | P1 | T3 | proposed | 2026-07-07 | Decision PR for Mike — first weekly cycle target |
| BL-005 | citation-runner TODOs: move directory list to a Sanity doc field (`citation-runner` scheduler L17/L42) | seed audit | P3 | T1→code | proposed | 2026-07-07 | |
| BL-006 | network-linker TODO: needs typed Sanity page helper (`network-linker/index.ts:286`) | seed audit | P3 | code | proposed | 2026-07-07 | |
| BL-007 | tenant-prospector Phase-7 TODO: website scraping + Hunter.io fallback (`tenant-prospector/index.ts:40`) | seed audit | P3 | code | proposed | 2026-07-07 | Phase-gated; confirm phase before building |
| BL-010 | call-classifier active learning: harvest sub-0.5-confidence hand-review outcomes from DB into few-shot examples in the classifier prompt each cycle | gap analysis | P2 | T1 | proposed | 2026-07-07 | High value / low risk — compounding accuracy; ideal first cycle target |
| BL-011 | molly-inbox manual_review hardening: cluster manual_review fallbacks by cause, extend reply-state-machine prompt coverage (ADR 0006) | gap analysis | P2 | T1 | proposed | 2026-07-07 | High value / low risk — ideal first cycle target |
| BL-012 | citation-packet-preparer: after BL-005, generate prefilled per-directory submission packets + auto-verify pasted listing URLs; human/VA still clicks submit | gap analysis | P2 | code | proposed | 2026-07-07 | Cuts VA hours; full form automation deliberately out of scope |
| BL-013 | Molly draft quality-gated auto-approve: molly-scorer score ≥ threshold + daily send cap auto-approves guest-post drafts; below → human queue | gap analysis | P2 | T3 | proposed | 2026-07-07 | GATE CHANGE decision PR; rollback = threshold flag |
| BL-014 | Medium-risk SEO auto-apply with rollback journal: journal prior state, auto-revert on GSC regression within 14d; high-risk stays blocked | gap analysis | P2 | T3 | proposed | 2026-07-07 | Needs rollback infra first; GATE CHANGE decision PR |
| BL-015 | Content-idea category-scoped auto-approve (e.g. seasonal refresh) with weekly cap | gap analysis | P3 | T3 | proposed | 2026-07-07 | GATE CHANGE decision PR |
| BL-016 | Self-healing retry runbooks for manual-fix fallbacks: domain DNS/attach failures (`domain-procurer` L225/245/260), trial cleanup, tracking-number assignment — bounded auto-retry with backoff before emitting manual_fix | gap analysis | P2 | code | proposed | 2026-07-07 | One PR per fallback class |
| BL-017 | Digest→event bridge: fleet-digest / portfolio-analyst items with known dispositions emit `agent_events` instead of prose-only email | gap analysis | P3 | code | proposed | 2026-07-07 | |
| BL-018 | Content-migration "trivial class" auto-apply (pure metadata moves) | gap analysis | P3 | T3 | proposed | 2026-07-07 | Deferred — low value relative to risk |
| BL-019 | Go-live checklist *verification* automation: agent verifies every checklist item and reports; human keeps the promote-to-live click | gap analysis | P3 | code | proposed | 2026-07-07 | Never automate the click itself |
| BL-020 | Domain approval batch UX: keep the human gate (spends money), improve batch-approval ergonomics in `/operator` | gap analysis | P3 | code | proposed | 2026-07-07 | UX-only |
| BL-021 | Automated cross-site internal-link-pattern similarity check: extend footprint review to compare link caps/anchors/targets across the network now that internal-linker covers faq/info/service-area pages | seo audit 2026-07 (Phase 3) | P2 | code | in-pr | 2026-07-12 | Landed in `packages/agents/src/audit/content-similarity.ts` (pure FAQ-overlap + link-signature comparators) + `content-footprint.ts` (Sanity/DB loader, `scoreNetworkContentFootprint`), wired into the existing footprint-review pass at `apps/operator/app/operator/networks/[id]/page.tsx` ("Content similarity" section, next to `scoreNetworkFootprint`'s "Footprint risk"). Thresholds: FAQ overlap >40% of smaller set, link-signature match >80% of shared page kinds. `checkFaqOverlap` (density-lint.ts) is the underlying per-pair comparator, as it was built for. |

Out of scope permanently: automating the niche approval gate (`/operator/niches`) — see ADR 0027.
