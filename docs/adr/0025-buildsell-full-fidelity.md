# ADR 0025: Build & Sell Full-Fidelity Templates + Workflow

**Date:** 2026-06-18
**Status:** Accepted
**Author:** leadlandlord-architect (Phase 0)

---

## Context

The Build & Sell line is wired end-to-end but the first shipped site is thin: brand
colors never render (B-COLOR), fonts fall back to system-ui (B-FONT), section headings
are hardcoded across every site (B-HEADINGS), NAP fields are partially missing, the
purchase CTA has no URL, and the three layout variants are nearly visually identical
below the hero. This ADR locks the decisions that Phase 1–7 engineers must follow
without revisiting.

---

## Decisions

### D1: B-COLOR — color-wrap fix

**Decision:** `persist-sanity.ts` must wrap each of the 8 theme color values as a
Sanity color object `{ _type: 'color', hex: <string> }` when building the
`buildsellTheme` inline object. The schema (`type: 'color'`) and the GROQ projection
(`theme.*.hex`) are both correct today; only the writer is wrong.

**Exact fix site:** `persist-sanity.ts` line 137, the `theme: { _type:'buildsellTheme',
...content.theme }` spread. Replace the spread of raw hex strings with explicit
color-wrapping for all 8 fields: `primary`, `primaryDark`, `accent`, `onPrimary`,
`bg`, `surface`, `text`, `muted`. `fontHeading`, `fontBody`, `preset`, and
`layoutVariant` remain plain scalars.

**Do not** change the schema to store plain strings. That would break `@sanity/color-input`
rendering in Studio and invalidate the existing `setTheme` action.

**Preflight requirement:** before Phase 2 ships, verify the live first-site doc's
`theme.primary` field shape in Sanity. If the stored value is already `{ _type:'color',
hex:'...' }`, the GROQ projection is already working and only new writes need the wrap.
If the stored value is a plain string, the GROQ projection silently resolves to null
on that doc — meaning the live site already has blank CSS variables. Either way the
fix is the same (fix the writer), but the preflight finding must be logged in the Phase 2
PR description.

---

### D2: NAP contract — payload to Sanity-doc only, no Postgres columns

**Decision:** NAP fields (phone already exists in schema; the new `address` display line)
flow transiently through the agent-event payload into the Sanity doc only. No new
Postgres columns, no Drizzle migration, and the reaper is untouched.

**Exact contracts:**
- `phone`: already a doc-root field on `buildsellSite`. Already written by persist.
  No change needed to schema or projection.
- `address` (display line): lives on `bsContactSection.address` as the `bsAddress`
  inline object. Persist today writes `bsAddress` with `city`+`state`+`hours`+`serviceArea`
  from payload. Phase 2 adds a single display line from the payload: write it into
  `bsAddress.street` (the field already exists in the schema at objects.ts:137).
  Do NOT introduce a new `displayLine` field. Do NOT parse `formatted_address` — store
  the full string from the Places API into `street` as a single display line (e.g.
  "2240 S Archibald Ave, Ontario, CA"). The `zip` field stays empty (not parsed).
- `rating` (number) and `reviewCount` (number): sourced from
  `buildsell_sites.metadata.rating` and `metadata.userRatingCount` respectively.
  These are written to doc-root fields on `buildsellSite` (new, Phase 1 schema add).
  They are NOT stored in `bsAddress` or any section object.
- `purchaseUrl` (string): sourced from `buildsell_sites.payment_link`. Written to a
  new doc-root field on `buildsellSite`. Set by `sendInvoice` as a best-effort
  non-fatal Sanity patch after the DB row + email; the initial build sets it empty/null.

**Reaper safety:** the reaper deletes `buildsell_sites` rows for reaped leads. Since NAP
is Sanity-only, a reaped-lead Sanity doc retains its last-written `street`/`phone` —
this is intentional and acceptable (Sanity content is operator-owned). The reaper is
not modified.

---

### D3: featured-review source

**Decision:** `persist-sanity.ts` keeps `featured = i < 3`. The model is instructed (via
`system.md`) to order reviews by importance: most persuasive/specific first. This
ordering determines which three become featured. Persist does not sort; the model sorts.

Rationale: introducing a sort in persist would require a scoring heuristic that
duplicates model judgment. Keeping `i < 3` is simple, deterministic, and idempotent.

---

### D4: rebuild-clobber policy

**Decision:** `createOrReplace` overwrites the entire doc. A rebuild of a
`paid`/`live` site risks silently resetting `draftMode: true` and `robotsDisallow: true`
(de-indexing a live site, R18) and wiping `purchaseUrl` and any operator-edited
NAP/prompts. The policy has two parts:

**Part A — status guard:** persist must check the Postgres `buildsell_sites.status`
before calling `createOrReplace`. If status is `paid` or `live`, abort with a typed
error unless the caller passes an explicit `{ forceRebuild: true }` override. The
override is surfaced in the operator UI's detail page (Phase 4) behind a confirmation
modal. The cron path never passes `forceRebuild`.

**Part B — read-merge on rebuild:** when a doc already exists (any status), persist
reads the existing doc via `fetchBuildSellSiteById` before writing. It merges the
following fields from the existing doc into the new write, never overwriting them:
- `draftMode`
- `robotsDisallow`
- `purchaseUrl`
- `ownerEmail` (operator-entered outreach target)
- `bsAddress.street` if the incoming payload has no street (reaped-lead rebuild
  degrades cleanly — keeps last known display line rather than blanking it)

