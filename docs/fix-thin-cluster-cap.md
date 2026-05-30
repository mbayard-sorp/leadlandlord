# Fix: cap keyword clusters in thin mode (root cause of stalled site builds)

> Handoff brief — self-contained. The session picking this up has **no prior context**.
> Read this top to bottom before touching code.

## TL;DR

`keyword-planner` over-produces clusters for `thin` sites (observed: **11** clusters for a
thin site whose documented budget is 6-12). A large cluster set makes `content-engine`
emit a bundle big enough (~87 KB / near the 32k-token output cap) that the initial
stream + density-lint retry can't both finish inside the Vercel **800s lambda ceiling**.
The run zombies at `running`, the lease reaper requeues it every ~15 min, and it eventually
dead-letters without ever completing. **Fix the upstream cause: wire `site_mode` → a small
cluster target for thin, and hard-cap the persisted count.**

## Incident that motivated this

- Prod site `11995865-7be7-4cda-814e-026caefc4348` (deck building / Medford, OR), `site_mode=thin`.
- `keyword-planner` persisted **11** clusters.
- `content-engine` initial stream reached ~87 KB; density-lint then forced a full-bundle
  retry (48k `max_tokens`); retry + initial together exceeded the 800s lambda → run zombied
  → reaper requeued on a 15-min cadence → never completed.

### Interim mitigations already shipped (do NOT re-do these — they are NOT the real fix)
- **#127** — `withStreamTimeout()` in `content-engine`: 600s in-process cap on each Anthropic
  stream so a stalled `finalMessage()` throws cleanly instead of burning the whole lambda and
  zombieing the run. Also bumped retry `max_tokens` 32k→48k.
- **#128** — raised that cap 360s→600s after the first value was too tight for the initial stream.
- `CONTENT_ENGINE_STREAM_TIMEOUT_MS` env override (uncommitted on branch
  `fix/ce-stream-timeout-600` worktree — see "Loose ends" below) so off-lambda runs can disable
  the cap.
- The motivating site itself was unblocked manually (clusters trimmed to 7 in Sanity + an
  off-lambda `scripts/finish-site.ts` run). That is a one-off workaround, not a fix.

These bought clean failure + recovery. They do **not** stop a thin site from over-producing
clusters and overwhelming content-engine. That is what THIS task fixes.

## Root cause (exact locations)

1. **`site_mode` is never passed to the planner.**
   `packages/agents/src/site-builder/index.ts` reads `siteMode` (~line 82) but the
   `this.keywordPlanner.run({ site_id, niche, city, state }, ...)` call (~lines 95-104)
   omits both `site_mode` and `target_clusters`.

2. **The planner's defaults are internally inconsistent.**
   `packages/agents/src/keyword-planner/index.ts`:
   - `site_mode` defaults to `'thin'` (~line 50), documented as "6-12 clusters".
   - `target_clusters` defaults to **`21`** (~line 46) — a content_rich number.
   - The prompt tells Claude `Target cluster count: ${input.target_clusters}` and
     `Cluster these into ${input.target_clusters} (±5)` (~lines 293, 298).
   - There is **no post-LLM hard cap** — `persistClusters` writes whatever the model returns
     (`enriched.length`, ~line 234).

   So a thin build asks the model for "21 (±5)" and persists however many come back, with no
   ceiling tied to thin mode.

## The fix (three parts)

### 1. Derive `target_clusters` from `site_mode` when not explicitly provided
In `keyword-planner/index.ts`, replace the standalone `target_clusters` default with a
mode-derived default:
- `thin` → **7** (range the rest of the system already implies: 1 home + ~3 service + ~3 blog)
- `content_rich` → **21** (unchanged)
- An explicit `target_clusters` input still overrides.

Keep `target_clusters` optional; compute the effective target as
`input.target_clusters ?? (site_mode === 'content_rich' ? 21 : 7)`.

### 2. Hard-cap the persisted clusters
After the LLM returns and before/within `persistClusters`, enforce a maximum:
`thin` → keep at most **8** (small slack over target 7), `content_rich` → at most ~28.
**Selection rule: keep the highest `totalVolume` clusters, and always keep the `home` cluster.**
(This mirrors the manual remediation used on the incident site: top-N by volume, home retained.)
Drop the overflow rather than persisting it. Log what was dropped (no silent truncation).

### 3. Pass `site_mode` through from site-builder
In `site-builder/index.ts`, pass the already-read `siteMode` into the `keywordPlanner.run(...)`
input so the planner sees the real mode instead of falling back to its default.

## Acceptance criteria

- A `thin` site build persists **≤ 8** keyword clusters (target 7), with the `home` cluster
  always present.
- A `content_rich` build is unchanged (~21-28).
- `site_mode` flows site-builder → keyword-planner (verify the run input contains it).
- Dropped clusters are logged with count + keys.
- `pnpm --filter @leadlandlord/agents typecheck` passes.
- No change to Sanity write IDs or the cluster doc shape (deterministic IDs:
  `cluster-${siteId}-${clusterKey}`).

## Test plan

- Unit/inline: call keyword-planner logic with `site_mode='thin'` and a mocked 15-cluster LLM
  return; assert ≤ 8 persisted, home retained, highest-volume kept.
