# Cluster-Coverage Gate Runaway — Diagnostic + Fix Plan

**Filed:** 2026-05-10 after the third recurrence of the same failure pattern on `foundation repair`. Earlier failures: 2026-05-07 ($135 runaway), 2026-05-08 (5 attempts on a single event), 2026-05-10 (kill-switched at 2 attempts ≈ $1.10).

## Symptom

`content-engine` rejects bundles with:

```
cluster coverage too low: 10/21 clusters not covered.
Missing: blog-crawl-space-foundation-repair-cost,
         blog-foundation-crack-repair-cost,
         blog-foundation-repair-cost-austin,
         blog-foundation-repair-cost-calculator,
         blog-foundation-repair-cost-guide
```

Each rejection costs ~$0.50 in real LLM spend (32K output tokens). The `niche.approved` event then retries up to `RUNTIME_MAX_ATTEMPTS=5` times before dead-lettering — capping per-niche burn at ~$2.50, but still real money on a deterministic loop.

## Root cause — single line

The system prompt tells Claude that `cluster_key` is checked, but **does not constrain `cluster_key` to be one of the values from the input table**. Claude paraphrases the slugs (e.g. emits `blog-foundation-repair` when the table has `blog-foundation-repair-cost-austin`), and the gate's exact-match `Set.has()` lookup fails.

## Where the gap is — file:line

| File | Line | Code | What it says |
|---|---|---|---|
| `packages/agents/src/content-engine/index.ts` | 224 | `if (claimed.has(c.cluster_key)) covered.push(...)` | Exact-string `Set` lookup. No fuzzy match. No normalization. |
| `packages/agents/src/content-engine/index.ts` | 194 | `if (missRate > 0.2) throw ...` | Hard fail at >20% miss. For 21 clusters: 5 missing kills it. We're at 10/21 = 48%. |
| `packages/agents/src/content-engine/index.ts` | 320 | `KEYWORD CLUSTERS — TARGETING REQUIREMENT: ... ${clusterTable}` | Cluster table IS injected into user prompt with `cluster_key="X"` format. Visible to Claude. |
| `packages/agents/src/content-engine/system.md` | 200 | `cluster_key: the cluster identifier you targeted` | Claude is *told* about cluster_key but **NOT told the values are non-negotiable**. |
| `packages/agents/src/content-engine/system.md` | 205-206 | `Coverage is checked post-output; >20% miss rate triggers retry.` | Tells Claude failure is possible but doesn't tell it how to prevent failure. |

## Why the prior fix didn't help

Commit `5161d42` ("fix(agents): defensive guards against cluster.ready cascade", 2026-05-07) addressed a **different** cascade vector — the `cluster.ready` event re-firing site-builder. The commit message explicitly notes:

> Does NOT fix layer 3 (in-flight site-builder dedupe) — that needs more thought on retry semantics.

Today's failure is the `niche.approved` retry path firing content-engine repeatedly when the bundle keeps failing the deterministic gate. Same expected cluster_keys → same paraphrased slugs from Claude → same gate failure → next retry. The prompt has never been hardened.

## Verified data flow (2026-05-10 build)

```
keyword-planner ─┐
                 ├──→ keyword_clusters table (21 rows for foundation-repair Austin TX)
                 │      cluster_key e.g. "blog-foundation-repair-cost-austin"
                 │
                 ▼
site-builder loadKeywordClustersForSite()
                 │
                 ▼
content-engine.run({ keyword_clusters: [...21 items...] })
                 │
                 │  user prompt: "cluster_key=\"blog-foundation-repair-cost-austin\" page_kind=blog ..."
                 │  system prompt: "declare cluster_key field on each page"
                 │
                 ▼
Claude (Sonnet, tool use) returns ContentBundle
                 │  pages[*].cluster_key SET BY MODEL — paraphrased slugs slip through
                 ▼
checkClusterCoverage(): Set.has() exact match
                 │
                 ▼
10/21 missing → throw → BaseAgent marks failed → event re-claimed → retry
```

Verified live against the `28c55ccd-...` failed run earlier today. The 21 expected cluster_keys are deterministic and known in the input. Output wasn't persisted on failure (logging gap — flagged as fix item below).

---

## Fix plan

### Recommended: ladder of three fixes, ship in order

#### Fix 1 — Hard cluster_key enum via tool-use schema (~30 min, BULLETPROOF)

