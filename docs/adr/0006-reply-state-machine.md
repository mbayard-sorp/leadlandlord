# ADR-0006 — Guest-Post Reply State Machine

**Date:** 2026-05-11
**Status:** Accepted
**Deciders:** leadlandlord-architect
**Context source:** HANDOFF-R4-BACKLINKS.md §Locked decisions, §R4.4, §R4.5, §R4.7

---

## Context

The existing `backlinks` table tracks link acquisition with a five-value status enum:
`pending | submitted | live | rejected | lost`. This was designed for citations and
directory submissions where the state machine is shallow: submit, check if live, done.

The Molly guest-post pipeline requires a much richer state machine covering prospect
discovery, human approval gates, outbound pitch, inbound reply classification, draft
production, operator review, content delivery, and publication verification. Mapping
this onto the existing five values would either overload `pending` as an ambiguous
catch-all or require interpreting status from `metadata` fields, which is
unqueryable and fragile.

A second concern is entity type confusion. The existing `prospects` table (schema.ts:209)
is the *tenant sales CRM*: it tracks business owners who might rent a LeadLandlord site.
The handoff doc proposes adding `score`, `rationale`, and `flagged_top5_at` columns to
`prospects`. Those columns would be meaningless on a CRM contact row and would collide
semantically with the existing `prospect_status` enum which tracks sales-cycle steps
(`new | contacted | replied | accepted_trial | declined | unreachable | converted | lost`).

---

## Decision

### 1. New table: `backlink_prospects`

A new table `backlink_prospects` tracks candidate domains from the DFS discovery phase
through operator approval — the pre-pitch stages that currently live in
`backlinks.metadata.prospect`. This separates the two entity types cleanly:
`backlinks` = a link acquisition attempt (one per target domain per pitch send);
`backlink_prospects` = a scored domain candidate (one per discovered domain).

Key columns:

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `site_id` | uuid FK → sites | |
| `domain` | text NOT NULL | bare host |
| `domain_rank` | integer | DataForSEO `domain_rank` at discovery time |
| `status` | `backlink_prospect_status` enum | see states below |
| `score` | numeric(5,2) | Molly-scorer output (0–100) |
| `rationale` | text | Molly-scorer one-sentence justification |
| `flagged_top5_at` | timestamptz | set when MollyScorer marks this as a top-5 pick |
| `approved_at` | timestamptz | set when operator approves in the top-5 review UI |
| `backlink_id` | uuid FK → backlinks nullable | set once a pitch row is created |
| `dedupe_key` | text UNIQUE NULLS NOT DISTINCT | `prospect:${siteId}:${domain}` |
| `metadata` | jsonb | DFS signals, Apollo enrichment, Firecrawl receptivity |
| `created_at` | timestamptz NOT NULL DEFAULT NOW() | |
| `updated_at` | timestamptz NOT NULL DEFAULT NOW() | |

The `prospect_status` enum for `backlink_prospects` (not the same as the existing
`prospect_status` enum on the CRM table):

```sql
CREATE TYPE backlink_prospect_status AS ENUM (
  'prospected',
  'scored',
  'flagged_top5',
  'approved',
  'pitched'  -- linked to a backlinks row
);
```

### 2. Extend `backlinks.status` enum (additive only)

The existing `backlinkStatusEnum` is extended. Postgres `ALTER TYPE ... ADD VALUE` is
additive and does not require a table rewrite. New values are added after the existing
ones to preserve ordinal stability.

Final enum after migration:

