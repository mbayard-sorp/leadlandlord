# ADR 0015 — IndexNow Delta Emit from SEO Operator

**Date:** 2026-05-21  
**Status:** Decided

## Context

[ADR 0014](0014-indexnow-ping-on-activation.md) added a `site.activated` IndexNow submission on go-live (full sitemap). The `indexnow-submitter` agent also accepts a `site.content.updated` event carrying a `urls` delta, but nothing emitted it — so post-launch content edits never triggered a recrawl ping. Those edits come from `seo-operator`'s apply pass, which patches Sanity (`title_rewrite`, `meta_rewrite`, `new_info_page`) but emitted no downstream event.

Two design questions:
- Which apply outcomes warrant a recrawl ping (crawl-budget / spam considerations)?
- `ctx.emitNextStepEvent` vs a raw `db.insert(agentEvents)`.

## Decision

### 1. Emit only on `auto_applied`, only for content-meaningful types

The emit lives at the end of `runApply` (after `markStatus`), gated on `outcome === 'auto_applied'`. URLs are built per type by `contentUpdatedUrls(rec)`:
- `title_rewrite` / `meta_rewrite` → `rec.actionPayload.targetPage` (the GSC URL the handler patched; already absolute).
- `new_info_page` → `https://{sites.domain}/{proposedSlug}`.
- `schema_fix` and the phase-2 stubs (`alt_text`, `internal_link`, `lighthouse_perf`) → `[]` (no ping). Schema fixes touch non-visible JSON-LD; the stubs make no content change. Pinging on those would spend crawl signal on non-content and risk training the engines to deprioritize the domain.

### 2. Raw `db.insert(agentEvents)`, not `emitNextStepEvent`

`BaseAgent.emitNextStepEvent` suppresses emits when the agent runs as a sub-agent (`parentRunId` set) — a guard against pipeline cascades (incident 2026-05-07). That guard is wrong here: the IndexNow ping is a legitimate side-effect of a content change, not a pipeline continuation, and must fire regardless of how `seo-operator` was invoked. This matches the existing raw-insert fan-out in `seo-operator`'s review pass (`seo.recommendation.created`). The event targets `indexnow-submitter`, which emits nothing further, so there is no cascade risk.

## Consequences

- IndexNow pings follow Sanity content writes within one operator-tick cycle.
- The submitter's delta dedupe key (`indexnow:delta:{site_id}:{hash(urls)}`) collapses identical URL sets, so re-applying the same recommendation does not double-submit.
- A site with no attached domain yields `[]` (no ping); the submitter would skip it anyway.
- If `targetPage` is ever non-absolute, `contentUpdatedUrls` drops it (guards on `http`), avoiding a submitter input-validation failure.
