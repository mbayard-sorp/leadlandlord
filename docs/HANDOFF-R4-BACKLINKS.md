# R4 — Molly Backlinks Pipeline · Handoff

**Filed:** 2026-05-11 by Mike + Claude during R4 design session.
**Status:** Ready for agent team to execute. All open questions resolved.
**Plan source:** [`/Users/mikebayard/.claude/plans/let-s-take-a-big-compiled-sifakis.md`](/Users/mikebayard/.claude/plans/let-s-take-a-big-compiled-sifakis.md) §R4.
**Suggested orchestration:** `leadlandlord-architect` → `next-engineer` → `leadlandlord-seo-auditor` → `leadlandlord-qa`.

---

## Goal

Stand up the half-auto guest-post pipeline so the operator (Mike) spends time on **approvals and review**, not on opening dozens of blogs to hunt for editor emails. Molly does the hunting, scoring, pitching, replying, and pre-flight drafting; Mike approves at three explicit gates.

This phase does **not** ship citation autopilot (R4a) or HARO mode — see *Out of scope* below.

---

## Molly — persona

Molly is the public-facing identity for the outreach agent. Her emails should read as **one-off, human-written messages from a real employee**, not as marketing automation.

| Attribute | Value |
|-----------|-------|
| Name | **Molly Matthews** |
| Title | **Sr. Outreach Manager** |
| Mailbox | **molly@leadslandlord.com** (set up via Namecheap DNS → Zoho mailbox; both outbound + inbound) |
| Signature | Plain text only — no HTML banners, no logo, no "sent from..." footer. Format: `Molly Matthews · Sr. Outreach Manager · LeadLandlord` (one line). |
| Tone | Friendly-peer. Personal, specific, complimentary about a recent post, never templated-sounding. |
| Voice consistency | Single system prompt + few-shot examples shared across pitch → all follow-ups → draft delivery email. |
| Email format | Plain text. No tracking pixels. No "click here" CTAs. Links shown as plain URLs. |
| Volume cap | Inherits existing `email_sends` per-mailbox throttle. Warmup ramp from day 1 of first send. |

**Why it matters:** Outreach that looks automated gets filtered to spam by Gmail/Workspace, and gets a 1–3% reply rate. Outreach that looks like a real human one-off gets 10–25%. The persona, mailbox, and formatting choices above are all in service of looking like the latter.

---

## Locked decisions

| # | Decision | Notes |
|---|----------|-------|
| 1 | **One approval gate per prospect batch** | Molly picks 5, fetches editor contact, drafts pitch — operator approves all 5 in one screen. |
| 2 | **Top 5 per run** | Forces Molly to pick the best, keeps approval surface scannable. |
| 3 | **Friendly-peer pitch tone** | Personal, references a specific recent post on the target blog, no marketing buzzwords. |
| 4 | **DA 25–60 sweet spot** | Filter prospects to this range. <25 = link-farm risk, >60 = won't accept cold pitch from our footprint. Tunable later. |
| 5 | **Nudge cadence** | Every 3 business days, 24-day cutoff. Nudges on days 3, 6, 9, 12, 15, 18, 21 → mark `dormant` on day 24. |
| 6 | **Anchor-text distribution (portfolio-level)** | 50% branded · 25% naked URL · 15% generic · 10% partial-match. SEO Expert enforces. |
| 7 | **Escalation triggers** | If reply matches `pricing\|fee\|payment\|rate card\|cost\|how much\|sponsor\|reciprocal\|exchange\|swap` (regex first, then LLM confirmation), or anything legal-flavored — surface in operator inbox tab, **never auto-reply**. |
| 8 | **BCC graduation** | BCC Mike on first **20 outbound emails globally**, then auto-graduate to daily 7am digest. Manual un-graduate switch available. |
| 9 | **Pilot site** | `junk-removal-vegas`. Site has the most existing data (Namecheap domain, content, GA4), making it the cheapest place to measure Molly's behavior before fleet rollout. |
| 10 | **Molly persona** | Molly Chen, Sr. Outreach Manager, `molly@leadslandlord.com`. See *Molly — persona* above. |

