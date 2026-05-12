# R4.5 — MollyCopywriter · Handoff

**Filed:** 2026-05-12 by Mike + Claude.
**Status:** R4.0–R4.4 done and on main as of 2026-05-12. Resume at R4.5.
**Prior handoffs:** `docs/HANDOFF-R4-BACKLINKS.md` (full strategic context), `docs/HANDOFF-R4.4-INBOX.md` (R4.4 wrap).

---

## Phases — status

| Phase | Status | Reference |
|-------|--------|-----------|
| R4.0 — ADRs 0005/0006/0007 | ✅ done | `88ef561` |
| R4.1 — Molly persona + BacklinkBuilder wiring | ✅ done | `88ef561` |
| R4.2 — Schema + MollyScorer + Firecrawl + top-5 UI | ✅ done | `88ef561` |
| R4.3 — BCC graduation + `prospect.approved` handler + digest | ✅ done | `88ef561` |
| R4.4 — MollyInbox reply loop | ✅ done | `2fe3a83` (#51, replay of #48) |
| R4.5 — MollyCopywriter | ⏭ next | — |
| R4.6 — SEO Expert pre-flight + anchor ledger | pending | — |
| R4.7 — Delivery + publish verification | pending | — |
| R4.8 — QA + smoke | pending | — |

---

## Locked facts (carry forward; resolve doc conflicts with these)

- **Persona:** Molly Matthews, Sr. Outreach Manager, `molly@leadslandlord.com`. Module: `packages/agents/src/molly/persona.ts`.
- **Pilot tenant:** `junk-removal-vegas`.
- **Anchor distribution target:** 50% branded / 25% naked / 15% generic / 10% partial — ADR-0007.
- **Reply state machine:** ADR-0006. Terminal states (`accepted`, `declined`, `escalated`, `published`, `verified`, `dormant`, `lost`, `manual_review`, `rejected`) never overwritten.
- **No new migrations required for R4.5.** All columns and enum values already shipped in `0018_r4_molly.sql`:
  - `backlinks.draft_markdown` (text)
  - `backlinks.anchor_type` (text with `branded|naked|generic|partial` CHECK constraint)
  - Enum values `drafting`, `draft_pending_review`, `draft_approved`
- **Drizzle migration numbering note:** the most recent migration is `0020_sites_inbound_greeting`. R4.5 adds nothing; if you DO need a migration, use `0021_…`.

---

## What R4.4 published that R4.5 consumes

R4.4 (now on main) transitions backlinks into the reply state machine:

```
submitted | awaiting_reply → (accepted | declined | silent | escalated)
```

When MollyInbox writes `status = 'accepted'`, R4.5 must kick in. **R4.4 does NOT currently emit a downstream `guest_post.accepted` event** — it just sets the column. R4.5 needs ONE of:

1. **(Recommended)** Add an `agent_events` insert inside MollyInbox right after the `accepted` transition: `{ type: 'guest_post.accepted', targetAgent: 'molly-copywriter', payload: { backlinkId } }`. Single 5-line edit in `packages/agents/src/molly-inbox/index.ts`.
2. **(Alternative)** Add a polling scheduler `molly-copywriter` cron that scans `backlinks WHERE status = 'accepted' AND draft_markdown IS NULL`. Avoids touching MollyInbox but adds polling latency.

Recommend (1) — it's how every other agent-to-agent handoff works in this repo (see `BaseAgent.emitNextStepEvent`).

Notably: R4.4 deviated from the original handoff doc's "daily 7am MST" cron — MollyInbox now runs every 15 min, and a separate `molly-nudge` scheduler runs every 30 min for the cadence chase. This is fine; just noting it in case the R4.5 spec implies a daily cycle.

---

## R4.5 scope

### Components

1. **MollyCopywriter agent** — `packages/agents/src/molly-copywriter/index.ts`
   - Input: `{ backlinkId: string }`.
   - Loads `backlinks` row + parent `sites` row + (optional) `backlink_prospects` row for target metadata (recent posts cached in `metadata.prospect.firstSeen`, editor info, niche fit).
   - Guards: skip when status !== `accepted`. Skip when `draft_markdown` already populated (idempotent).
   - Drafts a 1,000–1,500 word post in the target blog's voice (Haiku pre-pass extracts voice signals from 3 recent posts via Firecrawl — `packages/integrations/src/firecrawl/index.ts` is wired and the key is set).
   - Picks the anchor type via `pickAnchor(siteId)` (see component 2).
   - Plants the anchor text once, between paragraphs 3 and N-2 (NOT first/last 200 words).
   - Writes the draft to `backlinks.draft_markdown`, `backlinks.anchor_type`, transitions status `accepted → drafting → draft_pending_review` in one update.
   - Cost cap: `defaultDailyCapUsd: 5` (Sonnet is the dominant cost; ~$0.08/draft).
   - Dedupe key: `molly-copywriter:${backlinkId}` — re-runs are no-ops via `findExistingSuccess`.

2. **Anchor policy (pure module)** — `packages/agents/src/seo-expert/anchor-policy.ts`
   - This is the minimum slice of R4.6 that R4.5 needs. Build it here, R4.6 layers validation on top.
   - `pickAnchor(siteId): Promise<{ type: 'branded'|'naked'|'generic'|'partial', text: string }>`:
     - Query `backlinks WHERE site_id = ? AND acquired_at IS NOT NULL`.
     - Compute current distribution across the four buckets.
     - Return the bucket that maximally rebalances toward 50/25/15/10 (ADR-0007).
     - Deterministic, no LLM call.
     - For the `text` value: pick from a per-bucket template list derived from `site.businessName`, `site.domain`, `site.niche`, `site.city`. Examples:
       - `branded` → `LeadLandlord` (or tenant business name)
       - `naked` → `https://{site.domain}`
       - `generic` → `learn more` / `read the guide` / etc.
       - `partial` → `{niche} in {city}` / `{niche} {city} {state}`
   - **Do NOT validate the draft here.** Validation is R4.6.

3. **Operator UI — draft review** — new dynamic route
   - `apps/operator/app/operator/backlinks/[id]/draft/page.tsx`:
     - Server component, loads the backlink row + site context.
     - Renders `draft_markdown` via the existing markdown renderer used by `site-host` (whatever variant is in use post-#45).
     - Shows anchor type + anchor text, highlighted in the rendered preview if possible (a simple HTML wrap with a sentinel marker the renderer respects, or post-render DOM scan).
     - Two server actions in `actions.ts`:
       - `approveDraft(formData)` → transitions `draft_pending_review → draft_approved`. R4.7 will handle delivery; for R4.5 this is just the column flip.
       - `rejectDraft(formData)` with a `reason` field → transitions back to `accepted` with `rejectionReason` set, clears `draft_markdown`, optionally re-enqueues the agent.
   - Link from `/operator/backlinks` table: when status === `draft_pending_review`, the row's last column shows a "Review draft" link to the new route.

4. **Event emission in MollyInbox** — small edit
   - In `packages/agents/src/molly-inbox/index.ts`, after the `accepted` transition, call:
     ```ts
     await ctx.emitNextStepEvent({
       type: 'guest_post.accepted',
       targetAgent: 'molly-copywriter',
       payload: { backlinkId: row.id },
     });
     ```
   - Notes:
     - `emitNextStepEvent` auto-suppresses when `parentRunId` is set; MollyInbox always runs standalone (cron-driven), so the suppression won't trigger.
     - Dedupe is handled by `molly-copywriter`'s own `dedupeKeyFn`. The events queue's window-dedupe also helps.

5. **Registration**
   - Add `MollyCopywriter` to `packages/agents/src/registry.ts`.
   - **No new scheduler** — R4.5 is event-driven via `emitNextStepEvent`. The operator-tick cron already dispatches `agent_events` to `/api/cron/agent/[name]`.

### What does NOT change in R4.5

- No DB schema. All columns + enum values shipped in 0018.
- No new migrations. (If you find yourself wanting one, ask Mike — the R4.5 scope is deliberately migration-free.)
- No persona changes. Voice comes from `MOLLY_PERSONA.voiceSystemPrompt` injected as the system prompt.
- No SEO Expert agent (that's R4.6). R4.5 builds only the `pickAnchor` deterministic helper.
- No delivery (that's R4.7).

### Model + cost

- **Sonnet** (`claude-sonnet-4-6`) for the draft itself — quality matters more than speed here.
- **Haiku** (`claude-haiku-4-5`) for the voice-extraction pre-pass on 3 recent target posts.
- Env override: `MOLLY_COPYWRITER_MODEL` (sonnet default), `MOLLY_COPYWRITER_VOICE_MODEL` (haiku default).
- Budget: `defaultDailyCapUsd: 5` covers ~60 drafts/day at ~$0.08 each.

### Verification

- Send a test pitch through the `prospect.approved` path with `ZOHO_MOLLY_ENABLED=true`.
- Manually reply from a personal address with "Yes, would love to see a draft."
- Wait ≤15 min for MollyInbox to pick up the reply → confirm `backlinks.status = accepted` AND an `agent_events` row with `target_agent = 'molly-copywriter'`.
- Wait ≤2 min for the operator-tick dispatcher → confirm an `agent_runs` row for `molly-copywriter` succeeds.
- Visit `/operator/backlinks/[id]/draft` → see a 1,000–1,500 word draft with the anchor planted in the middle, anchor type matching the rebalance target.
- Approve → status flips to `draft_approved` (delivery is R4.7, so nothing further happens).

---

## Open design questions (resolve before coding)

1. **Voice extraction caching.** The Haiku pre-pass over 3 recent target posts costs ~$0.005 per call. If multiple sites pitch the same target domain over time, we'd re-extract on every run. Options:
   - (a) Cache the extracted voice signals on `backlink_prospects.metadata.targetVoice` so subsequent runs reuse them.
   - (b) Just let it run every time — cost is trivial.
   - Recommend (a) — it also gives us a place to inspect drift if a target's voice changes.

2. **Anchor placement enforcement.** R4.5 has no validator (that's R4.6). For the pilot, do we trust Sonnet to follow the "between paragraphs 3 and N-2" instruction, or add a deterministic post-processor that scans for the anchor and rejects if it's in the wrong place? Recommend trust + log: write the anchor's paragraph index into `metadata.anchorParagraphIndex` so we can audit drift later.

3. **Reject loop scope.** If an operator rejects a draft, should the agent auto-retry with the rejection reason in the prompt, or wait for explicit re-invocation? Recommend: explicit re-invocation in R4.5 (operator clicks a "Regenerate" button on the rejected row's detail page). Auto-retry is R4.6 territory (it pairs with the SEO validator).

4. **Word count enforcement.** Sonnet will hit 1,000–1,500 most of the time but not always. Hard fail on out-of-range, or accept and flag in metadata? Recommend: accept, flag `metadata.draftWordCount`, surface in operator UI.

5. **What if `accepted` was set by an operator manually (not by MollyInbox)?** MollyInbox is currently the only emitter, but ADR-0006 allows for operator overrides. If an operator manually flips a row to `accepted`, the agent_events emission won't happen. Address by either:
   - (a) Emitting `guest_post.accepted` from the operator UI's status-change server action too.
   - (b) Backing up with a low-frequency `molly-copywriter` cleanup scheduler that polls for `status='accepted' AND draft_markdown IS NULL` rows older than 1 hour.
   - Recommend (a) — keeps the model clean. (b) is a band-aid.

---

## Pending manual steps (Mike)

R4.4 deploy is live. For R4.5:

1. **No env vars required** for the basic flow (Sonnet uses the existing `ANTHROPIC_API_KEY`).
2. Optional override env vars if you want to nudge model choices:
   - `MOLLY_COPYWRITER_MODEL=claude-sonnet-4-6` (default if unset)
   - `MOLLY_COPYWRITER_VOICE_MODEL=claude-haiku-4-5` (default if unset)
3. **Smoke test setup:** ensure `junk-removal-vegas` site has at least one `backlinks` row in `accepted` status before the new agent ships — either via the verification path above, or by manually flipping a row's status in the DB for a dry run.

---

## For the executor picking this up

1. **Read this entire file**, then ADR-0006 + ADR-0007 (`docs/adr/`), then `HANDOFF-R4-BACKLINKS.md` §R4.5 + §R4.6.
2. **Branch off main** (don't stack on anything — main is current as of `2fe3a83`):
   ```
   git checkout main && git pull
   git checkout -b feat/r4.5-molly-copywriter
   ```
3. **Reuse R4.4 patterns:**
   - Agents extend `BaseAgent`, dedupe via `dedupeKeyFn`, accept a daily cost cap, log via `ctx.log`, record usage via `ctx.recordUsage`.
   - Server actions return `Promise<void>` for `<form action>` (see `apps/operator/app/operator/molly/actions.ts`).
   - Operator pages are server components with `export const dynamic = 'force-dynamic'`.
4. **Order of work** (suggested):
   1. `anchor-policy.ts` — pure deterministic module, easy unit tests.
   2. `MollyCopywriter` agent skeleton with input/output schemas + dedupe key.
   3. Voice extraction pre-pass (Firecrawl → 3 posts → Haiku → cached voice signals).
   4. Draft generation (Sonnet, system = MOLLY_PERSONA.voiceSystemPrompt + voice signals).
   5. Update MollyInbox to emit `guest_post.accepted`.
   6. Operator UI route + actions.
   7. Register agent. Typecheck. Build. Commit. PR.
5. **Phase = one PR.** Land R4.5 as one cohesive commit (or at most two — agent code + UI).
6. **If a doc contradicts the code, flag it to Mike.** Don't assume doc is right; don't assume code is right.

Orchestration sequence for the remaining phases:
- `next-engineer` does R4.5 → R4.7 sequentially.
- `leadlandlord-seo-auditor` validates R4.6 anchor policy.
- `leadlandlord-qa` runs R4.8 full smoke.
- 4 weeks pilot watch on `junk-removal-vegas` → decide fleet rollout.

Good luck.
