# Go-live runbook: inbound AI call qualification (ADR 0031)

Checklist for taking the merged AI call qualification feature (PR #254, migration `0066_call_qualification`) from "code deployed" to "live and usable per site." Cross-references [ADR 0031](./adr/0031-inbound-ai-call-qualification.md).

Nothing here activates a site by itself: `sites.call_mode` defaults to `'off'` and only flips per-site via the operator's `CallModeSelector` (Phase E), so it's safe to work through this list incrementally.

## 1. Apply migration `0066_call_qualification` to production

Sanctioned path only — never ad-hoc SQL (see `docs/HANDOFF-NICHE-SCORING.md`).

```bash
pnpm db:migrate
```

If it errors with "already exists" (duplicate objects from partially-applied prior runs), fall back to the statement-by-statement recovery path, which tolerates collisions and back-fills the ledger:

```bash
pnpm db:migrate-recover
```

**Verification queries (run against prod):**

```sql
-- call_mode column exists on sites, default 'off'
SELECT column_name, column_default, is_nullable
FROM information_schema.columns
WHERE table_name = 'sites' AND column_name = 'call_mode';

-- calls table has the new qualification columns
SELECT column_name FROM information_schema.columns
WHERE table_name = 'calls'
  AND column_name IN (
    'elevenlabs_conversation_id', 'answered_by', 'qualification_score',
    'qualification_intent', 'qualification_urgency', 'qualification_job_type',
    'qualification_budget_band', 'qualification_address',
    'tenant_sms_status', 'tenant_email_status'
  );

-- exactly one default (niche IS NULL) qualification script row
SELECT count(*) FROM call_qualification_scripts WHERE niche IS NULL;
-- expect: 1

-- nothing activated yet — the safety gate
SELECT count(*) FROM sites WHERE call_mode <> 'off';
-- expect: 0
```

**Status:** run by Claude session — date/result: `[FILL IN]`, migrate path used: `[db:migrate | db:migrate-recover]`, verification query results: `[FILL IN]`.

## 2. Create/update the shared ElevenLabs agent

This step must run **locally by Mike** — `elevenlabs.io` is blocked from the Claude Code sandbox.

```bash
# Dry run first — prints the exact request without sending it.
pnpm tsx scripts/elevenlabs-setup.ts --operator-host <operator-host> --dry-run

# Then for real (requires ELEVENLABS_API_KEY in .env.local; set ELEVENLABS_AGENT_ID
# in .env.local first if you're updating an existing agent instead of creating one).
pnpm tsx scripts/elevenlabs-setup.ts --operator-host <operator-host>
```

Replace `<operator-host>` with the real operator host (e.g. `leadlandlord-operator.vercel.app`, or `leadlandlord.com` once R2's apex cutover is live — see `docs/r2-setup-runbook.md`).

The script prints:
- `ELEVENLABS_AGENT_ID=...` (copy this for step 3)
- The post-call webhook URL: `https://<operator-host>/api/webhooks/elevenlabs/post-call`
- A numbered list of remaining manual dashboard steps — do them now:
  1. Enable the workspace **Post-call transcription** webhook, pointed at the URL above.
  2. Copy that webhook's HMAC signing secret → save as `ELEVENLABS_WEBHOOK_SECRET` for step 3.
  3. If using warm transfer, open the agent in the dashboard and verify the `transfer_to_number` tool appears, targeting the `{{transfer_number}}` dynamic variable.

## 3. Set Vercel env vars (leadlandlord-operator project) and redeploy

Generate a fresh recording-link signing secret — **do not reuse `OPERATOR_SESSION_SECRET`**:

```bash
openssl rand -hex 32
```

Then push env vars:

```bash
vercel link   # if not already linked to leadlandlord-operator
vercel env add ELEVENLABS_API_KEY production
vercel env add ELEVENLABS_AGENT_ID production
vercel env add ELEVENLABS_VOICE_ID production
vercel env add ELEVENLABS_WEBHOOK_SECRET production
vercel env add TENANT_RECORDING_SECRET production
# optional — only if closer-agent-style outbound bridging is in use:
vercel env add ELEVENLABS_PHONE_NUMBER_ID production
```

Redeploy so the new env vars take effect:

```bash
vercel --prod
```

(Or trigger a redeploy from the Vercel dashboard for `leadlandlord-operator`.)

## 4. Post-deploy verification

```bash
curl -X POST https://<operator-host>/api/webhooks/elevenlabs/post-call \
  -H 'content-type: application/json' \
  -d '{}'
```

Expect **401** (unsigned request rejected — `ELEVENLABS_WEBHOOK_SECRET` is enforced).

Also confirm the operator site detail page (`/operator/sites/[id]`) renders the **Call mode** selector (off / ai_first / fallback).

## 5. Smoke test (per ADR 0031)

Do this with **one low-traffic site** before trusting the feature broadly:

1. Set that site's `call_mode` to `fallback` in the operator UI.
2. Place a test call to the site's tracking number and let it ring out (don't answer as the tenant).
3. Confirm the AI agent picks up on no-answer and runs the qualification script.
4. Confirm the tenant receives both:
   - An SMS summary
   - An email with the summary, transcript excerpt, and a working recording link (`/api/tenant-recordings/[callId]`, valid for 7 days)
5. Once that's confirmed, flip the same site to `ai_first` and place another test call — verify the AI answers immediately, and (if `forwarding_number` is set) that a qualified inquiry successfully warm-transfers to the tenant via the `transfer_to_number` tool.
6. Only after both modes are confirmed working on the pilot site, roll `call_mode` out to additional sites.

## Reference

- Schema: `packages/db/migrations/0066_call_qualification.sql`
- Dynamic-variable contract + inbound handoff: `apps/operator/lib/twilio-voice.ts` (`aiQualificationResponseForSite`)
- ElevenLabs client + webhook verification: `packages/integrations/src/elevenlabs/index.ts`
- Post-call webhook route: `apps/operator/app/api/webhooks/elevenlabs/post-call`
- Tenant recording proxy: `apps/operator/app/api/tenant-recordings/[callId]/route.ts`
- Setup script: `scripts/elevenlabs-setup.ts`
- Architecture decision: `docs/adr/0031-inbound-ai-call-qualification.md`