---

## What already exists (reuse, don't rebuild)

| Component | Location | Status |
|-----------|----------|--------|
| `prospects` table + `prospect_status` enum | [`packages/db/src/schema.ts:209`](packages/db/src/schema.ts:209) | ✓ |
| `backlinks` table w/ guest_post status machine | [`packages/db/src/schema.ts:393`](packages/db/src/schema.ts:393) | ✓ |
| `outreach_events` (joined to prospects) | [`packages/db/src/schema.ts:236`](packages/db/src/schema.ts:236) | ✓ |
| `BacklinkBuilder` agent w/ citations\|haro\|guest_post modes | [`packages/agents/src/backlink-builder/index.ts`](packages/agents/src/backlink-builder/index.ts) | ✓ — extend, don't fork |
| Apollo editor lookup w/ 75/mo cap | `packages/integrations/src/apollo/` | ✓ |
| DataForSEO referring-domains intersection | [`packages/integrations/src/dataforseo/backlinks.ts`](packages/integrations/src/dataforseo/backlinks.ts) | ✓ |
| ComplianceGuard pre-send gate | `packages/agents/src/compliance-guard/index.ts` | ✓ |
| Zoho MCP send (commit `b325b1a`) | `packages/integrations/src/zoho-mcp/` | ✓ |
| Resend send fallback | `packages/integrations/src/resend/` | ✓ |
| `email_sends` per-mailbox throttle | `packages/db/src/schema.ts` | ✓ |
| Operator prospects review UI | [`apps/operator/app/operator/backlinks/prospects/page.tsx`](apps/operator/app/operator/backlinks/prospects/page.tsx) | ✓ — extend |
| Prospect-mode flow (DFS → Apollo → queue) | `BacklinkBuilder.prospect` mode | ✓ |

---

## What R4 builds

1. **Molly persona infrastructure** — mailbox setup, signature template, voice prompt, persona config.
2. **Molly-scorer agent** — per-run Haiku scoring pass that picks 5 best prospects and writes a one-sentence rationale per pick.
3. **Molly-inbox agent** — daily Zoho poll, per-thread Haiku classifier, drafted response, BCC graduation, escalation routing.
4. **`pending_post` state + Molly-Copywriter** — on `accept`, route to Sonnet for 1,000–1,500 word draft tuned to target blog's voice.
5. **SEO Expert pre-flight pass** — validates anchor text, keyword density, backlink position, no cannibalization with our `info_pages`. This is a slice of the larger R5 SEO Expert agent.
6. **Anchor-distribution ledger** — portfolio-level tracker that feeds SEO Expert's anchor-pick decision.
7. **Operator UI extensions** — top-5 review card, draft-review screen, inbox tab with escalation surface, Molly settings page.

---

## Phasing

### R4.0 — Architecture ADRs

**Owner:** `leadlandlord-architect`.

Produce three ADRs at `docs/adr/`:

1. **ADR-0005 — Molly persona over BaseAgent.** Should Molly be a separate agent class, or a persona layer on `BacklinkBuilder`? Trade-offs: persona = cheaper, no registry churn; separate class = clearer reply-loop boundary. Recommend persona layer for outbound (extend `BacklinkBuilder.guest_post`) + new `MollyInbox` agent for the reply loop (different cadence, different model, different state machine).
2. **ADR-0006 — Reply state machine.** Lock the states: `prospected → scored → flagged_top5 → approved → pitched → awaiting_reply → reply_received → classified → (accepted|declined|silent|escalated) → drafting → draft_approved → delivered → published → verified`. Document transitions, who/what triggers each, dead-letter rules.
3. **ADR-0007 — Anchor distribution policy.** Lock the 50/25/15/10 ratio, define "branded" vs "partial-match" enforceable rules, specify the portfolio-level ledger that drives SEO Expert's pick.

