# ADR-0005 — Molly Persona Layer over BacklinkBuilder + MollyInbox as a Separate Agent

**Date:** 2026-05-11
**Status:** Accepted
**Deciders:** leadlandlord-architect
**Context source:** HANDOFF-R4-BACKLINKS.md §R4.0, §R4.1, §R4.4

---

## Context

R4 ships a semi-autonomous guest-post pipeline embodied by a public-facing persona —
Molly Matthews, Sr. Outreach Manager, molly@leadslandlord.com. Two distinct runtime
behaviors need a home in the agent system:

1. **Outbound path** — draft and send a pitch email (or queue it for operator approval)
   for a given target domain. This is exactly what `BacklinkBuilder.guest_post` already
   does. The only gap is identity: emails currently go from a generic mailbox, signed as
   a niche-team generic, prompted without persona voice.

2. **Inbox path** — daily poll of molly@leadslandlord.com, per-thread classification,
   suggested reply drafting, escalation routing, and nudge scheduling. This does not
   exist anywhere in the codebase.

The question is how to structure these: as a single combined agent, as two separate
agents, or as a persona layer applied atop existing infrastructure.

Three options were evaluated.

**Option A — New `MollyAgent` monolith.** One agent class with two modes (outbound,
inbox), registered as `molly`. Combines both state machines and both cron triggers.

**Option B — Persona layer on `BacklinkBuilder.guest_post` + new `MollyInbox` agent.**
Outbound behavior stays in `BacklinkBuilder`, which gains a `MOLLY_PERSONA` import that
rewrites the From address, signature, and voice prompt. Inbox behavior is a new
standalone agent. (Chosen.)

**Option C — Fork `BacklinkBuilder` into `GuestPostAgent`.** Full copy of the agent,
modified for Molly. The existing `BacklinkBuilder` continues to handle citations and
HARO.

---

## Decision

**Option B: persona module on `BacklinkBuilder.guest_post`, plus a new `MollyInbox`
agent.**

### Rationale: why outbound is a persona layer, not a new agent

`BacklinkBuilder.guest_post` already owns the complete outbound path: compliance gate,
Zoho/Resend send dispatch, `email_sends` throttle, `backlinks` row write,
`onConflictDoNothing` dedupe, budget tracking via `BaseAgent.run()` /
`BaseAgent.creditBudget()`, and `dedupeKeyFn` keyed on `guest_post:${siteId}:${domain}`.
Re-implementing any of this in a new agent adds surface area for bugs to diverge.

The *only* delta for Molly is: From address, display name, signature block, and voice
system prompt. These are inputs to `draftGuestPostEmail()`, not structural changes.
Extracting them into `packages/agents/src/molly/persona.ts` as a `MOLLY_PERSONA`
constant is an additive, zero-regression change. `BacklinkBuilder` imports the constant;
callers that set `mode: 'guest_post'` automatically get Molly's voice without any
registry or cron changes.

Forking (Option C) would require maintaining two copies of the send loop, compliance
gate, and throttle logic indefinitely — not worth it.

### Rationale: why inbox is a separate agent

Inbox and outbound differ on every axis that matters for agent scoping:

| Dimension | `BacklinkBuilder.guest_post` | `MollyInbox` |
|---|---|---|
| Trigger | On-demand / per-prospect event | Daily cron, 7am MST |
| Primary model | `claude-haiku-4-5` (pitch draft) | `claude-haiku-4-5` (classification) |
| State machine | prospect→pitch→submitted | reply_received→classified→(accepted\|declined\|silent\|escalated) |
| Writes | `backlinks` row, `email_sends` | `backlinks` status update, `outreach_events` reply row |
| Budgets | $5/day default (pitch volume) | $1/day default (classification only) |
| Dedupe | per (site, domain) | per (backlinks.id, message_id) |

Combining them into one agent class would require `BacklinkBuilder` to hold Zoho inbox
polling logic (a new integration dependency) and daily-cron scheduling context, which
violates its single responsibility. More concretely: the cron route at
`apps/operator/app/api/cron/agent/[name]` dispatches by registry name; if outbound
and inbox share a class, two different cron entries pointing at the same agent name
would need discriminating `mode` payloads, and that pattern already exists in
`BacklinkBuilder` — adding a third mode here extends a class that is already at
reasonable size rather than extending it further.

`MollyInbox` is a focused agent: poll → classify → branch. Its daily cadence and
different budget profile warrant a separate registry entry and a separate scheduler
module (`packages/agents/src/scheduler/molly-inbox.ts`), consistent with how
`outreach-agent`, `billing-dunning`, and `maintenance` each have their own scheduler
files.

### Persona module shape

`packages/agents/src/molly/persona.ts` exports a single `MOLLY_PERSONA` constant.
No class, no runtime behavior — pure data.

```typescript
export interface MollyPersona {
  name: string;           // "Molly Matthews"
  title: string;          // "Sr. Outreach Manager"
  mailbox: string;        // "molly@leadslandlord.com"
  displayName: string;    // "Molly Matthews"
  signatureLine: string;  // "Molly Matthews · Sr. Outreach Manager · LeadLandlord"
  voiceSystemPrompt: string;   // full system message injected before every draft
  fewShot: Array<{
    userMsg: string;    // example scenario
    assistantMsg: string; // ideal Molly-voiced response
  }>;
}

export const MOLLY_PERSONA: MollyPersona = { ... };
```