```sql
ALTER TYPE backlink_status ADD VALUE IF NOT EXISTS 'awaiting_reply'   AFTER 'submitted';
ALTER TYPE backlink_status ADD VALUE IF NOT EXISTS 'reply_received'   AFTER 'awaiting_reply';
ALTER TYPE backlink_status ADD VALUE IF NOT EXISTS 'accepted'         AFTER 'reply_received';
ALTER TYPE backlink_status ADD VALUE IF NOT EXISTS 'declined'         AFTER 'accepted';
ALTER TYPE backlink_status ADD VALUE IF NOT EXISTS 'silent'           AFTER 'declined';
ALTER TYPE backlink_status ADD VALUE IF NOT EXISTS 'escalated'        AFTER 'silent';
ALTER TYPE backlink_status ADD VALUE IF NOT EXISTS 'drafting'         AFTER 'escalated';
ALTER TYPE backlink_status ADD VALUE IF NOT EXISTS 'draft_pending_review' AFTER 'drafting';
ALTER TYPE backlink_status ADD VALUE IF NOT EXISTS 'draft_approved'   AFTER 'draft_pending_review';
ALTER TYPE backlink_status ADD VALUE IF NOT EXISTS 'delivered'        AFTER 'draft_approved';
ALTER TYPE backlink_status ADD VALUE IF NOT EXISTS 'published'        AFTER 'delivered';
ALTER TYPE backlink_status ADD VALUE IF NOT EXISTS 'verified'         AFTER 'published';
ALTER TYPE backlink_status ADD VALUE IF NOT EXISTS 'dormant'          AFTER 'verified';
ALTER TYPE backlink_status ADD VALUE IF NOT EXISTS 'manual_review'    AFTER 'dormant';
```

Existing values (`pending`, `submitted`, `live`, `rejected`, `lost`) are kept as-is.
`live` maps to the semantic formerly called `published` for citations and directories;
guest-post rows will not use `live` — they use `published` → `verified` instead.
This is mildly ambiguous but acceptable for MVP scope; a follow-up migration can
alias or phase out `live` for guest-post rows after pilot.

### 3. New columns on `backlinks`

```sql
ALTER TABLE backlinks
  ADD COLUMN message_id        text,          -- Zoho Message-ID of the outbound pitch email
  ADD COLUMN anchor_type       text,          -- 'branded' | 'naked' | 'generic' | 'partial'
  ADD COLUMN draft_markdown    text,          -- MollyCopywriter output
  ADD COLUMN published_at      timestamptz,   -- set when maintenance watcher finds the live URL
  ADD COLUMN published_url     text,          -- canonical URL of the live guest post
  ADD COLUMN nudge_count       integer NOT NULL DEFAULT 0,
  ADD COLUMN last_nudge_at     timestamptz;
```

`message_id` is the raw `Message-ID` SMTP header value (e.g., `<abc123@mail.zoho.com>`).
`MollyInbox` filters inbound Zoho threads by matching the `In-Reply-To` header against
this column. Indexed: `CREATE INDEX backlinks_message_id_idx ON backlinks (message_id)
WHERE message_id IS NOT NULL`.

---

## Full state machine

### Happy path

```
backlink_prospects.status       backlinks.status
─────────────────────────────   ─────────────────────────────────────────────────────
prospected
  │
  ▼ [MollyScorer cron — weekly per site]
scored
  │
  ▼ [MollyScorer selects top 5, sets flagged_top5_at]
flagged_top5
  │
  ▼ [Operator approves in /operator/backlinks/prospects top-5 tab]
approved ──────────────────────► pitched
                                   │  [BacklinkBuilder.guest_post — on prospect.approved event]
                                   │  backlinks row created, status = submitted
                                   ▼
                                 awaiting_reply
                                   │  [MollyInbox cron — daily 7am MST, nudge loop]
                                   │  on nudge send: nudge_count++, last_nudge_at = now()
                                   ▼
                                 reply_received
                                   │  [MollyInbox — per-thread Haiku classification]
                                   ▼
                           ┌───────┴────────┐
                        accepted          declined
                           │                │
                           │                ▼
                           │             [MollyInbox auto-reply: polite thanks]
                           │             → lost  (terminal)
                           ▼
                         drafting
                           │  [MollyCopywriter — triggered by guest_post.accepted event]
                           ▼
                         draft_pending_review
                           │  [Operator reviews at /operator/backlinks/[id]/draft]
                           ▼
                         draft_approved
                           │  [Operator approves]
                           ▼
                         delivered
                           │  [BacklinkBuilder delivers draft via Zoho]
                           ▼
                         published
                           │  [Maintenance watcher — weekly Firecrawl check]
                           │  sets published_at + published_url
                           ▼
                         verified
                              [Maintenance watcher — GSC check 7+ days after published]
```

