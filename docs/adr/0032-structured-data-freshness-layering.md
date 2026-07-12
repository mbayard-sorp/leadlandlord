# ADR 0032 — Structured-data field layering and content-freshness gating

Date: 2026-07-12
Status: Accepted
Context: SEO/AEO/GEO template audit (docs/seo-aeo-geo-audit-2026-07.md), Phase 2/3 work.

## Decision 1 — Operational facts are Sanity-passthrough, never ContentBundle

Structured-data inputs that describe the *business operation* rather than generated copy —
opening hours, geo coordinates, `sameAs` profiles, and future fields of the same kind
(credentials, price ranges entered by the operator) — live as fields on the Sanity `site`
document, entered by the operator or a deterministic pipeline (e.g. geocoding), and flow to
the renderer through `apps/site-host/lib/theme-bundle.ts` into the site-host-local `Bundle`
type (`apps/site-host/lib/content.ts`).

They MUST NOT be added to the `ContentBundle` contract in `packages/shared/src/types.ts`.
That contract is the LLM generation surface: every field added there ripples into the
content-engine system prompt, the Zod→tool-schema derivation, output validation, and both
Sanity mappers — and invites the model to fabricate operational facts, which violates the
grounding contract. `latitude`/`longitude`/`sameAs` already follow the passthrough pattern;
`openingHours` (this phase) continues it.

Corollary: fields that ARE generated copy (titles, FAQs, image alt text) belong on
`ContentBundle`/`Page` and take the full contract ripple in one coordinated change.

## Decision 2 — Freshness work reuses seo-operator's risk tiers, not a new gate

The content-freshness loop (Phase 3) extends the recommendation model already implemented in
`packages/agents/src/seo-operator/`: `riskLevel: 'low'` auto-applies via operator-tick
(timestamp/metadata-only refreshes), `'medium'` waits in the existing `seoRecommendations`
`awaiting_review` flow (any LLM body rewrite), `'high'` stays blocked. No new approval-gate
type is introduced and no existing gate is weakened, so this does not trigger the
gate-change ADR + sign-off requirement in docs/agent-improvement-loop.md. The loop is a
production content agent (budget-capped via `agent_budgets`, registered in the agent
registry) — distinct from the improvement-loop PR generator, and it never writes through
`READONLY_DATABASE_URL`.

## Consequences

- New operational fields need: Sanity schema field + operator UI (ProprietaryDataPanel
  pattern: dual-write Postgres `proprietaryFacts` + Sanity patch) + theme-bundle mapping +
  renderer consumption with a safe fallback. No content-engine changes, no backfill.
- Renderer fallbacks (e.g. the legacy hardcoded 07:00–21:00 hours) remain until operators
  populate real values; JSON-LD is therefore never blocked on data entry.
- The freshness agent's spike (extend seo-operator vs. sibling agent) is an implementation
  detail; either way it must emit through the `seoRecommendations` status flow.
