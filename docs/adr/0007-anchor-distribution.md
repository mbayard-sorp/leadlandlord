# ADR-0007 — Anchor Text Distribution Policy

**Date:** 2026-05-11
**Status:** Accepted
**Deciders:** leadlandlord-architect
**Context source:** HANDOFF-R4-BACKLINKS.md §Locked decisions #6, §R4.6

---

## Context

Anchor text distribution is a known Google ranking signal. A portfolio of guest-post
backlinks with uniformly exact-match anchors (e.g., all linking with "junk removal
vegas") is a pattern associated with link schemes and triggers manual action risk.
The goal is a natural-looking distribution across four anchor types that mirrors what
an organically acquired link profile looks like, while still capturing keyword
relevance signals.

The decision is: what are the enforceable rules for each bucket, where is the ledger
stored, and how does the SEO Expert agent consume it to pick the anchor for the next
guest post?

---

## Decision

### Locked distribution targets (portfolio-level, per site)

| Bucket | Target | Description |
|---|---|---|
| `branded` | 50% | Exact business name or domain root word |
| `naked` | 25% | The URL itself |
| `generic` | 15% | Content-navigation phrases with no keyword signal |
| `partial` | 10% | Contains the target keyword but not exact-match |

"Portfolio-level" means the distribution is computed across all `backlinks` rows for
a given `site_id` where `acquired_at IS NOT NULL`. A single post does not need to hit
50% branded — the portfolio as a whole should trend toward these ratios over time.

---

### Bucket definitions (enforceable string rules)

**`branded`**

A candidate anchor string `s` is branded if, after lowercasing and stripping
punctuation, it contains the site's business name token(s) or the site's domain root.

Formal rule:
```
branded(s, site) =
  tokens(normalize(s)) ∩ tokens(normalize(site.businessName)) ≠ ∅
  OR
  normalize(s).includes(domainRoot(site.domain))
```

where:
- `normalize(x)` = `x.toLowerCase().replace(/[^a-z0-9 ]/g, '')`.
- `tokens(x)` = `x.split(' ').filter(t => t.length > 2)` (drops articles/prepositions).
- `domainRoot(d)` = the registrable domain without TLD (e.g., `junkremovalvegas` from
  `junkremovalvegas.com`). Strip hyphens and dots.

Example: business name "Vegas Junk Pros", site domain "vegasjunkpros.com". Branded
anchors include: "Vegas Junk Pros", "vegasjunkpros.com", "vegasjunkpros", "Junk Pros".
Not branded: "junk removal vegas" (keyword phrase, no name token match).

**`naked`**

A candidate anchor is naked if it matches the URL form of the target link (with or
without protocol, with or without trailing slash).

Formal rule:
```
naked(s, targetUrl) =
  normalize(s) === normalize(targetUrl)
  OR normalize(s) === normalize(stripProtocol(targetUrl))
  OR normalize(s) === normalize(stripProtocol(stripTrailingSlash(targetUrl)))
```

Example target URL: `https://vegasjunkpros.com`. Naked anchors: `vegasjunkpros.com`,
`https://vegasjunkpros.com`, `http://vegasjunkpros.com`. Not naked: "visit us at
vegasjunkpros.com" (has surrounding text).

**`generic`**

A candidate anchor is generic if, after normalization, it exactly matches one of a
fixed enumerated set. The set is locked at implementation time and changes only via
a new ADR or PR review — not at runtime.

Canonical generic anchor set:
```
click here, read more, this guide, learn more, this article,
visit here, check this out, find out more, see more, get started,
more info, more information, view more, this post, this page,
our website, our site, here, learn more here, find out here
```

This list is maintained as a constant in `packages/agents/src/seo-expert/anchor-policy.ts`.
Case-insensitive exact match after normalization.

**`partial`**

A candidate anchor is partial if it contains one or more tokens from the site's target
keyword phrase AND is not already classified as branded or naked.

Formal rule (applied only after branded and naked checks fail):
```
partial(s, targetKeyword) =
  tokens(normalize(targetKeyword)) ∩ tokens(normalize(s)) ≠ ∅
```

Example: target keyword "junk removal vegas". Partial anchors: "junk hauling tips",
"vegas junk haulers", "junk removal guide for homeowners", "removal services in vegas".
Not partial (if no keyword token match): "trash pickup advice".

Classification is mutually exclusive and applied in priority order:
1. `branded` (highest priority — name/domain match takes precedence)
2. `naked` (URL form)
3. `generic` (exact list match)
4. `partial` (residual keyword match)
5. If none match: default to `branded` if the site name appears anywhere; otherwise
   treat as `partial` if any keyword token appears; otherwise `generic`.

---

### Portfolio ledger

Implemented as a deterministic, zero-LLM function in
`packages/agents/src/seo-expert/anchor-policy.ts`:

```typescript
export async function pickAnchorBucket(siteId: string): Promise<AnchorType> {
  // 1. Query acquired backlinks for this site.
  const rows = await db
    .select({ anchorType: backlinks.anchorType })
    .from(backlinks)
    .where(
      and(
        eq(backlinks.siteId, siteId),
        isNotNull(backlinks.acquiredAt),
        isNotNull(backlinks.anchorType),
      )
    );

  // 2. Count current distribution.
  const counts = { branded: 0, naked: 0, generic: 0, partial: 0 };
  for (const row of rows) {
    if (row.anchorType && row.anchorType in counts) {
      counts[row.anchorType as AnchorType]++;
    }
  }
  const total = rows.length;

  // 3. If no acquired links yet, return branded (50% target, start there).
  if (total === 0) return 'branded';

  // 4. Compute current percentages and deficit from target.
  const targets: Record<AnchorType, number> = {
    branded: 0.50,
    naked:   0.25,
    generic: 0.15,
    partial: 0.10,
  };
  const deficits = (Object.keys(targets) as AnchorType[]).map((bucket) => ({
    bucket,
    deficit: targets[bucket] - counts[bucket] / total,
  }));

  // 5. Return the bucket with the largest positive deficit.
  //    Ties broken by target-ratio order: branded > naked > generic > partial.
  deficits.sort((a, b) => b.deficit - a.deficit);
  return deficits[0]!.bucket;
}
```

This function is called once per guest-post draft cycle. It returns the single bucket
that, if fulfilled, most improves current distribution toward the target. No LLM call.
No randomness. Given identical DB state, identical output.

---

### Anchor string selection

`pickAnchorBucket()` returns the *type* of anchor to use. The *specific anchor string*
is selected by a second deterministic function, `selectAnchorString()`, which receives
the bucket type, the site context, and the target URL:

| Bucket | Selection rule |
|---|---|
| `branded` | Use `site.businessName` as-is (human-readable form). If longer than 40 chars, truncate at last word boundary. |
| `naked` | Use `site.domain` without protocol (e.g., `vegasjunkpros.com`). |
| `generic` | Randomly sample from the canonical generic set, seeded by `backlinkId` for reproducibility. |
| `partial` | Use a 2–4 word phrase containing the primary keyword token(s) but with a modifier word. The modifier list is a small static set: "tips", "guide", "services", "info", "help", "advice". Concatenate: `${modifier} ${primaryKeywordToken}` or `${primaryKeywordToken} ${modifier}`, picking the form that reads more naturally (deterministic: prefer noun-first for nouns, adjective-first otherwise). |

"Randomly sample seeded by backlinkId" means the generic selection is deterministic per
backlink row — re-running the policy for the same row returns the same anchor. This is
implemented as `GENERICS[parseInt(backlinkId.slice(0,8), 16) % GENERICS.length]`.

---

### How SEO Expert consumes this (R4.6)

`MollyCopywriter` calls `pickAnchorBucket(siteId)` before drafting. The returned bucket
is passed to `selectAnchorString()` to get the final anchor text. Both the bucket
(`anchor_type`) and the selected string are passed to `validateDraft()` in
`packages/agents/src/seo-expert/draft-validator.ts`.

`validateDraft()` verifies:
1. The anchor string is present verbatim in the draft body.
2. The anchor is not in the first or last 200 characters of the draft.
3. The anchor type of the candidate string, when re-classified by the rules above,
   matches the intended bucket (guards against LLM paraphrasing the anchor).

On pass, `backlinks.anchor_type` is written with the selected bucket value before the
row moves to `draft_pending_review`. This write is what the ledger queries — so the
ledger only counts posts where the anchor was actually delivered into a live link
(i.e., `acquired_at IS NOT NULL`).

`pickAnchorBucket()` queries `acquired_at IS NOT NULL` rows only. A post that has been
drafted and delivered but not yet confirmed live (`published` / `verified` states) does
not count toward the distribution until the maintenance watcher sets `acquired_at`.
This is conservative — it slightly overstates deficit in early-stage portfolios (first
~20 links) — but prevents counting links that were never actually published.

---

## Alternatives considered

**LLM-driven anchor selection.** Let Claude pick the anchor based on context. Rejected:
anchor distribution is a compliance constraint, not a creative judgment. LLMs will
drift toward what sounds natural in the draft, which biases toward partial-match
anchors (keyword-rich phrases read well in prose). Deterministic math enforces the
ratio; LLM creativity is reserved for making the anchor read naturally within the
sentence (that's the copywriter's job, not the policy's).

**Per-post target instead of portfolio target.** Enforce 50/25/15/10 on each individual
guest post by rotating anchors. Rejected: a single post with 25% naked anchors would
have fractional links, which is meaningless for a single backlink. Portfolio-level is
the right unit — individual links contribute one bucket each; the portfolio converges
over time.

**Storing anchor type in `backlinks.metadata` instead of a dedicated column.** Rejected:
metadata is jsonb and not queryable without extraction overhead. The ledger runs on
every draft cycle; a dedicated `anchor_type` column with a simple WHERE clause is
significantly faster and avoids jsonb path gymnastics.

---

## Consequences

- `backlinks.anchor_type` (text, nullable) is a new column. Values are constrained to
  the four bucket strings (`branded | naked | generic | partial`) by application-level
  validation; a DB CHECK constraint is optional but recommended.
- `packages/agents/src/seo-expert/anchor-policy.ts` is a new file with no LLM
  dependency. It imports only Drizzle + `@leadlandlord/db`. Fully unit-testable with
  a mock DB.
- The generic anchor set is a compile-time constant. Changes to the set require a code
  change, not a config change, which is intentional — the set should be stable and
  reviewed.
- Pilot site `junk-removal-vegas` will have zero acquired links at R4 launch. The ledger
  will return `branded` for all early picks, which is correct: start with the highest-
  weight bucket and let the ledger diversify as posts accumulate. After ~20 acquired
  links the distribution will begin to converge toward the target ratios.
- `acquiredAt` is set by the maintenance watcher when a published link is confirmed.
  If the maintenance watcher is delayed (e.g., Firecrawl quota exhausted), `acquiredAt`
  stays null and the link does not count in the ledger. This is a lag of at most one
  weekly cron cycle — acceptable for MVP.

---

## Open questions / for next-engineer

- DB CHECK constraint on `anchor_type`: recommend `CHECK (anchor_type IN ('branded',
  'naked', 'generic', 'partial'))`. Confirm this does not conflict with Drizzle's
  migration generation for nullable text columns.
- `selectAnchorString()` for `partial` bucket: the modifier list and concatenation
  order need a small copy-review pass to confirm the phrases read naturally in a
  guest-post body. The list above is a starting point, not final.
- The `GENERICS` constant (canonical generic anchor set) should be exported from
  `anchor-policy.ts` so `draft-validator.ts` can use the same list for re-classification
  without duplication. Avoid importing from one to the other in a cycle — put the
  constant in a shared `anchor-constants.ts` if circular imports become a risk.
- `acquiredAt` column already exists in the `backlinks` schema (`acquired_at`). Confirm
  the maintenance watcher (R4.7) is wiring `acquired_at = NOW()` when setting
  `published_at`. They should be set in the same transaction.
- Fleet rollout (post-pilot): the ledger query has no multi-site aggregation. If the
  decision is ever made to enforce a cross-site portfolio distribution (e.g., don't use
  "branded" for site A if the portfolio-wide branded count is already at 55%), this
  function will need a `siteId` parameter change or a new `pickAnchorBucketFleet()`
  variant. Defer until there is data justifying it.