The `voiceSystemPrompt` encodes the tone rules: friendly-peer, reference a specific
recent post on the target blog, no marketing buzzwords, plain text only, no tracking
pixels. The `fewShot` array provides two to three examples covering: initial pitch,
first follow-up nudge, polite decline acknowledgement. These examples are the primary
levers for voice consistency across pitch, nudge, and draft-delivery emails.

`BacklinkBuilder` consumes `MOLLY_PERSONA` in `draftGuestPostEmail()` by prepending
the system prompt and injecting the signature into the prompt constraints. The `from`
field on `sendEmailZoho()` / `sendEmailResend()` switches from the generic env var to
`MOLLY_PERSONA.mailbox` when `ZOHO_MOLLY_ENABLED=true` (separate from
`ZOHO_MCP_ENABLED`). The per-mailbox throttle in `email_sends` already keys on the
`mailbox` column, so Molly's sends are isolated from any other mailbox automatically.

`MollyInbox` also imports `MOLLY_PERSONA` to inject the same voice prompt when drafting
suggested replies, so pitch and reply land in the same register.

### Registry implications

`MollyInbox` registers as `'molly-inbox'` in `packages/agents/src/registry.ts` via the
standard factory pattern already used by all 21 existing agents. `MollyScorer` registers
as `'molly-scorer'`. `MollyCopywriter` registers as `'molly-copywriter'`. None of these
entries require structural changes to the registry — they follow the existing
`'agent-name': () => new AgentClass()` pattern.

`BacklinkBuilder` does not get a new registry entry; it is already registered as
`'backlink-builder'`.

The `guest_post` dedupeKeyFn in `BacklinkBuilder` is unchanged: `guest_post:${siteId}:${domain}`.
Molly's persona does not affect idempotency semantics — a re-run for the same (site,
domain) pair still short-circuits via `findExistingSuccess()`.

---

## Alternatives considered

**Option A (monolith):** rejected. A single `MollyAgent` class holding inbox polling,
outbound pitch drafting, compliance gating, Zoho send dispatch, and reply classification
would be a 600+ line class violating single responsibility. Daily cron and on-demand
triggers would require mode-switch logic in the dispatcher. Budget and dedupe semantics
for outbound and inbox are genuinely different and would fight inside one class.

**Option C (fork):** rejected. Citations and HARO modes in `BacklinkBuilder` are
unrelated to Molly but would be orphaned in the forked class. The compliance gate,
throttle, and send loop would duplicate. Any fix to the send path would need to land
in two places. Net cost: higher maintenance burden, no benefit over the persona layer.

---

## Consequences

- `BacklinkBuilder` gains one new import (`MOLLY_PERSONA`) and two new branches in
  `draftGuestPostEmail()` (system prompt injection, mailbox override). All existing
  modes and tests remain valid.
- `packages/agents/src/molly/persona.ts` is a new file with no dependencies beyond
  TypeScript types. It is the single source of truth for Molly's identity; changing
  her voice requires editing one file.
- `MollyInbox`, `MollyScorer`, and `MollyCopywriter` are new agents that follow the
  existing `BaseAgent` contract exactly: constructor with `name` / `inputSchema` /
  `outputSchema` / `dedupeKeyFn` / `defaultDailyCapUsd`, and `protected execute()`.
  No new BaseAgent APIs are needed.
- The `ZOHO_MOLLY_ENABLED` env flag and separate Zoho credentials for
  `molly@leadslandlord.com` are required before R4.1 can be verified. If the flag
  is absent, `BacklinkBuilder.guest_post` falls back to its current generic-mailbox
  behavior — no breakage.
- BCC graduation state (`bcc_graduation` table, R4.3) is read by `BacklinkBuilder`
  when composing the send call, not by `MollyInbox`. Inbox replies are never BCC'd —
  that would surface draft reply content to Mike before classification is complete.

---

## Open questions / for next-engineer

- Exact env var name for Molly's Zoho credentials: suggest `ZOHO_MOLLY_FROM`,
  `ZOHO_MOLLY_CLIENT_ID`, `ZOHO_MOLLY_CLIENT_SECRET`, `ZOHO_MOLLY_REFRESH_TOKEN` —
  confirm with Mike before wiring.
- `fewShot` examples in `MOLLY_PERSONA` need real content drafted by Mike or a
  copywriter before R4.1 verification. Placeholder strings will pass typecheck but
  produce worse output.
- `MollyInbox.dedupeKeyFn`: suggested key is `molly-inbox:${backlinkId}:${messageId}`.
  `messageId` comes from the Zoho `Message-ID` header stored in `backlinks.message_id`
  (new column — see ADR-0006). Confirm the Zoho MCP surfaces the raw `Message-ID`
  header before implementing.
- Daily cron timing: "7am MST" must be expressed as UTC in the Vercel cron config
  (`0 14 * * *` in standard time, `0 13 * * *` in daylight time). Decide whether to
  pin to UTC or accept the one-hour seasonal drift. Existing schedulers do not handle
  DST — recommend pinning to `0 14 * * *` year-round.