- Repeat with `content_rich`; assert no cap regression.
- Optional E2E: `scripts/dry-run.ts --niche "<n>" --city "<c>" --state "XX"` (writes to the
  `development` Sanity dataset) and confirm cluster count + that content-engine completes
  without a density-lint retry.

## Loose ends from the incident (clean up or fold in)

- Branch `fix/ce-stream-timeout-600` (in a worktree) carries an uncommitted change making
  `STREAM_TIMEOUT_MS` read `CONTENT_ENGINE_STREAM_TIMEOUT_MS` (default 600_000) plus two
  helper scripts: `scripts/finish-site.ts` (off-lambda single-site completion) and
  `scripts/ignore-css.cjs` (preload so tsx can import the Sanity Studio schema barrel).
  Decide whether to commit these (the env override + finish-site are reusable for the next
  stalled build) or drop them.
- The incident site's 4 retired clusters in Sanity (`blog-permit-cost`, `blog-size-cost-guide`,
  `service-composite-decking`, `service-deck-repair`, all `status=retired`) can stay retired.

## Files

- `packages/agents/src/keyword-planner/index.ts` — defaults (~46, 50), prompt (~293, 298),
  persist (~234), `KeywordPlannerInput` (~40).
- `packages/agents/src/site-builder/index.ts` — `siteMode` read (~82), planner call (~95-104).
- `packages/agents/src/keyword-planner/index.ts` `persistClusters` (~339) for the cap.

---

# ADDENDUM — content-engine bundle can fail `ContentBundle.parse` on a stringized Page field

> Added after the cluster shrink was validated. The cluster-cap fix above is correct but is
> **not** what currently blocks the motivating site from reaching `ready`. This is.

## What happened

After trimming the incident site to 7 clusters and re-running the build off-lambda, the
content-engine stream completed cleanly (~7 min, **no timeout, no density-lint retry**) — proving
the cluster-count theory — but the run then failed at output validation:

```
ContentBundle.parse → path ["contact"]: expected object, received string
```

The model emitted the bundle's `contact` field as a **string** instead of a `Page` object.

## Why it matters

- `ContentBundle.contact` is a full `Page` object: `packages/shared/src/types.ts:81` (`contact: Page`).
  The other top-level page fields (`home`, `about`, `services[]`, `service_areas[]`, `blog[]`,
  `info_pages[]`) are also `Page`-shaped and share the same exposure.
- The dispatcher classifies Zod schema failures as a **terminal `validation_error`**
  (`packages/db/src/queue.ts`, `TERMINAL_KINDS`). Terminal kinds **dead-letter on the first
  attempt** — no retry, no self-recovery. So a single bad-shaped field kills the whole build
  permanently until an operator replays it.
- This is independent of cluster count. It can recur on any build (model non-determinism in
  tool-use output), thin or content_rich.

## Fix scope (architect should confirm 1 vs 2 vs both)

1. **Harden `normalizeBundle`** — `packages/agents/src/content-engine/index.ts` (~line 429,
   next to `trimPage`, ~line 488). Before `ContentBundle.parse` (~line 238), coerce any
   `Page`-typed top-level field that arrived as a string into a valid `Page` (e.g. treat the
   string as the page body/mdx and backfill required Page fields with defaults). Apply uniformly
   to `home`, `about`, `contact`, and each element of the page arrays — not just `contact`.
2. **And/or tighten the tool input schema** — `TOOL_INPUT_SCHEMA` (derived via `zodToJsonSchema`,
   ~line 78) so each Page field is an unambiguous object and the model cannot emit a scalar.
   Anthropic enforces tool `input_schema` server-side, so this prevents the bad shape at the
   source rather than repairing it after.
3. **Test** — feed a bundle with `contact` (and one array element) as a string through
   `normalizeBundle`; assert the result is a valid `Page` and `ContentBundle.parse` succeeds.

## Acceptance criteria (addendum)

- A bundle where any `Page` field arrives as a string normalizes to a valid `Page` and parses.
- The `validation_error` no longer terminal-kills a build for this recoverable shape mismatch.
- `pnpm --filter @leadlandlord/agents typecheck` passes.
- No change to the `Page` schema itself or to Sanity write IDs.

## Relationship to the cluster-cap fix

Independent bugs; can ship on the same branch or separately. **This addendum is the current
blocker** for site `11995865-7be7-4cda-814e-026caefc4348` (deck building / Medford, OR) reaching
`ready` — that site already has its 7 clusters in Sanity and only needs a parseable bundle.
A re-run *might* pass by luck (non-determinism), but the normalize hardening is the durable fix.

## Files (addendum)

- `packages/shared/src/types.ts` — `ContentBundle`, `contact: Page` (~81), `Page` schema.
- `packages/agents/src/content-engine/index.ts` — `normalizeBundle` (~429), `trimPage` (~488),
  `ContentBundle.parse` call (~238), `TOOL_INPUT_SCHEMA` (~78).
- `packages/db/src/queue.ts` — `FailureKind` / `TERMINAL_KINDS` (why a Zod failure dead-letters).
