# R4.4 — MollyInbox Reply Loop · Handoff

**Filed:** 2026-05-12 by Mike + Claude.
**Status:** R4.0–R4.3 done and shipped in [PR #46](https://github.com/mbayard-sorp/leadlandlord/pull/46). Resume at R4.4.
**Prior handoffs:** `docs/HANDOFF-R4-BACKLINKS.md` (full strategic context), `docs/HANDOFF-R4-PROGRESS.md` (R4.3 starting state — superseded by this doc).

---

## Phases — status

| Phase | Status | Reference |
|-------|--------|-----------|
| R4.0 — ADRs 0005/0006/0007 | ✅ done | `64afba0` |
| R4.1 — Molly persona + BacklinkBuilder wiring | ✅ done | `876cad9` |
| R4.2 — Schema + MollyScorer + Firecrawl + top-5 UI | ✅ done | `4b5300d` |
| R4.3 — BCC graduation + `prospect.approved` handler + digest | ✅ done | `8d693d3` |
| R4.4 — MollyInbox reply loop | ⏭ next | — |
| R4.5 — MollyCopywriter | pending | — |
| R4.6 — SEO Expert pre-flight + anchor ledger | pending | — |
| R4.7 — Delivery + publish verification | pending | — |
| R4.8 — QA + smoke | pending | — |

---

## Locked facts (resolve doc conflicts with these)

Carried forward from the R4.3 handoff, plus updates from this session.

- **Persona:** Molly Matthews, Sr. Outreach Manager, `molly@leadslandlord.com`. Defined in `packages/agents/src/molly/persona.ts`.
- **Molly's Zoho:** alias of the existing company Zoho org — shared `ZOHO_MCP_URL` + `ZOHO_ACCOUNT_ID` handle From-address override. Per-mailbox OAuth (`ZOHO_MOLLY_CLIENT_ID/SECRET/REFRESH_TOKEN`) is **NOT needed**.
- **Pilot tenant:** `junk-removal-vegas`.
- **Anchor distribution:** 50% branded / 25% naked / 15% generic / 10% partial — locked in ADR-0007.
- **BCC graduation:** first 20 outbound emails globally per agent (Molly seeded in `bcc_graduation`). Daily 7am MST digest fires after graduation.
- **Escalation triggers:** Regex first, then Haiku confirmation. Triggers listed in ADR-0006.
- **Nudge cadence:** calendar days 3/6/9/12/15/18/21 (MVP simplification: treat business days as calendar days).
- **Daily cron timing:** `0 14 * * *` UTC = 7am MST (pinned year-round; accept one-hour DST drift).
- **Firecrawl:** working, key set in `.env.local`. Free tier 500 credits/month; ~3 credits per MollyScorer probe.

---

## What R4.0–R4.3 already built (in this PR)

Detail in [PR #46](https://github.com/mbayard-sorp/leadlandlord/pull/46). The schema, schemas, and integration points R4.4 will lean on:

- **`backlinks.message_id`** — set on every successful Molly send (R4.3 wired this). Indexed (`backlinks_message_id_idx`, partial). MollyInbox correlates replies via In-Reply-To against this column.
- **`backlinks.status` enum** — extended in migration 0018 from 5 → 19 values. R4.4 transitions: `submitted` → `awaiting_reply` → `reply_received` → (`accepted` | `declined` | `silent` | `escalated`).
- **`backlinks.nudge_count`, `backlinks.last_nudge_at`** — present, defaulted, unused. R4.4 populates.
- **`bcc_graduation`** — Molly row seeded. Inbox reads are unrelated; mentioned only to confirm R4.3 is wired.
- **`BacklinkBuilder.guest_post`** — sends with BCC during graduation, populates `message_id`. R4.4 needs a new `nudge` mode or a sibling agent for follow-ups.
- **`BacklinkBuilder.prospect_approved`** — operator-driven entry point. Already shipped.
- **`MOLLY_PERSONA`** — voice rules cap nudges at 60–80 words (already encoded in `voiceSystemPrompt`). Reuse the same Claude wiring.
- **Zoho MCP wrapper** — `packages/integrations/src/zoho-mcp/index.ts` exposes `sendEmail` ONLY. **R4.4 must extend this** with inbox read operations.

---

## R4.4 scope

### Components

1. **Zoho MCP inbox reads** — extend `packages/integrations/src/zoho-mcp/`
   - Add `listMessages({ folderId, since, limit })` and `getMessage(messageId)` wrappers around the appropriate Zoho MCP tools.
   - The current wrapper uses tool name `ZohoMail_sendEmail` via JSON-RPC `tools/call`. Investigate which read-side tools the Zoho MCP server exposes (likely `ZohoMail_listMessages`, `ZohoMail_getMessage` or similar — verify by hitting `tools/list` on the MCP endpoint first).
   - Auth model is identical to send: credential embedded in `ZOHO_MCP_URL`, `accountId` path variable from `ZOHO_ACCOUNT_ID`.
   - Return shape should include: `messageId`, `inReplyTo`, `from`, `subject`, `body` (text), `receivedAt`.

2. **MollyInbox agent** — `packages/agents/src/molly-inbox/index.ts`
   - Polls Molly's inbox for new messages.
   - For each message, look up the `backlinks` row by `inReplyTo === backlinks.message_id` (use the partial index).
   - If a match: classify the reply (see §Classifier below) and transition `backlinks.status`.
   - If no match: ignore (out-of-band conversation, not in our state machine).
   - Persist a high-water mark per poll cycle to avoid re-scanning the whole inbox. Use `system_state` table (existing) keyed by `'molly-inbox:last-seen'`.
   - Idempotent — re-processing the same message produces the same state transition (use `messageId` dedupe on a new `molly_inbox_log` table OR check the current `backlinks.status` before transitioning).

3. **Reply classifier** — pure module under `packages/agents/src/molly-inbox/classifier.ts`
   - **Stage 1 — regex:** match high-confidence patterns per ADR-0006 (e.g. `\b(unsubscribe|stop emailing|remove me|do not contact)\b` → escalated; `\b(no thanks|not interested|pass)\b` → declined; `\b(sounds good|let's do it|send the draft|yes please)\b` → accepted).
   - **Stage 2 — Haiku confirmation:** any reply that doesn't hit a clear regex bucket gets `claude-haiku-4-5` called with the reply body + the original pitch subject. Structured output: `{ classification: 'accepted'|'declined'|'silent'|'escalated', confidence: number, reason: string }`.
   - Output type:
     ```ts
     type ReplyClassification = {
       label: 'accepted' | 'declined' | 'silent' | 'escalated';
       confidence: number;
       source: 'regex' | 'haiku';
       reason: string;
     };
     ```
   - Cost cap: $0.001 per Haiku call. `defaultDailyCapUsd: 2` on the inbox agent.

4. **Nudge mode on BacklinkBuilder** — extend `BacklinkBuilderInput` with `mode: 'nudge'`
   - Input: `{ siteId, backlinkId }`.
   - Loads the existing backlink, reads original pitch subject + body from `pitch_draft` / `subject_line`, drafts a 60–80 word follow-up with the persona system prompt + the original message as few-shot context.
   - Sends via the same Zoho path. BCC graduation policy still applies — the counter is global per-agent.
   - Updates `backlinks.nudge_count += 1`, `backlinks.last_nudge_at = NOW()`.
   - Dedupe: `nudge:${backlinkId}:${nudge_count + 1}` so re-runs collapse.

5. **Nudge scheduler** — `packages/agents/src/scheduler/molly-nudge.ts`
   - Cron `*/30 * * * *` (every 30 min) — granularity for the cadence math is small.
   - Query: backlinks WHERE `type='guest_post' AND status IN ('submitted','awaiting_reply')` AND `last_nudge_at < NOW() - INTERVAL '<N days>'` AND `nudge_count < 7`.
   - N picked from `[3, 6, 9, 12, 15, 18, 21]` indexed by `nudge_count`.
   - Emit one `mode: 'nudge'` event per qualifying backlink. Dedupe per (backlinkId, nudge_count+1).
   - Register in `packages/agents/src/scheduler/index.ts` and the Vercel cron list.

6. **MollyInbox scheduler** — `packages/agents/src/scheduler/molly-inbox.ts`
   - Cron `*/15 * * * *` (every 15 min — Zoho doesn't have webhooks in this setup).
   - Single event per tick fanning out to the `molly-inbox` agent. Dedupe per 15-min slot.

7. **Operator UI surfacing** — minor extensions
   - On `/operator/backlinks` table: add columns for `status`, `nudge_count`, `last_nudge_at`.
   - On `/operator/molly`: show last inbox poll timestamp + classified reply counts (last 24h).
   - Escalated rows surface a "needs review" indicator + a button to manually re-classify.

### What does NOT change in R4.4

- No new DB schema. All required columns and enum values shipped in 0018.
- The persona module is untouched. Nudges reuse `MOLLY_PERSONA.voiceSystemPrompt`.
- The BCC graduation counter is global — nudges count toward graduation just like initial pitches.

### Verification

- Send a test pitch through the prospect_approved path → receive a reply at the Molly mailbox manually → confirm:
  - Inbox poll picks up the reply within 15 min.
  - `backlinks.status` transitions to the right bucket.
  - Escalated replies are flagged in `/operator/molly`.
- Wait 3 days → confirm nudge #1 fires.
- Reply `unsubscribe` → confirm immediate escalation, no further nudges.

---

## Open design questions (resolve before coding)

These were raised at the end of the R4.3 session and **not answered yet**:

1. **Zoho MCP read tools** — does the existing MCP server expose `listMessages` / `getMessage`, or do we need to point at a different MCP endpoint? **Action:** the executor should first POST `{"jsonrpc":"2.0","method":"tools/list"}` against `ZOHO_MCP_URL` to enumerate available tools before writing the wrapper. Report findings before coding the read path.

2. **Regex-first vs Haiku-first classification** — current plan is regex with Haiku fallback. Alternative: always Haiku, use regex only as a fast-path for the highest-confidence cases (e.g. unsubscribe). Tradeoff is cost ($0.001 × N replies/day) vs classification accuracy on edge cases. Recommend regex-first as planned; only revisit if false-positive rate is high during pilot.

3. **Worktree strategy** — should R4.4 stack on `feat/r4-molly-backlinks` (this branch, while PR #46 is in review) or wait for merge? Stacking lets work continue but requires rebase if #46 changes during review. Recommend stack — R4.4 is large enough that waiting will lose a session.

---

## Pending manual steps (Mike)

Required before the pipeline runs end-to-end. R4.4 code can be shipped without these; nothing breaks at typecheck.

1. **Confirm migration 0019 applied to any non-prod envs** (already applied to the linked Neon DB in this session).
2. **Namecheap DNS / Zoho mailbox:** confirmed Molly is an alias on the existing org. No further DNS work.
3. **Vercel env vars** (preview + production scopes) — most already covered in R4.3 handoff. Confirmed values:
   - `ZOHO_MOLLY_ENABLED=true`
   - `FIRECRAWL_API_KEY=...` (set, verified working)
   - `MOLLY_BCC_ADDRESS=mikebayard@me.com`
   - `MOLLY_DIGEST_TO=mikebayard@me.com` (or skip — falls through to `MOLLY_BCC_ADDRESS`)
   - `ZOHO_MOLLY_FROM=molly@leadslandlord.com` — optional override.
4. **NEW for R4.4:** confirm the Zoho MCP server has inbox-read tools enabled on the same `ZOHO_MCP_URL`. If not, may need to enable read scopes in the Zoho MCP integration's OAuth grant.

---

## For the executor picking this up

1. **Read this entire file**, then [PR #46](https://github.com/mbayard-sorp/leadlandlord/pull/46), then ADR-0005 / 0006 / 0007 (`docs/adr/`).
2. **Verify worktree state.** If you're stacking on `feat/r4-molly-backlinks`:
   - `git log --oneline -8` — expect HEAD around `8d693d3` (R4.3) or later if PR #46 has had follow-ups.
   - Confirm `bcc_graduation`, `backlink_prospects`, the 19-value `backlink_status` enum, and the new `backlinks` columns all exist in the DB.
3. **Before writing any inbox-read code**: hit `ZOHO_MCP_URL` with a `tools/list` request and report back what's available. The wrapper design depends on what tools exist.
4. **Phase boundaries are PR boundaries.** Land R4.4 as one (or at most two) coherent commits.
5. **Reuse R4.3 patterns:**
   - Schedulers return `ScheduledEvent[]`, pure read, see `packages/agents/src/scheduler/molly-digest.ts` for the simplest template.
   - Agents extend `BaseAgent`, dedupe via `dedupeKeyFn`, accept a daily cost cap, log via `ctx.log`.
   - Operator UI server actions return `Promise<void>` for `<form action>`, or a typed result if called from a client component.
6. **If a doc contradicts the code, flag it to Mike.** Do not assume doc is right; do not assume code is right.

Orchestration sequence for the remaining phases:
- `next-engineer` does R4.4 → R4.7 sequentially.
- `leadlandlord-seo-auditor` validates R4.6 anchor policy.
- `leadlandlord-qa` runs R4.8 full smoke.
- 4 weeks pilot watch on `junk-removal-vegas` → decide fleet rollout.

Good luck.