### Silent branch and nudge cadence

When `awaiting_reply` and no inbound thread is matched, the nudge scheduler fires:

- Days 3, 6, 9, 12, 15, 18, 21 (business days from `submitted_at` / `last_nudge_at`):
  `MollyInbox` sends a short nudge via Zoho, using `MOLLY_PERSONA.voiceSystemPrompt`.
  `nudge_count` increments; `last_nudge_at` updates.
- Day 24 cutoff: if `nudge_count >= 7` or `now() - submitted_at > 24 days` and no
  reply has arrived, status transitions to `silent` then immediately to `dormant`.
  `dormant` is a terminal state for this cycle (no further nudges). It is surfaced in
  the operator inbox as a record of the attempt.

The nudge dedupeKey pattern: `nudge:${backlinkId}:${nudgeCount}` — prevents re-sending
if the cron fires twice in a day.

### Escalation branch

When `MollyInbox` classifies a reply as matching the escalation regex:

```
\bpricing\b|\bfee\b|\bpayment\b|\b(rate|price)\s*(card|sheet)?\b
\b(reciproc|exchange|swap)\w*
\bsponsor\w*|\badvertis\w*
\b(legal|cease|desist|takedown|gdpr|ccpa)\w*
```

Regex match triggers a Haiku confirmation call. If Haiku confirms escalation:
`backlinks.status = 'escalated'`. An `outreach_events` row is written with
`channel = 'email'`, `sentiment = 'escalated'`, and the matched trigger in `metadata`.
No auto-reply fires. The operator sees the thread in the `/operator/backlinks/inbox`
tab with an escalation badge.

Operator can then manually reply or mark as `lost` / `manual_review`.

### Dead-letter rules

| Condition | Transition | Actor |
|---|---|---|
| `delivered` AND `now() - updated_at > 60 days` AND `published_at IS NULL` | → `manual_review` | Maintenance watcher weekly cron |
| `awaiting_reply` AND `now() - created_at > 24 days` | → `silent` → `dormant` | MollyInbox daily cron |
| `draft_pending_review` AND `now() - updated_at > 14 days` with no operator action | Surface in operator inbox digest as stale, no automatic status change | Daily digest email |

`manual_review` is a terminal dead-letter state visible in the operator UI. An operator
can manually reclassify a `manual_review` row to any valid status.

---

## Transition table (full)

| From | To | Trigger | Actor | Idempotency |
|---|---|---|---|---|
| (new row) | `pending` | `BacklinkBuilder.prospect` discovery | BacklinkBuilder | `dedupe_key` UNIQUE constraint |
| `prospected` | `scored` | MollyScorer weekly cron | `molly-scorer` | `dedupeKeyFn`: `molly-scorer:${siteId}:${ymd}` |
| `scored` | `flagged_top5` | MollyScorer selects top 5, writes `flagged_top5_at` | `molly-scorer` | Only 5 rows per run; re-run re-selects same 5 if scores unchanged |
| `flagged_top5` | `approved` | Operator clicks approve in UI; `prospect.approved` event emitted | operator | `agent_events` dedupe on event type + prospect id |
| `approved` | `pitched` (`backlinks` created, `submitted`) | `BacklinkBuilder.guest_post` on `prospect.approved` event | `backlink-builder` | `guest_post:${siteId}:${domain}` dedupe key |
| `submitted` | `awaiting_reply` | MollyInbox first poll finds no reply | `molly-inbox` | Status written once; re-poll is no-op if already `awaiting_reply` |
| `awaiting_reply` | `reply_received` | MollyInbox matches inbound `In-Reply-To` to `backlinks.message_id` | `molly-inbox` | `nudge:${backlinkId}:reply` dedupe |
| `reply_received` | `accepted` | Haiku classification returns `accept` | `molly-inbox` | Row update is idempotent |
| `reply_received` | `declined` | Haiku classification returns `decline` | `molly-inbox` | Row update is idempotent |
| `reply_received` | `escalated` | Regex + Haiku escalation confirmation | `molly-inbox` | `outreach_events` row with escalation metadata |
| `reply_received` | `silent` | No inbound match after day 24 | `molly-inbox` | Nudge count + cutoff checked before write |
| `accepted` | `drafting` | `guest_post.accepted` event consumed by `molly-copywriter` | `molly-copywriter` | `dedupeKeyFn`: `molly-copywriter:${backlinkId}` |
| `drafting` | `draft_pending_review` | SEO pre-flight passes; `draft_markdown` + `anchor_type` written | `molly-copywriter` | Single row update |
| `draft_pending_review` | `draft_approved` | Operator approves at `/operator/backlinks/[id]/draft` | operator | UI button fires server action |
| `draft_pending_review` | `drafting` | SEO pre-flight fails (first retry) | `molly-copywriter` | At most one automatic retry; second fail → `draft_pending_review` with issues in metadata |
| `draft_approved` | `delivered` | Molly sends draft to editor via Zoho | `backlink-builder` (delivery mode) | `delivered:${backlinkId}` dedupe |
| `delivered` | `published` | Maintenance watcher Firecrawl scan finds tenant URL on source domain | maintenance | Weekly cron; sets `published_at`, `published_url` |
| `published` | `verified` | Maintenance watcher GSC API confirms link indexed | maintenance | 7+ days after `published_at` |
| `delivered` | `manual_review` | 60 days elapsed, no published hit | maintenance | Dead-letter sweep |
| `silent` | `dormant` | Immediate after silent classification | `molly-inbox` | Same cron tick |