The content engine already uses Anthropic tool-use ([commit b7fe1ce](https://github.com/mbayard-sorp/leadlandlord/commit/b7fe1ce) — "switch to Anthropic tool use for guaranteed JSON validity"). Tool-use schemas accept `enum` constraints. Encode the expected `cluster_key` values into the tool's input schema for each page-kind array:

```ts
// In packages/agents/src/content-engine/index.ts, where the tool schema is built:
const clusterEnum = input.keyword_clusters.map(c => c.cluster_key);

const pageSchema = {
  type: 'object',
  properties: {
    cluster_key: { type: 'string', enum: clusterEnum },  // ← bulletproof
    // ... other fields
  },
  required: ['cluster_key', /* ... */],
};
```

This makes it physically impossible for Claude to emit a paraphrased slug — the API rejects the tool call before it even reaches our gate. Zero LLM-discipline reliance.

**Caveat:** Anthropic enforces tool-use schemas server-side as of Sonnet 4.6+. Confirm the SDK version + model in use accepts `enum` constraints on string fields. If it does (likely), this is the single fix that closes the loop.

**Files to edit:**
- `packages/agents/src/content-engine/index.ts` — find the tool-use schema construction, inject `enum: clusterEnum` on every `cluster_key` field across `home`, `services[].cluster_key`, `service_areas[].cluster_key`, `blog_posts[].cluster_key`, `info_pages[].cluster_key`.

**Test:** rerun the foundation-repair build with the kill switch off. Expect first attempt to succeed; coverage = 21/21.

#### Fix 1.5 — Pass `theme` into content-engine input (~10 min, CRITICAL — currently dead code)

Vercel logs from the 2026-05-10 failed run show `"theme": null, "overlay": false` in
content-engine's "requesting content bundle from claude" log line. That means
site-builder has NEVER passed a theme into `contentEngine.run({...})` in
production — so the `niches/{trades,modern,premium,bright}.md` overlay markdown
files (which carry niche-specific terminology, seasonality, regulations, pain
points, tone) have never been loaded. The infrastructure for niche overlays
exists (`loadNicheOverlay`, `composeSystemPrompt`) but the call site in
site-builder dropped the input field on the floor.

**Approach:**

1. New module `packages/agents/src/site-builder/pick-theme.ts` exporting
   `pickThemeForNiche(niche): 'classic' | 'modern' | 'premium' | 'bright'`.
   The mapping mirrors the variant table at
   `packages/agents/src/content-engine/system.md:41-46`. Lookup is
   case-insensitive and whitespace-tolerant; unknown niches default to
   `'classic'`. Export the underlying map as a `const` for testability.

2. In `packages/agents/src/site-builder/index.ts`, add
   `theme: pickThemeForNiche(input.niche),` to the `contentEngine.run({...})`
   input object (~line 139-149).

3. The content-engine input schema at `packages/agents/src/content-engine/schema.ts:37`
   already accepts `theme: z.enum(['classic','modern','premium','bright']).optional()`,
   so no schema change is required.

This fix also activates the previously-dead niche overlays — separate from but
complementary to the cluster_key contract. Position-wise it sits between Fix 1
(schema enum) and Fix 2 (system prompt hardening) because it's a bug, not a
hardening: the overlay text never reached the model at all before this.

**Files to edit:**
- `packages/agents/src/site-builder/pick-theme.ts` (new)
- `packages/agents/src/site-builder/index.ts` (add `theme:` to `contentEngine.run` input)

#### Fix 2 — System prompt hardening (5 min, complementary defense-in-depth)

Even with Fix 1, tighten the prompt so Claude's reasoning isn't constantly fighting the schema. Add to `packages/agents/src/content-engine/system.md` after line 209:

```markdown
## Critical: cluster_key matching

The keyword_clusters table provided in the user prompt lists exactly N clusters
with FIXED `cluster_key` values. For every page you create:

1. Pick a `cluster_key` value verbatim from the table — copy-paste exact.
2. Do NOT abbreviate, paraphrase, or invent new cluster_key values.
3. Each cluster_key from the input must appear on exactly one page.
4. Coverage validation will REJECT your output if any cluster_key is missing
   or any output cluster_key is not in the input list.

If a cluster's primary_keyword feels redundant or low-value, you must STILL
create a page targeting it — pick the page_kind from cluster.page_kind.
```

**File to edit:** `packages/agents/src/content-engine/system.md` — append the section.

#### Fix 3 — Capture failure artifacts (5 min, observability gap)

Today's audit hit a wall because `agent_runs.output` is `null` on failure. The bundle Claude returned was discarded after the gate threw. Fix:

**File to edit:** `packages/agents/src/content-engine/index.ts:194` — before throwing, persist the bundle to `agent_runs.output` (or to a debug column / Sanity draft / blob) so future cluster-coverage incidents are debuggable without rerunning the build.

Pseudocode:
```ts
if (missRate > 0.2) {
  // Persist what Claude actually returned, before throwing.
  ctx.persistArtifact?.('rejected_bundle', parsed);
  throw new Error(...);
}
```

Or simpler: `ctx.log.warn({ rejectedBundle: parsed }, 'rejected bundle')` so the bundle is at least in pino logs.

### Optional belt-and-suspenders (lower priority)

#### Fix 4 — Loosen miss threshold for high-cluster niches (5 min)

Current: `if (missRate > 0.2)`. For niches with >15 clusters, raise to `>0.35` to give legitimate paraphrasing more room while still catching catastrophic misalignment. Only worth doing if Fix 1 isn't viable.

**File to edit:** `packages/agents/src/content-engine/index.ts:194`

#### Fix 5 — Soft fuzzy-match cluster_keys server-side (15 min)

Before the gate runs, do `closest-match`-style normalization: if Claude returned `blog-foundation-repair-cost` and the input had `blog-foundation-repair-cost-austin` and no other close match exists, rewrite the page's `cluster_key` to the input's canonical form. Levenshtein-3 or token-overlap heuristic.

Pragmatic but masks real model failures. Only ship after Fix 1 if there's a residual long-tail of mismatches.

#### Fix 6 — Auto-disable content-engine on N coverage-failures (15 min)

If 3 consecutive content-engine runs fail with `cluster coverage too low` in <1 hour, automatically flip `agent_budgets.enabled=false` for content-engine and emit an alert. Stops the queue retry loop earlier than the existing 5-attempt cap.

**Files to edit:** `packages/agents/src/content-engine/index.ts` (failure path) + a small helper.

#### Fix 7 — Niche overlay update for foundation repair (10 min)

`packages/agents/src/content-engine/niches/trades.md` covers ~20 trades but never mentions foundation repair. The user-prompt cluster table has high semantic density on cost-related queries. Add a short foundation-repair stanza to the trades overlay listing common subtypes (slab, pier-and-beam, crawl-space, concrete, crack-repair) so Claude has explicit anchor terms when picking page slugs.

Useful even with Fix 1 in place — improves bundle quality, not just compliance.

---

## Bounded-loss accounting

| Layer | Currently in place | Worst-case spend per niche |
|---|---|---|
| `RUNTIME_MAX_ATTEMPTS=5` queue cap | ✅ ([queue.ts:97](packages/db/src/queue.ts:97)) | 5 × $0.50 = **$2.50** |
| Per-agent daily cap ($10 content-engine) | ✅ ([agent_budgets](packages/db/src/schema.ts)) | Caps at $10/day |
| Master kill switch | ✅ ([base.ts:144](packages/agents/src/base.ts:144)) | Manual stop |

**May 7 $135 was likely amplified by a `cluster.ready` cascade** that produced 4 site-builder events per `niche.approved` (per the `5161d42` commit message). That cascade is fixed. So with current guards in place, **future single-niche worst case is ~$2.50** before dead-letter. With kill switch + Fix 1, this drops to ~$0 because the gate will never fire.

---

## Recommended execution order

1. **Fix 1 (tool-use enum)** — primary mitigation. Estimate 30 min including verification. Schedule first.
2. **Fix 1.5 (pass theme into content-engine input)** — activates the dead-code niche overlays and pairs with Fix 1. ~10 min.
3. **Fix 2 (system prompt hardening)** — pair with Fix 1/1.5. Adds 5 min; minimal test surface.
4. **Fix 3 (failure artifact capture)** — adds debuggability for next time. 5 min.
4. **Verify with foundation-repair rebuild** — flip kill switch off, approve the niche again, confirm first-attempt success.
5. **Optional Fix 7** — niche overlay update for content quality.
6. **Skip Fixes 4/5/6 unless Fix 1 proves flaky.**

Total fix time for the primary mitigation: ~45 min including testing. After landing, foundation-repair (and any other high-cluster niche) builds in one attempt for ~$0.50 total.

---

## Open questions

1. Does Anthropic's tool-use API enforce `enum` constraints on `string` fields server-side for the model in use (Sonnet 4.6 currently per env)? Verify before relying on Fix 1.
2. Is there a benefit to passing the cluster list to the keyword-planner side too (via tool-use enum), to ensure the planner's output `cluster_key` values are normalized canonical slugs before they reach content-engine? Currently planner builds them via `keywordClusterDocId()` so they should be deterministic — but worth a sanity check.
3. Should bundle generation be SHARDED across multiple LLM calls (one per page kind) for niches with >15 clusters? Reduces per-call context and improves slug compliance, at higher LLM cost. Defer until Fix 1 is shown to be insufficient.
