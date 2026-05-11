# R4 — Molly Backlinks · In-Progress Handoff

**Filed:** 2026-05-11 by Mike + Claude.
**Status:** R4.0–R4.2 committed on `feat/r4-molly-backlinks`. Resume at R4.3.
**Worktree:** `/Users/mikebayard/Claude/LeadLandlord/.claude/worktrees/r4-molly-backlinks`
**Branch:** `feat/r4-molly-backlinks` (off `origin/main` @ `1d4e502`)
**Original spec:** `docs/HANDOFF-R4-BACKLINKS.md` — read this first for full strategic context.

---

## Phases — status

| Phase | Status | Commit |
|-------|--------|--------|
| R4.0 — ADRs 0005/0006/0007 | ✅ done | `64afba0` |
| R4.1 — Molly persona + BacklinkBuilder wiring | ✅ done | `876cad9` |
| R4.2 — Schema + MollyScorer + Firecrawl + top-5 UI | ✅ done | `4b5300d` |
| R4.3 — BCC graduation + `prospect.approved` event handler | ⏭ next | — |
| R4.4 — MollyInbox reply loop | pending | — |
| R4.5 — MollyCopywriter | pending | — |
| R4.6 — SEO Expert pre-flight + anchor ledger | pending | — |
| R4.7 — Delivery + publish verification | pending | — |
| R4.8 — QA + smoke | pending | — |

---

## Locked facts (resolve doc conflicts with these)

- **Persona name:** Molly Matthews. Sr. Outreach Manager. `molly@leadslandlord.com`.
- **Pilot tenant:** `junk-removal-vegas`.
- **Anchor distribution:** 50% branded / 25% naked / 15% generic / 10% partial. Deterministic, no LLM in the bucket pick.
- **BCC graduation:** First 20 outbound emails globally → daily 7am MST digest. Manual override toggle in operator settings.
- **Escalation triggers:** Regex first, then Haiku confirmation. Triggers in `docs/adr/0006-reply-state-machine.md`.
- **Nudge cadence:** Calendar days 3/6/9/12/15/18/21 (treating "business days" as calendar days for MVP simplicity per ADR-0006 open question).
- **Daily cron timing:** 7am MST = `0 14 * * *` UTC (pinned year-round; accept one-hour DST drift).

---

## What R4.0–R4.2 actually built

### R4.0 — ADRs (commit `64afba0`)

Three ADRs in `docs/adr/`:

- **0005 — Molly persona over BaseAgent.** Persona layer on `BacklinkBuilder.guest_post` for outbound; new `MollyInbox` BaseAgent for the reply loop. `MOLLY_PERSONA` is pure data, no class.
- **0006 — Reply state machine.** Decided to create a new `backlink_prospects` table (the existing `prospects` table is the *tenant sales CRM*, not domain candidates — handoff doc was wrong on this). Extended `backlinks.status` enum additively from 5 → 19 values.
- **0007 — Anchor distribution policy.** Locked the 4 bucket definitions with enforceable string rules. Portfolio ledger is a deterministic SQL aggregation in `seo-expert/anchor-policy.ts`.

### R4.1 — Persona module (commit `876cad9`)

New file: `packages/agents/src/molly/persona.ts` exporting `MOLLY_PERSONA` (name, title, mailbox, displayName, signatureLine, voiceSystemPrompt, fewShot examples).

Wired into `packages/agents/src/backlink-builder/index.ts` behind `ZOHO_MOLLY_ENABLED=true`:
- Mailbox resolves to `ZOHO_MOLLY_FROM ?? 'molly@leadslandlord.com'` — `email_sends.mailbox` records the actual Molly address so the per-mailbox throttle is isolated automatically.
- From field encodes as RFC 5322 `"Molly Matthews <molly@leadslandlord.com>"`.
- Send always routes through Zoho when Molly is active (regardless of `ZOHO_MCP_ENABLED`).
- Claude call gets `system: MOLLY_PERSONA.voiceSystemPrompt` + 3 few-shot user/assistant pairs prepended.
- Body fallback (Claude non-JSON) ends with Molly's signature line instead of niche-team sign-off.

**Small known leak:** the fallback intro line ("I run a" → "I run outreach for a") and word count (700 → 900) changed for the flag-OFF path too. Only fires when Claude returns malformed JSON. Mike chose to leave it.

### R4.2 — Schema + MollyScorer + Firecrawl + UI (commit `4b5300d`)