---

## Consequences

- Two new DB objects: `backlink_prospects` table + `backlink_prospect_status` enum.
- `backlinks` gains seven new columns and fourteen new enum values. All changes are
  additive; no existing rows or application code are broken.
- `backlinks.status` enum now has 19 values. The `backlinkStatusEnum` Drizzle object
  in `packages/db/src/schema.ts` must be updated to include the new values so TypeScript
  type-checks the new statuses. Drizzle does not auto-detect enum additions; the enum
  definition must be manually updated alongside the SQL migration.
- `outreach_events` is reused for reply tracking (channel = 'email', new event_type
  values). No schema change needed — the table is already `metadata: jsonb`.
- The maintenance watcher (R4.7) runs inside the existing `maintenance` agent scheduler,
  or as a new scheduler entry. The handoff specifies a weekly cron — consistent with
  `scheduleMaintenance` already existing in `packages/agents/src/scheduler/maintenance.ts`.
  Delivery-watch logic can be added there without a new scheduler module.

---

## Open questions / for next-engineer

- Migration file number: next available is `0004_r4_molly.sql` or confirm the actual
  next sequence by checking `packages/db/migrations/`.
- `backlink_prospects` vs keeping existing `backlinks.metadata.prospect` blobs:
  existing prospect-mode rows in `backlinks` have `metadata.prospect.run = true` and
  `metadata.prospect.needsManualEditor = true`. After the migration, decide whether to
  backfill these into `backlink_prospects` rows or leave them as legacy blobs. For the
  pilot, leaving them as blobs and only writing new discoveries into `backlink_prospects`
  is the lowest-risk path.
- `backlinks.message_id` uniqueness: a given target domain might receive multiple
  pitches over time (e.g., after a long silence and a reset). Should `message_id` be
  UNIQUE? Recommend nullable non-unique with the index only (one domain can have
  multiple pitch attempts; `dedupe_key` already enforces per-run idempotency).
- "Business day" for nudge cadence: the handoff says "every 3 business days." The
  scheduler is a UTC cron with no awareness of US holidays or weekends. Decide: (a)
  interpret "business days" loosely as calendar days ÷ 1.4 (approximate), or (b) use
  calendar days 3/6/9/12/15/18/21 with the understanding that a nudge landing on a
  Saturday is not harmful. Recommend (b) for MVP simplicity.
- `draft_pending_review` stale alert threshold: 14 days is suggested above. Confirm
  with Mike — if the draft sits 14 days without action it likely means Mike forgot
  rather than intentionally held it.
- The `live` status value already exists in the enum and is used by citation rows to
  mean "the link is live." Guest-post rows will use `published` instead. Document this
  convention in a code comment in `schema.ts` to prevent future confusion.
