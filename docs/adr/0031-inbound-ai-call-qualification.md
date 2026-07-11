# ADR 0031: Inbound AI call qualification via ElevenLabs

Date: 2026-07-11
Status: accepted
Extends the inbound telephony pipeline (Twilio voice webhook, call classification) and the
tenant notification surface.

## Context

Inbound calls to a site's tracking number either forward directly to the tenant or fall to
voicemail. Missed and unscreened calls are lost or low-context leads. Mike wants a
full-featured lead qualification system: an AI voice agent answers, asks a niche-specific
question script, then the tenant receives an SMS summary and an email with the summary and
call recording, with the structured qualification attached to the call record. It must be
enable/disable-able per site.

## Decision

1. **Bridging** — our Twilio voice webhook stays the single entry point (signature
   verification, `calls` row insert, spam throttle all preserved). When AI should answer, the
   webhook calls ElevenLabs' `POST /v1/convai/twilio/register-call` — the documented
   "bring-your-own-Twilio" endpoint — passing per-call
   `conversation_initiation_client_data.dynamic_variables`, and returns the TwiML ElevenLabs
   hands back. No conversation-initiation callback webhook is needed: context injection is
   synchronous inside our own webhook, where the site row is already loaded.
2. **One shared ElevenLabs agent** for the whole fleet, varied per call via flat dynamic
   variables (`niche`, `city`, `state`, `business_name`, `question_script`, `caller_number`,
   `caller_name`, `transfer_number`, `warm_transfer_enabled`) — not per-site agents.
   Question scripts live in a new `call_qualification_scripts` table keyed by niche, with a
   `niche IS NULL` default row (seeded in migration 0066). No branching DSL: a flat question
   list rendered into the prompt; the conversational model handles the branching.
3. **Per-site setting is a mode enum** — `sites.call_mode: off | ai_first | fallback`,
   default `off` (the safety gate; enabling is an explicit operator action per site).
   `ai_first`: AI answers everything and warm-transfers qualified callers to the tenant via
   ElevenLabs' `transfer_to_number` system tool (native-Twilio path supports `agent_message`
   tenant briefing). `fallback`: tenant's phone rings first; AI replaces voicemail on
   no-answer/busy. Spam-throttled callers are diverted to voicemail in every mode.
4. **New `LeadQualifier` BaseAgent** — not an extension of `CallClassifier`, whose enum
   contract feeds the operator UI, trials, and portfolio-analyst. LeadQualifier emits the
   same classification enum plus qualification fields (score 0-100, intent, urgency, job
   type, budget band, address) in one LLM call. AI-answered calls use LeadQualifier;
   human-forwarded calls keep CallClassifier unchanged.
5. **Post-call pipeline** — new HMAC-verified route
   `apps/operator/app/api/webhooks/elevenlabs/post-call` mirrors the transcription webhook:
   synchronous signature check + correlation (Twilio CallSid, fallback
   `elevenlabs_conversation_id`) + idempotent transcript persist; `after()` runs
   LeadQualifier then tenant delivery. Unmatched webhooks return 200 `{ignored:true}`.
6. **Tenant delivery** — SMS summary plus email with summary, transcript excerpt, and a
   **7-day HMAC-signed recording link** served by a new tenant-scoped proxy
   (`/api/tenant-recordings/[callId]`), distinct from the operator-session-gated proxy.
   Per-channel statuses on `calls.tenant_sms_status` / `tenant_email_status`
   (`sent|skipped|failed`), skip-not-error when the tenant lacks phone/email.

## Alternatives considered

- **Import numbers into ElevenLabs / point VoiceUrl at ElevenLabs** — loses signature
  verification, the `calls` row, and the spam throttle. Rejected.
- **Self-hosted Twilio Media Streams ↔ ElevenLabs WS bridge** — long-lived websocket
  process; does not fit Vercel serverless. Rejected.
- **Per-site ElevenLabs agents** — vendor-object sprawl, provisioning drift, no single place
  to iterate on qualification quality. Rejected.
- **Recording as Resend email attachment** — ~40MB cap vs. long calls; link is reliable at
  the tail. Rejected.
- **Extending CallClassifier** — would couple qualification churn to a load-bearing enum
  contract. Rejected.
- **Live listen + barge-in for tenants** (hear the AI conversation in real time, join it) —
  feasible only by routing the caller↔AI leg through a Twilio `<Conference>` with the
  ElevenLabs agent joined as a SIP participant and the tenant dialing in as coach (muted) or
  barge (unmuted). Deferred as a fast-follow: it reshapes the media path and adds latency +
  conference cost to every AI call; warm transfer covers the "get the human in live" need.

## Consequences

- New vendor webhook surface (ElevenLabs post-call, HMAC-verified via
  `ELEVENLABS_WEBHOOK_SECRET`) and a new unauthenticated-but-signed tenant recording proxy.
- `calls` grows first-class queryable qualification columns; `answered_by` distinguishes
  AI-answered from human-forwarded calls for reporting.
- One-time manual setup in the ElevenLabs dashboard (see below); the register-call request/
  post-call payload shapes were verified against current docs but not against a live
  account — capture one real webhook before flipping any site off `off`.
- Warm transfer relies on the `transfer_to_number` system tool with a dynamic-variable
  transfer number; verify tool config on the live agent during setup.
- ElevenLabs per-minute conversation cost applies to every AI-answered call; start rollout
  per-site with `fallback` mode (missed calls only) before trusting `ai_first`.

## One-time ElevenLabs setup (manual)

1. Create one Conversational AI agent in the ElevenLabs dashboard. Prompt template must
   reference the dynamic variables listed in Decision 2 and instruct: greet as
   `{{business_name}}`, ask `{{question_script}}`, then if `{{warm_transfer_enabled}}` is
   'true' transfer to `{{transfer_number}}` (enable the `transfer_to_number` system tool with
   an `agent_message` briefing), otherwise close politely.
2. Enable the post-call transcription webhook pointed at
   `https://<operator-host>/api/webhooks/elevenlabs/post-call`; store the signing secret as
   `ELEVENLABS_WEBHOOK_SECRET`.
3. Set `ELEVENLABS_API_KEY` and `ELEVENLABS_AGENT_ID` (see `.env.example`).
4. Smoke test per the plan: one low-traffic site → `fallback`, ring-out, talk to the agent,
   confirm SMS/email + recording link; then `ai_first` + warm transfer.