**DB migration:** `packages/db/migrations/0018_r4_molly.sql`
- Creates `backlink_prospect_status` enum (5 values).
- Creates `backlink_prospects` table (id, site_id, domain, domain_rank, status, score, rationale, flagged_top5_at, approved_at, backlink_id, dedupe_key, metadata, created_at, updated_at). UNIQUE NULLS NOT DISTINCT on dedupe_key. Two indexes: `(site_id, status)`, `flagged_top5_at DESC WHERE NOT NULL`.
- 14 additive `ALTER TYPE backlink_status ADD VALUE IF NOT EXISTS` statements.
- 7 new columns on `backlinks`: `message_id`, `anchor_type` (with CHECK constraint), `draft_markdown`, `published_at`, `published_url`, `nudge_count`, `last_nudge_at`.
- Partial index on `backlinks.message_id WHERE NOT NULL`.

**Drizzle:** `packages/db/src/schema.ts` updated to match. Comment near the enum documents `live` (citations) vs `published` → `verified` (guest posts).

**MollyScorer:** `packages/agents/src/molly-scorer/index.ts`
- Pulls up to 20 `backlink_prospects` with `status='prospected'` for the site.
- DA-filters to 25–60 before scoring (rows outside the band stay `prospected`).
- Calls `scrapeReceptivity()` per eligible domain; stashes results in `metadata.receptivity`.
- Single batched `claude-haiku-4-5` call → top 5 get `flagged_top5_at = now()`, `status = 'flagged_top5'`; remainder get `status = 'scored'`.
- `dedupeKeyFn`: `molly-scorer:${siteId}:${YYYYMMDD}`. `defaultDailyCapUsd`: $1.
- Registered as `'molly-scorer'` in `packages/agents/src/registry.ts`.
- Graceful degradation on malformed JSON (logs, marks all `scored` with `score=null`, doesn't crash).

**Firecrawl wrapper:** `packages/integrations/src/firecrawl/index.ts`
- `scrapeReceptivity(domain)` returns `{ receptive, signals, sampledUrls }`.
- Probes `/write-for-us`, `/contribute`, `/contact`, `/about` (stops at 3 successful fetches).
- Regex: `guest post|contribute|submission|write for us|guest author|guest contributor` (case-insensitive).
- Requires `FIRECRAWL_API_KEY`. Throws `IntegrationError` if absent.

**Operator UI:**
- `apps/operator/app/operator/backlinks/prospects/page.tsx` — added tab nav. Two tabs: "All prospects" (default) and "Molly's top 5" (`?tab=molly`). Badge shows count of `flagged_top5` awaiting action.
- `apps/operator/app/operator/backlinks/prospects/MollyTop5.tsx` — card grid showing domain, score (color-coded), rationale, DA, receptivity signals.
- `apps/operator/app/operator/backlinks/prospects/molly-actions.ts` — `approveProspect` server action sets `status='approved'`, `approved_at=now()`, emits `prospect.approved` agent event targeting `backlink-builder`. `rejectProspect` returns to pool with `metadata.rejectedAt`.

---

## Pending manual steps (Mike)

Required before the pipeline runs end-to-end. Code is shipped behind flags; nothing breaks if these are skipped.

1. **Apply migration 0018:** `cd .claude/worktrees/r4-molly-backlinks && pnpm db:migrate` (or whatever the existing migration runner is — check `packages/db/package.json`).
2. **Namecheap DNS:** point `molly@leadslandlord.com` MX to Zoho. Likely just add the mailbox to the existing Zoho org if leadslandlord.com already uses Zoho. Confirm a free-tier seat is available (Zoho free covers 5 users).
3. **Vercel env vars** on the operator project (preview + production scopes):
   - `ZOHO_MOLLY_ENABLED=true` — switches BacklinkBuilder.guest_post into Molly mode.
   - `ZOHO_MOLLY_FROM=molly@leadslandlord.com` — optional, defaults to the persona value.
   - `FIRECRAWL_API_KEY=...` — required for MollyScorer receptivity checks.
4. **Optional** per-mailbox Zoho OAuth (`ZOHO_MOLLY_CLIENT_ID/SECRET/REFRESH_TOKEN`): deferred. Only needed if Molly's mailbox is a *separate* Zoho account. If she's just an alias / member of the existing org, the shared MCP connection works with the From-address override.

---

## R4.3 — what's next

Reference: `docs/HANDOFF-R4-BACKLINKS.md` §R4.3.

### Scope

1. **`bcc_graduation` table.** Single-row state machine. Migration:
   ```sql
   CREATE TABLE bcc_graduation (
     id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     agent_name      text NOT NULL UNIQUE,
     outbound_count  integer NOT NULL DEFAULT 0,
     graduated_at    timestamptz,
     manual_override boolean NOT NULL DEFAULT false,
     bcc_address     text,
     created_at      timestamptz NOT NULL DEFAULT NOW(),
     updated_at      timestamptz NOT NULL DEFAULT NOW()
   );
   ```
   Seed one row with `agent_name='molly'`.

2. **BCC logic in BacklinkBuilder.guest_post.** When `useMolly` AND `outbound_count < 20` AND `graduated_at IS NULL` AND `NOT manual_override`: BCC `bcc_address` (default to Mike's email from env `MOLLY_BCC_ADDRESS`). After 20 sends, set `graduated_at = now()`. Same transaction as the `email_sends` insert.

3. **`prospect.approved` event handler.** Wire BacklinkBuilder (or a thin dispatcher) to consume `prospect.approved` events emitted by R4.2's operator UI. On event:
   - Load the `backlink_prospects` row.
   - Run `BacklinkBuilder.guest_post` with `siteId`, `targetDomain` from the prospect, `pitchTopic` (derived or operator-provided).
   - On successful send: `backlink_prospects.status = 'pitched'`, `backlink_prospects.backlink_id = <new backlinks.id>`. Both `backlinks.status = 'submitted'` and `backlinks.message_id = <Zoho message id>`.
   - Idempotent: dedupe on `guest_post:${siteId}:${domain}`.

4. **Daily 7am MST digest.** New scheduler entry `packages/agents/src/scheduler/molly-digest.ts` (or extend `packages/agents/src/scheduler/molly-inbox.ts` later in R4.4). Cron `0 14 * * *` UTC. Sends an email digest to Mike (sent / replied / escalated counts, per-site breakdown) when `bcc_graduation.graduated_at IS NOT NULL`.

5. **Operator UI "Molly settings" page.** `apps/operator/app/operator/molly/page.tsx`:
   - Current `outbound_count` and graduation status.
   - Manual override toggle.
   - BCC email override input.
   - Persona preview (read-only display of `MOLLY_PERSONA`).

### Verification

- Send 20 test pitches → 21st sends without BCC.
- Daily digest email arrives at 7am MST with counts.
- Operator can toggle override and the next send respects the change.

### Constraints for the executor

- DO NOT touch R4.4+ scope (no inbox polling, no reply classification).
- Reuse the existing scheduler / cron pattern in `packages/agents/src/scheduler/`.
- The `email_sends` table already records the BCC field if the send-layer is wired correctly — check `packages/integrations/src/zoho-mcp/` to confirm BCC is supported in the send call; if not, that's a small fix that lands in R4.3.
- Migration number: next after `0018_r4_molly.sql`.

---

## Open questions deferred from prior phases

1. **`approveProspect` idempotency guard** (`molly-actions.ts:58`): currently has placeholder `return false` for the duplicate-event check because `agent_events.payload` is raw jsonb. Recommend: accept double-click results in two events; BacklinkBuilder's own `dedupeKeyFn` collapses duplicates downstream. Leave as-is unless R4.3 surfaces a real problem.

2. **Per-mailbox Zoho OAuth:** deferred from R4.1. Only blocks if Molly is a separate Zoho account, not an alias. Land in a follow-up before fleet rollout.

3. **Existing `backlinks.metadata.prospect` blobs:** legacy prospect-mode rows in `backlinks` are NOT backfilled into `backlink_prospects`. New discoveries write to the new table; legacy rows stay as blobs. Per ADR-0006, this is the MVP-correct path.

4. **`live` vs `published` ambiguity:** the existing `live` enum value is kept for citation rows. Guest-post rows use `published` → `verified`. Documented in `schema.ts` comment.

5. **R4.2 small fallback leak in BacklinkBuilder:** intro line and word count changed for the flag-OFF fallback path. Cosmetic, fires only on Claude non-JSON. Mike chose to leave.

---

## For the executor picking this up

1. **Read this entire file**, then `docs/HANDOFF-R4-BACKLINKS.md` §R4.3, then ADR-0005 and ADR-0006 (the schema and state-machine specs you're implementing against).
2. **Verify the state of the worktree:** `cd /Users/mikebayard/Claude/LeadLandlord/.claude/worktrees/r4-molly-backlinks && git log --oneline -5` — expect HEAD at `4b5300d`.
3. **Do NOT assume the migration has been applied.** If you're spinning up against a local DB, run `pnpm db:migrate` yourself or ask Mike. R4.3 code should be written without dependencies on migrated DB state during typecheck — Drizzle schema is the contract.
4. **Phase boundaries are PR boundaries.** Land R4.3 as its own commit (and PR if Mike wants one) before starting R4.4.
5. **If a doc contradicts the code, flag it to Mike.** Do not assume doc is right. Do not assume code is right.

Orchestration sequence for the remaining phases (per the original handoff):
- `next-engineer` does R4.3 → R4.7 sequentially.
- `leadlandlord-seo-auditor` validates R4.6 anchor policy.
- `leadlandlord-qa` runs R4.8 full smoke.
- 4 weeks pilot watch on `junk-removal-vegas` → decide fleet rollout.

Good luck.