Operator-edited section copy (e.g. manually edited heading text in Studio) is NOT
read-merged — it is overwritten on rebuild. This is the acceptable tradeoff: the
operator UI makes clear that rebuild replaces AI copy. The four fields above are the
only ones that carry operational state (not content).

**Implementation note for Phase 2:** `WriteBuildSellArgs` gains an optional
`existingDoc?: Pick<BuildSellSite, 'draftMode'|'robotsNoFollow'|'purchaseUrl'|'ownerEmail'>`.
The `index.ts` builder fetches it before constructing args. Persist applies the merge.
The status guard lives in `index.ts` before the Sanity write is initiated.

---

### D5: canonical field-flow table

Every new field that reaches the renderer follows this exact path:

| Display | Sanity field | Schema location | Source | GROQ path | Shape in projection |
|---|---|---|---|---|---|
| phone | `buildsellSite.phone` | doc-root (exists) | event payload | doc-root enum | `string` |
| address display line | `bsContactSection.address.street` | `bsAddress.street` (exists) | event payload | section spread `...,` | `string` (single line, not parsed) |
| rating | `buildsellSite.rating` | doc-root (NEW, Phase 1) | `metadata.rating` | doc-root enum | `number` |
| reviewCount | `buildsellSite.reviewCount` | doc-root (NEW, Phase 1) | `metadata.userRatingCount` | doc-root enum | `number` |
| purchaseUrl | `buildsellSite.purchaseUrl` | doc-root (NEW, Phase 1) | `payment_link` via sendInvoice | doc-root enum | `string` |
| colors x8 | `buildsellTheme.*` | inline object (exists) | model | `theme.*.hex` | color-wrapped `{_type:'color',hex}` in writer |
| review avatar | `bsReview.avatar` | review doc (NEW, Phase 1) | model (optional) | `reviews[]->` deref | `{asset->{url}}` |
| review initials | `bsReview.initials` | review doc (NEW, Phase 1) | model | `reviews[]->` deref | `string` |
| review location | `bsReview.location` | review doc (NEW, Phase 1) | model | `reviews[]->` deref | `string` |
| review source | `bsReview.source` | review doc (NEW, Phase 1) | model (always `manual`) | `reviews[]->` deref | `string` enum |
| review date | `bsReview.date` | review doc (NEW, Phase 1) | model | `reviews[]->` deref | `string` |
| logo | `buildsellSite.logo` | doc-root (NEW, Phase 1) | image gen (Phase 4, optional) | doc-root enum | `{asset->{url}}` |
| heroImagePrompt | `buildsellSite.heroImagePrompt` | doc-root (NEW, Phase 1) | model | doc-root enum | `string` |
| aboutImagePrompt | `buildsellSite.aboutImagePrompt` | doc-root (NEW, Phase 1) | model | doc-root enum | `string` |
| ogImagePrompt | `buildsellSite.ogImagePrompt` | doc-root (NEW, Phase 1) | model | doc-root enum | `string` |
| services subhead | `bsServicesSection.subhead` | section object (exists) | model | section spread `...,` | `string` |
| services heading | `bsServicesSection.heading` | section object (exists) | model (NOT hardcoded) | section spread `...,` | `string` |
| reviews heading | `bsReviewsSection.heading` | section object (exists) | model (NOT hardcoded) | section spread `...,` | `string` |
| footer legalLinks | `bsFooterSection.legalLinks` | section object (NEW, Phase 1) | model | section spread `...,` | `{label,href}[]` |
| OG image | `bsSeo.ogImage` | `bsSeo` inline (exists) | image gen (Phase 4) | `seo{...,ogImageUrl:ogImage.asset->url}` | `string` |

---

## Alternatives considered

**B-COLOR alt — change schema to string:** Rejected. Breaks Studio color picker and the
`setTheme` Sanity action. The writer fix is 8 lines; changing the schema would require
a Studio migration pass.

**NAP alt — Postgres columns for phone/address:** Rejected. Introduces a migration,
PII in Postgres, and reaper complexity. The Sanity doc is already operator-owned
content; NAP belongs there.

**Read-merge alt — merge all section copy on rebuild:** Rejected. Unbounded complexity;
operator would lose the ability to get fresh AI copy by rebuilding. Only operational
state fields are merged.

**Featured-review alt — sort by heuristic in persist:** Rejected. Duplicates model
judgment; adds fragile string scoring to a pure write function.

---

## Consequences

- Phase 1 (next-engineer) adds doc-root fields to `buildsell-site.ts` and review fields
  to `review.ts`. No migration. Mike deploys Studio schema once.
- Phase 2 (next-engineer) fixes B-COLOR (8-line wrap), removes B-HEADINGS hardcoding,
  adds read-merge + status guard.
- `WriteBuildSellArgs` interface gains `existingDoc?` and the caller (`index.ts`) is
  responsible for fetching it. Persist stays a pure writer; the guard logic lives
  in the builder orchestration.
- The GROQ projection must enumerate every new doc-root field explicitly. Section-object
  fields (including the new `bsFooterSection.legalLinks`) flow automatically via the
  `...,` spread already present.
- `BuildSellSite` TypeScript type gains all new doc-root fields (optional/nullable).
  `BuildSellReview` type gains `initials`, `location`, `source`, `date`, `avatar`.
  `BuildSellSection` type gains `legalLinks`.