**Verification:** 3 ADR files committed, `next-engineer` can implement against them without re-asking.

---

### R4.1 — Mailbox + persona setup

**Owner:** `next-engineer` (with Mike doing the manual Namecheap/Zoho config).

- Mike configures Namecheap DNS to point `molly@leadslandlord.com` at a fresh Zoho mailbox (Zoho free tier covers 5 users — already in use).
- Add Zoho MCP credentials for the new mailbox to env (separate from Mike's personal `mike@`).
- New module `packages/agents/src/molly/persona.ts` — exports `MOLLY_PERSONA` constant with name, title, signature, voice-prompt system message, and a small few-shot example set.
- Update `BacklinkBuilder.guest_post` mode to compose emails as Molly: `From: Molly Chen <molly@leadslandlord.com>`, signed with persona signature, no marketing markup.
- Update `email_sends` writes to record `mailbox='molly@leadslandlord.com'` so throttle applies to Molly's sends in isolation.

**Verification:** test send from `BacklinkBuilder.guest_post` → email arrives in a test Gmail inbox, from `Molly Chen`, plain text, no spam-filter flags (manually verify primary tab placement).

---

### R4.2 — Molly-scorer (top-5 framing)

**Owner:** `next-engineer`.

- New agent `packages/agents/src/molly-scorer/index.ts`. Single Haiku call. Input: array of up to 20 prospects from `BacklinkBuilder.prospect` flow + tenant site context (niche, city, business name, niche-overlay markdown). Output: `{ top5: [{prospectId, rationale, score}], runnersUp: [...] }`.
- DA filter at ingest: drop prospects outside 25–60 *before* scoring (cheap filter, saves tokens).
- Score signals: niche relevance (string match against niche overlay), DA (DataForSEO `domain_rank`), guest-post receptivity (Firecrawl one page — `/write-for-us`, `/contact`, or about page — regex for `guest post|contribute|submission|write for us`).
- Schema: add `prospects.score` (decimal), `prospects.rationale` (text), `prospects.flagged_top5_at` (timestamptz nullable). Migration.
- Operator UI: add a "Molly's top 5" tab to [`/operator/backlinks/prospects`](apps/operator/app/operator/backlinks/prospects/page.tsx). Approve a top-5 card → status moves `new → approved`, fires `prospect.approved` event.

**Cost:** ~$0.001/run scoring. Firecrawl receptivity: ~$0.025/run (5 sites × ~$0.005). Total ~$0.03/run, 1 run per tenant per week initially.

**Verification:** run prospecting on `junk-removal-vegas`, Molly returns 5 picks with sensible rationales. Each has DA in 25–60 and a confidence-tagged editor email.

---

### R4.3 — Pitch send w/ approval gate + BCC graduation

**Owner:** `next-engineer`.

- Reuse existing `BacklinkBuilder.guest_post` mode for send (Molly persona applied from R4.1).
- New table `bcc_graduation`: `id`, `agent_name`, `outbound_count`, `graduated_at` (nullable), `manual_override` boolean. Single-row state machine; increments per send.
- Wire BCC on every outbound when `outbound_count < 20 AND graduated_at IS NULL`. Add Mike's email as `bcc` field on the Resend/Zoho call.
- After 20 sends with no operator intervention (= manually rejected/edited a drafted reply), set `graduated_at = now()`.
- Daily 7am MST digest email when graduated: sent/replied/escalated counts, per-site breakdown.
- Operator can manually toggle back (un-graduate) via a settings switch.
- New operator UI: "Molly settings" page (`/operator/molly`) — current count, graduation status, override toggle, BCC email override.

**Verification:** send 20 test pitches → 21st sends without BCC; daily digest email arrives at 7am MST with sent/replied/escalated counts.

---

### R4.4 — Molly-inbox (reply ingest loop)

**Owner:** `next-engineer`. Model: Haiku.

- New agent `packages/agents/src/molly-inbox/index.ts`.
- Cron: daily 7am MST via existing scheduler at `packages/agents/src/scheduler/`.
- Flow:
  1. Pull unread emails from `molly@leadslandlord.com` via Zoho MCP. Filter to threads whose `In-Reply-To` matches a tracked `backlinks.message_id` (new column).
  2. Per thread: Haiku call with prior thread + site/niche context → classification + suggested reply. Voice: same persona prompt as outbound, so replies sound consistent.
  3. Write `outreach_events` row (`event_type='reply_received'`), update `backlinks.status` per classification.
  4. **If escalation trigger fires** (compensation, legal, off-topic): stop here, surface in operator inbox tab. Do NOT auto-reply.
  5. **Else if `decline`:** auto-reply with thanks, mark `lost`, dead-letter.
  6. **Else if `needs_info`:** draft reply. If graduated → auto-send. If not graduated → queue for operator review (Mike approves in the inbox tab).
  7. **Else if `accept`:** emit `guest_post.accepted` event → kicks off R4.5 drafting flow.
- Escalation triggers (regex first, then LLM confirmation):
  - `\bpricing\b|\bfee\b|\bpayment\b|\b(rate|price)\s*(card|sheet)?\b`
  - `\b(reciproc|exchange|swap)\w*`
  - `\bsponsor\w*|\badvertis\w*`
  - `\b(legal|cease|desist|takedown|gdpr|ccpa)\w*`

**Cost:** ~$0.0005 per classified reply.

**Verification:** simulate three reply types (accept, decline, "what's your rate?") on a real thread; observe correct routing in operator inbox.

---

### R4.5 — Molly-Copywriter (draft on acceptance)

**Owner:** `next-engineer`. Model: Sonnet (quality matters here).

- New agent `packages/agents/src/molly-copywriter/index.ts`.
- Triggered by `guest_post.accepted` event.
- Inputs:
  - Target blog: recent posts via Firecrawl sitemap for voice/length calibration.
  - Tenant site context: niche, services, USP, niche-overlay markdown.
  - Gap analysis from SEO Expert (R4.6 — picks angle that fills target's coverage gap).
  - Target keyword + 2 LSI terms (from SEO Expert).
  - Anchor text (from SEO Expert, portfolio-aware).
- Output: 1,000–1,500 word draft as markdown, written in target blog's voice (Haiku pre-pass extracts voice signals from 3 recent posts), with backlink anchor planted naturally between paragraphs 3 and N–2 (NOT first/last 200 words).
- Stored in `backlinks.draft_markdown` (new column) + status moves to `drafting → draft_pending_review`.
- Operator UI: `/operator/backlinks/[id]/draft` — markdown preview, approve/edit/reject, anchor placement highlighted.

**Cost:** ~$0.08/draft (Sonnet).

**Verification:** send a fake "yes, send us the post" reply → draft appears at `/operator/backlinks/[id]/draft` within 5 minutes, anchor in body (not intro/outro), word count 1,000–1,500.

---

### R4.6 — SEO Expert pre-flight + portfolio anchor ledger

**Owner:** `next-engineer` + `leadlandlord-seo-auditor`.

- Slice of the larger R5 SEO Expert agent — build the pre-flight pass now since R4.5 depends on it.
- New module `packages/agents/src/seo-expert/anchor-policy.ts`.
- `pickAnchor(siteId)`: queries `backlinks` for `acquired_at IS NOT NULL`, computes current distribution across `branded|naked|generic|partial`, returns the bucket that maximally rebalances toward 50/25/15/10. Deterministic, no LLM call.
- `validateDraft(draft, anchor, targetKeyword, siteId)`: Haiku call. Returns `{ pass: boolean, issues: [...] }` checking:
  - Anchor reads natural in context (not bolt-on).
  - Anchor not in first/last 200 words.
  - Keyword density 0.5–1.5% (deterministic count + Haiku verdict on stuffing feel).
  - No cannibalization w/ tenant's existing `info_pages` (compare titles + first 200 words of each existing page).
- Wired as a gate before draft moves from `drafting → draft_pending_review`. If fail → re-prompt Copywriter once with issues; if fail again → flag for operator manual rewrite.

**Cost:** ~$0.002/pre-flight pass.

**Verification:** feed a draft with anchor in the intro → SEO Expert flags it, Copywriter retries, second pass passes.

---

### R4.7 — Delivery + publish verification

**Owner:** `next-engineer`.

- On `draft_approved`: Molly sends draft to target editor via Zoho MCP, includes a polite delivery note (persona-consistent) + the markdown body. Status → `delivered`.
- Maintenance check (weekly cron): for each `delivered` row older than 7 days, Firecrawl-search the target domain for the tenant's URL. If found → status `published`, persist `published_at` + live URL. After another 7 days, GSC API check that the link is indexed → status `verified`.
- Dead-letter: `delivered` rows older than 60 days without a hit → manual review surface.

**Verification:** deliver a draft, manually publish on a test blog under our control, see the watcher flip the row to `published` within 24h, then `verified` within 14 days.

---

### R4.8 — QA + smoke

**Owner:** `leadlandlord-qa`.

- Typecheck + build clean.
- Preview deploy: walk through prospect → top-5 → approve → send → simulated reply → draft → SEO pre-flight → operator approve → send.
- Verify daily digest email lands at 7am MST.
- Verify escalation surfaces ahead of any auto-reply (test with "what's your rate?" message).
- Verify BCC ungraduated for first 20 sends.
- Verify Molly's outbound emails land in primary inbox (not spam) on Gmail + Workspace + Outlook test addresses.
- Cost ledger: confirm per-prospect spend stays under $0.20 amortized across the full pipeline.

---

## Files (concrete, not exhaustive)

| File | Action |
|------|--------|
| `docs/adr/0005-molly-persona.md` | create |
| `docs/adr/0006-reply-state-machine.md` | create |
| `docs/adr/0007-anchor-distribution.md` | create |
| `packages/db/src/schema.ts` | extend: `prospects.score/rationale/flagged_top5_at`; `backlinks.message_id`, `draft_markdown`, `anchor_type`; new `bcc_graduation` table |
| `packages/db/migrations/00XX_r4_molly.sql` | new migration |
| `packages/agents/src/molly/persona.ts` | new — `MOLLY_PERSONA` constant |
| `packages/agents/src/molly-scorer/index.ts` | new |
| `packages/agents/src/molly-inbox/index.ts` | new |
| `packages/agents/src/molly-copywriter/index.ts` | new |
| `packages/agents/src/seo-expert/anchor-policy.ts` | new (slice of R5) |
| `packages/agents/src/seo-expert/draft-validator.ts` | new (slice of R5) |
| `packages/agents/src/backlink-builder/index.ts` | extend `guest_post` mode to use `MOLLY_PERSONA` for From/signature/voice |
| `packages/agents/src/registry.ts` | register molly-scorer, molly-inbox, molly-copywriter |
| `packages/agents/src/scheduler/molly-inbox.ts` | new — daily cron |
| `packages/integrations/src/firecrawl/` | new — wrap Firecrawl MCP for sitemap + receptivity scrape |
| `packages/integrations/src/zoho-mcp/` | extend to support per-mailbox credentials (Molly vs Mike) |
| `apps/operator/app/operator/backlinks/prospects/page.tsx` | extend: "Molly's top 5" tab |
| `apps/operator/app/operator/backlinks/[id]/draft/page.tsx` | new — draft review |
| `apps/operator/app/operator/backlinks/inbox/page.tsx` | new — reply/escalation surface |
| `apps/operator/app/operator/molly/page.tsx` | new — settings, BCC graduation status, persona preview |

---

## Cost ceiling

Per **successful** backlink (prospect → top-5 → approve → send → accept → draft → SEO pass → deliver → publish):

| Step | Cost |
|------|------|
| Molly-scorer | $0.001 |
| Firecrawl receptivity | $0.005 |
| Apollo editor lookup | ~$0.07 (75/mo cap → ~$5/mo budget) |
| Pitch generation | $0.001 |
| Inbox classification (~3 replies) | $0.002 |
| Copywriter draft (Sonnet) | $0.08 |
| SEO pre-flight | $0.002 |
| Maintenance checks | $0.001 |
| **Total** | **~$0.16 per successful backlink** |

Per prospect that goes nowhere: ~$0.08 (mostly Apollo).

---

## Out of scope (R4)

| Item | Why deferred |
|------|--------------|
| **HARO / Connectively integration** | Deferred until we have real tenants with real experts. Pretending to be a domain expert across niches we host doesn't sit well; better fit is v2 where tenants respond as themselves with Molly drafting. |
| **Citation autopilot (R4a)** | Existing `BacklinkBuilder.citations` mode already works. Schedule on a cron in a follow-up phase. |
| **Auto-procurement via paid networks** | Authority Builders, etc. — defer until organic flow proves cost-effective. |
| **Multi-site portfolio coordination** | Don't pitch same target from two tenants simultaneously — use simple `source_domain` uniqueness check for now; smarter logic later. |
| **Fleet rollout beyond pilot** | R4 ships against `junk-removal-vegas` only. Decision to expand happens after 4 weeks of pilot data. |

---

## Verification gates (full phase)

- ✅ 3 ADRs committed and reviewed.
- ✅ `molly@leadslandlord.com` mailbox live, test send from `BacklinkBuilder.guest_post` lands in Gmail primary tab.
- ✅ Molly returns 5 sensibly-scored picks for `junk-removal-vegas`.
- ✅ Single-screen approval flow works: 5 cards → approve all → 5 emails sent.
- ✅ BCC on first 20 outbound; daily digest replaces BCC on send #21.
- ✅ Simulated `compensation_request` reply lands in escalation tab, no auto-reply fires.
- ✅ Simulated `accept` reply produces an SEO-validated draft within 5 minutes.
- ✅ Anchor distribution across first 20 delivered posts is within ±5% of 50/25/15/10.
- ✅ One full success path: prospect → publish → verify, end-to-end on a controllable test target.
- ✅ Total spend across that full path < $0.20.
- ✅ `pnpm build` clean; `pnpm typecheck` clean; preview deploy QA passes.

---

## Orchestration sequence

1. **`leadlandlord-architect`** reads this handoff, writes ADR-0005 / ADR-0006 / ADR-0007. Halt for Mike's review.
2. **Mike** approves ADRs (or kicks back for edits).
3. **`next-engineer`** works R4.1 → R4.7 sequentially. Each phase opens its own PR + QA gate.
4. **`leadlandlord-seo-auditor`** validates R4.6 anchor-policy and draft-validator logic against SEO best practices.
5. **`leadlandlord-qa`** runs R4.8 full smoke before R4 is declared done.
6. **Pilot watch:** 4 weeks of `junk-removal-vegas` data → decide on fleet rollout.

---

## For the executing agent

You are picking this up cold. Before writing any code:

1. Read this entire doc, then read [`/Users/mikebayard/.claude/plans/let-s-take-a-big-compiled-sifakis.md`](/Users/mikebayard/.claude/plans/let-s-take-a-big-compiled-sifakis.md) §R4 for the strategic context.
2. Read [`packages/agents/src/backlink-builder/index.ts`](packages/agents/src/backlink-builder/index.ts) and [`packages/db/src/schema.ts`](packages/db/src/schema.ts) §prospects, §backlinks, §outreach_events to understand what already works.
3. Read [`apps/operator/app/operator/backlinks/prospects/page.tsx`](apps/operator/app/operator/backlinks/prospects/page.tsx) to understand the current operator surface.
4. Start with R4.0 — produce the three ADRs and stop. Do not implement against unwritten ADRs.

If anything in this doc seems wrong or contradicts what you find in the codebase, flag it to Mike before proceeding. Do not assume the doc is right and the code is stale, or vice versa.
