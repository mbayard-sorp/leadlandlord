# Zoho Mail MCP Integration — Implementation Plan

**Goal:** Replace Resend with Zoho Mail (via Zoho's hosted MCP server) for persona-based outbound email from autonomous agents. Mailbox: `molly@leadslandlord.com`. Resend stays for system/operator mail.

**Status:** Plan only. User is provisioning Zoho MCP server + OAuth self-client. Build phases run after env vars are populated.

---

## Phase 0 — Documentation & Contract Discovery (✅ done; gaps flagged below)

### Confirmed facts (with sources)

**MCP transport:** Streamable HTTP, JSON-RPC 2.0. Single endpoint, POST with body, optional SSE response. Session header `MCP-Session-Id` returned from `initialize` and required on subsequent calls. Spec version header `MCP-Protocol-Version: 2025-11-25`. ([MCP spec](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports))

**Zoho MCP URL:** Generated per-server in Zoho MCP console; not predictable. Must be captured at provision time and stored in `ZOHO_MCP_URL`. ([Zoho MCP help](https://help.zoho.com/portal/en/kb/mcp/getting-started/articles/zoho-mcp-help-documentation-29-9-2025))

**Auth header on MCP endpoint:** Likely `Authorization: Bearer <access_token>` (Zoho MCP uses OAuth 2.1). Legacy direct-API header `Zoho-oauthtoken <token>` is for the REST API, not the MCP wrapper. **Verification step in Phase 1.** Implementation should try Bearer first and fall back to `Zoho-oauthtoken` on 401.

**OAuth refresh endpoint (US DC):** `https://accounts.zoho.com/oauth/v2/token`, POST form-encoded with `refresh_token`, `client_id`, `client_secret`, `grant_type=refresh_token`. Access token TTL 3600s. Refresh tokens never expire. ([Zoho OAuth self-client](https://www.zoho.com/accounts/protocol/oauth/self-client/authorization-code-flow.html))

**Mail-send scope:** `ZohoMail.messages.CREATE`. Comma-separated when multiple. ([Zoho Mail send API](https://www.zoho.com/mail/help/api/post-send-an-email.html))

**Multi-DC:** OAuth host varies by region (`accounts.zoho.com` US, `.eu`, `.in`, etc.). Make `ZOHO_ACCOUNTS_HOST` configurable; default US. The MCP URL itself encodes its DC. ([Zoho multi-DC](https://www.zoho.com/accounts/protocol/oauth/multi-dc.html))

**SDK choice:** Use `@modelcontextprotocol/sdk` with `StreamableHTTPClientTransport` + `Client`. Handles initialize handshake, session ID, SSE fallback. Hand-rolled `fetch` works but reinvents lifecycle; SDK is the safer call. ([npm](https://www.npmjs.com/package/@modelcontextprotocol/sdk))

### Confirmed at provision time (2026-05-09)

- **Auth mode:** "Authorization via Connection" (singular Native Connection authorized as molly@leadslandlord.com). NOT per-user OAuth. The MCP server holds Molly's creds internally and authorizes every tool call against them.
- **Server URL pattern:** `https://molly-leadslandlord-agent-923664408.zohomcp.com/mcp/<API_KEY>/message` — **the credential is embedded in the URL path**. No `Authorization` header required.
- **No OAuth env vars needed.** Single secret: `ZOHO_MCP_URL` (the full URL with embedded key).
- **Transport:** Stateless one-shot JSON-RPC over POST. **No `initialize` handshake required**, no session id. Plain `fetch` works.
- **Confirmed via Phase 1 discovery (2026-05-09):**
  - Tool name: **`ZohoMail_sendEmail`** (Zoho prefixes all tools with `ZohoMail_`).
  - Total tools exposed: 34 (all in the Message group).
  - **Argument shape (nested):**
    ```json
    {
      "body": {
        "fromAddress": "molly@leadslandlord.com",
        "toAddress": "recipient@example.com",
        "subject": "...",
        "content": "...",
        "mailFormat": "html" | "plaintext",
        "ccAddress": "...",        // optional, single string (not array)
        "bccAddress": "...",       // optional, single string (not array)
        "askReceipt": "yes" | "no",
        "encoding": "UTF-8",       // default
        "isSchedule": false,
        "attachments": [...]       // optional
      },
      "path_variables": {
        "accountId": "<zoho account id>"   // REQUIRED — Zoho Mail's internal account id for Molly
      }
    }
    ```
  - **Schema-required fields:** `body.fromAddress`, `body.toAddress`, `path_variables.accountId`. (`subject` and `content` not schema-required but functionally mandatory.)
  - Note: `ccAddress` / `bccAddress` are single strings, NOT arrays. If the Resend `cc: string[]` shape needs to map, comma-join.
- **`ZOHO_ACCOUNT_ID` env var added** — required path variable for every send. Fetched once from Zoho Mail Settings (or via the Account tool group temporarily enabled).

### Gaps still requiring runtime verification (Phase 1)

1. **`sendEmail` input schema** — exact argument names. Likely mirror Zoho REST (`fromAddress`, `toAddress`, `subject`, `content`, `mailFormat`, `ccAddress`, `bccAddress`) but the MCP wrapper may rename. Confirm via `tools/list`.
2. **Auth header on the MCP endpoint** — with "Authorization via Connection" mode, may be no Bearer at all (URL itself is the credential), or may still require an MCP-issued client token. Inspect the `Connect` tab output.
3. **MCP-Session-Id handshake** — confirm Zoho's server requires the MCP `initialize` → `notifications/initialized` → `tools/call` lifecycle, or if it accepts stateless one-shots.

### Existing-code anchor points (verified)

- `sendEmail` signature to mirror: `packages/integrations/src/resend/index.ts:9-29`
- Env schema: `packages/shared/src/env.ts:23-24` (Resend pattern), consumed via `EnvSchema.safeParse(process.env)` in `getEnv()` line 88, plus loose path `getEnvLoose()` lines 101-134
- DB schema dialect: drizzle-orm pg-core; timestamp pattern `timestamp(..., { withTimezone: true }).notNull().defaultNow()`; partial unique index pattern at `packages/db/src/schema.ts` `backlinks_dedupe_key_uniq` (lines 410-412); migrations at `packages/db/migrations/` numbered sequentially
- Test framework: vitest. Mock pattern at `packages/agents/src/backlink-builder/index.test.ts:92-94`
- Send call sites to swap:
  - `packages/agents/src/backlink-builder/index.ts:339-355` (guest_post)
  - `packages/agents/src/outreach-agent/index.ts:198-205` (email_day_1)
- Hardcoded postal addresses to env-ize:
  - `packages/agents/src/backlink-builder/index.ts:449` ("PO Box 0000")
  - `packages/agents/src/backlink-builder/index.ts:496` (fallback path)
  - `packages/agents/src/outreach-agent/index.ts:330` ("PO Box (replace)")
  - Test fixture `packages/agents/src/backlink-builder/index.test.ts:107` (update if string changes)
- Cron entry point: `apps/operator/app/api/cron/agent/[name]/route.ts` (no changes needed — agent dispatch is unchanged)

---

## Phase 1 — Discovery against the provisioned MCP server

**Precondition:** User has provisioned the Zoho MCP server, set up `molly@leadslandlord.com`, generated OAuth self-client credentials, and populated env vars in Vercel preview environment.

### Tasks

1. **Add env var schema** to `packages/shared/src/env.ts` (additive; mirror Resend pattern lines 23-24):
   ```ts
   ZOHO_MCP_URL: z.string().url().optional(),
   ZOHO_ACCOUNT_ID: z.string().optional(),
   ZOHO_DEFAULT_FROM: z.string().email().optional(),
   LEADLANDLORD_POSTAL_ADDRESS: z.string().optional(),
   ZOHO_DAILY_SEND_CAP: z.coerce.number().int().positive().default(50),
   ZOHO_WARMUP_SCHEDULE_JSON: z.string().optional(),
   ZOHO_MCP_ENABLED: z.coerce.boolean().default(false),
   ```
   Add corresponding entries in `getEnvLoose()` (lines 114-115 area) and `.env.example`.

2. **Write a one-shot discovery script** `scripts/zoho-mcp-discover.ts` that:
   - Mints an access token from `ZOHO_ACCOUNTS_HOST/oauth/v2/token`.
   - Connects to `ZOHO_MCP_URL` via `StreamableHTTPClientTransport` from `@modelcontextprotocol/sdk`.
   - Calls `client.listTools()`.
   - Pretty-prints every tool name + JSON Schema for `inputSchema`.
   - Tries auth as `Bearer` first; if init fails with 401, retries with `Zoho-oauthtoken`. Logs which worked.
   - Output goes to `.planning/zoho-mcp-integration/TOOLS.md` for reference.

3. **Document the actual tool contract** in `.planning/zoho-mcp-integration/TOOLS.md`:
   - Send-email tool: exact name + arguments
   - Any other tools to ignore for now (we only need send)
   - Confirmed auth header
   - Confirmed scopes (cross-reference console UI)

### Verification

- `tsx scripts/zoho-mcp-discover.ts` runs end-to-end without error
- TOOLS.md contains a `send_*` tool with `to`/`from`/`subject`/`body`-equivalent fields
- No `401`/`403` in logs

### Anti-patterns to avoid

- Do NOT hardcode `send_email` as the tool name before verification.
- Do NOT assume `to` / `from` field names map directly from the Resend wrapper — they likely use `toAddress` / `fromAddress` per the REST API but the MCP wrapper may rename.

---

## Phase 2 — Build `@leadlandlord/integrations/zoho-mcp` package

### Files to create

```
packages/integrations/src/zoho-mcp/
├── index.ts          # public sendEmail() — drop-in for Resend
├── client.ts         # MCP client lifecycle (singleton with lazy init)
├── oauth.ts          # access-token mint + refresh + in-memory cache
└── types.ts          # SendEmailArgs, ZohoSendResult
```

Update `packages/integrations/package.json` `exports` map (mirror Resend entry):
```json
"./zoho-mcp": "./src/zoho-mcp/index.ts"
```

Update `packages/integrations/src/index.ts` to add `export * as zohoMcp from './zoho-mcp/index';` (mirror line 5).

### `oauth.ts` — token cache

```ts
let cached: { token: string; expiresAt: number } | null = null;

export async function getZohoAccessToken(): Promise<string> {
  if (cached && cached.expiresAt - Date.now() > 60_000) return cached.token;
  // POST `${ZOHO_ACCOUNTS_HOST}/oauth/v2/token` form-encoded
  // body: refresh_token, client_id, client_secret, grant_type=refresh_token
  // parse { access_token, expires_in }
  // cached = { token, expiresAt: Date.now() + expires_in*1000 }
  // throw IntegrationError('zoho-mcp', ...) on non-2xx
}
```

In-memory cache only — Vercel Functions on Fluid Compute reuse instances, so the cache amortizes across invocations within a warm instance. Don't try to persist across cold starts.

### `client.ts` — MCP client singleton

```ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

let clientPromise: Promise<Client> | null = null;
let authMode: 'bearer' | 'zoho-oauthtoken' = 'bearer';

export async function getZohoMcpClient(): Promise<Client> {
  if (!clientPromise) clientPromise = init();
  return clientPromise;
}

async function init(): Promise<Client> {
  const url = new URL(env.ZOHO_MCP_URL!);
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: () => ({
      headers: buildAuthHeader(authMode, currentAccessToken),
    }),
  });
  const client = new Client({ name: 'leadlandlord', version: '1.0' });
  try {
    await client.connect(transport);
  } catch (err) {
    if (is401(err) && authMode === 'bearer') {
      authMode = 'zoho-oauthtoken';
      // retry once
    } else throw err;
  }
  return client;
}
```

Detail: pass a fresh access token on every request (transport supports per-request header injection). Don't bake the token into the transport at construct time — it'll expire mid-process.

### `index.ts` — drop-in `sendEmail`

```ts
import type { SendEmailArgs } from '../resend/index'; // reuse the shape

export interface ZohoSendEmailArgs extends SendEmailArgs {
  // identical to Resend's; from is optional and defaults to ZOHO_DEFAULT_FROM
}

export async function sendEmail(args: ZohoSendEmailArgs): Promise<{ messageId: string }> {
  const client = await getZohoMcpClient();
  const from = args.from ?? env.ZOHO_DEFAULT_FROM;
  if (!from) throw new IntegrationError('zoho-mcp', 'no from address');

  const response = await client.callTool({
    name: ZOHO_SEND_TOOL_NAME, // resolved from Phase 1 discovery
    arguments: mapArgs({ ...args, from }), // map Resend shape → Zoho shape
  });
  // parse response for message id; throw IntegrationError on tool error
}
```

`mapArgs` translates Resend-shape (`to`, `from`, `subject`, `text`, `html`, `cc`, `bcc`) into whatever Phase 1 discovered. Encapsulated in one function so the rest of the codebase never sees Zoho's field names.

### Verification

- Unit tests with `vi.mock('@modelcontextprotocol/sdk/client/index.js', ...)` mocking `Client.callTool`
- Unit tests for `getZohoAccessToken`: cache hit, cache miss → refresh, 401 from refresh endpoint
- Unit test for auth fallback: first connect raises 401 → retries with `Zoho-oauthtoken`
- `tsc` passes across the workspace

### Anti-patterns

- Do NOT call OAuth refresh on every send. Cache.
- Do NOT instantiate a new MCP client per send. Module-scope singleton.
- Do NOT include the access token in module-scope variables that won't be refreshed; pass via per-request header.

---

## Phase 3 — DB: email-sends audit table + throttle helper

### New table `email_sends`

Add to `packages/db/src/schema.ts`:

```ts
export const emailSends = pgTable(
  'email_sends',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    siteId: uuid('site_id').references(() => sites.id, { onDelete: 'set null' }),
    mailbox: varchar('mailbox', { length: 320 }).notNull(),
    toAddress: varchar('to_address', { length: 320 }).notNull(),
    subject: text('subject').notNull(),
    purpose: varchar('purpose', { length: 32 }).notNull(), // 'guest_post' | 'outreach_email_day_1' | ...
    provider: varchar('provider', { length: 16 }).notNull(), // 'zoho' | 'resend'
    externalId: text('external_id'),
    status: varchar('status', { length: 16 }).notNull(), // 'sent' | 'failed' | 'throttled'
    errorMessage: text('error_message'),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  },
  (t) => ({
    mailboxDateIdx: index('email_sends_mailbox_sent_at_idx').on(t.mailbox, t.sentAt),
    siteIdIdx: index('email_sends_site_id_idx').on(t.siteId),
  }),
);

export type EmailSend = typeof emailSends.$inferSelect;
```

Generate migration: `pnpm drizzle-kit generate` → expect `packages/db/migrations/0015_email_sends.sql`.

### Throttle helper

New file `packages/db/src/email-throttle.ts`:

```ts
export async function getRemainingSendsToday(mailbox: string): Promise<number> {
  const cap = computeWarmupCap(mailbox); // see warmup logic below
  const since = startOfUtcDay();
  const sent = await db
    .select({ count: sql<number>`count(*)` })
    .from(emailSends)
    .where(and(eq(emailSends.mailbox, mailbox), gte(emailSends.sentAt, since), eq(emailSends.status, 'sent')));
  return Math.max(0, cap - Number(sent[0]?.count ?? 0));
}

export async function recordSend(...): Promise<void> { ... }
```

Warmup ramp: read `ZOHO_WARMUP_SCHEDULE_JSON` (e.g. `[{"days":7,"cap":10},{"days":7,"cap":25},{"days":Infinity,"cap":50}]`). If unset, fall back to `ZOHO_DAILY_SEND_CAP` flat.

"Day 1" of the mailbox is the date of its first row in `email_sends`. Cache that lookup module-scope per mailbox.

### Verification

- Migration applies cleanly against a scratch Postgres
- `getRemainingSendsToday` correctly reports cap when no sends; cap-N when N sends today
- Warmup curve produces the expected cap on day 1, day 8, day 15 with sample schedule
- Tests use a faked clock for deterministic day-N math

### Anti-patterns

- Do NOT count rows where `status='throttled'` toward the daily total — those didn't actually send
- Do NOT use server-local time for "today" — UTC only

---

## Phase 4 — Wire `zoho-mcp` into agents

### `backlink-builder` (guest_post mode)

In `packages/agents/src/backlink-builder/index.ts:339-355`, replace the Resend send block:

```ts
// Before:
import { sendEmail } from '@leadlandlord/integrations/resend';
// ...
const from = process.env.RESEND_FROM_ADDRESS;
if (!from) throw new Error('RESEND_FROM_ADDRESS not set');
const res = await sendEmail({ to: input.targetEditorEmail, from, subject, text: body });

// After:
import { sendEmail } from '@leadlandlord/integrations/zoho-mcp';
import { getRemainingSendsToday, recordSend } from '@leadlandlord/db/email-throttle';
// ...
const mailbox = env.ZOHO_DEFAULT_FROM!;
const remaining = await getRemainingSendsToday(mailbox);
if (remaining <= 0) {
  // Insert backlink row with status='pending' + metadata.throttled=true; don't send.
  // Log + return early with rowsCreated=1, rowsSent=0.
} else {
  const res = await sendEmail({ to: input.targetEditorEmail, subject, text: body });
  externalId = res.messageId;
  await recordSend({ mailbox, toAddress: input.targetEditorEmail, subject, purpose: 'guest_post', provider: 'zoho', externalId, status: 'sent', siteId: input.siteId });
}
```

Update both hardcoded postal address strings (`:449`, `:496`) to read from `env.LEADLANDLORD_POSTAL_ADDRESS` with a fail-loud fallback.

### `outreach-agent` (email_day_1)

In `packages/agents/src/outreach-agent/index.ts:198-205`, identical swap:

```ts
import { sendEmail } from '@leadlandlord/integrations/zoho-mcp';
// throttle check + send + recordSend
```

Update postal address at line 330 to env-driven.

### Feature flag for safe rollout

Add `ZOHO_MCP_ENABLED` env var (boolean, default false). When false, agents continue using Resend exactly as today. When true, route through Zoho.

```ts
const provider = env.ZOHO_MCP_ENABLED ? zohoSendEmail : resendSendEmail;
```

This lets us deploy code, verify with one manual test send via a script, then flip the flag.

### Verification

- All existing tests pass (Resend mocks still satisfied when flag is off)
- New tests for the throttled-path branch (insert pending row, no send call) and the flag-off branch (still calls Resend)
- E2E test using the `scripts/test-send-zoho.ts` script (next phase) succeeds against the real MCP server in preview env

### Anti-patterns

- Do NOT remove the Resend integration. Lead notification path (`apps/operator/app/api/lead/route.ts:241`) and billing-dunning still use it.
- Do NOT swap before throttle table is migrated — tests will fail without `email_sends`.

---

## Phase 5 — Operator UI: send visibility

Small additive change. New page at `apps/operator/app/operator/email-sends/page.tsx`:

- Lists rows from `email_sends` desc by `sent_at`, last 200
- Shows: timestamp, mailbox, to, purpose, status, externalId, errorMessage
- Filter by mailbox + status
- Counter card at top: "Today: X / Y sent (mailbox: molly@…)"

Add to sidebar in `apps/operator/components/Sidebar.tsx` near the Backlinks link.

### Verification

- Page renders with empty state when no rows
- Counter math matches `getRemainingSendsToday` output
- Filter works without errors

---

## Phase 6 — Smoke test + flip

1. **`scripts/test-send-zoho.ts`** — sends one hand-crafted email to a verified test address (e.g. mike's own address). Logs every step: token mint, MCP connect, tool call, response. Asserts message id received.
2. **Run in preview env first** with `ZOHO_MCP_ENABLED=true` only set in preview. Verify in Zoho Sent folder + recipient inbox.
3. **Run from a deployed Vercel preview function** (not just local) to validate Fluid Compute warm-instance behavior with token cache.
4. **If successful, flip flag in production env.** Roll back: set `ZOHO_MCP_ENABLED=false` — agents revert to Resend with zero code change.

---

## Files Summary

### Created
- `packages/integrations/src/zoho-mcp/index.ts`
- `packages/integrations/src/zoho-mcp/client.ts`
- `packages/integrations/src/zoho-mcp/oauth.ts`
- `packages/integrations/src/zoho-mcp/types.ts`
- `packages/integrations/src/zoho-mcp/index.test.ts`
- `packages/db/src/email-throttle.ts`
- `packages/db/src/email-throttle.test.ts`
- `packages/db/migrations/0015_email_sends.sql` (drizzle-kit generated)
- `apps/operator/app/operator/email-sends/page.tsx`
- `scripts/zoho-mcp-discover.ts`
- `scripts/test-send-zoho.ts`
- `.planning/zoho-mcp-integration/TOOLS.md` (Phase 1 output)

### Modified
- `packages/integrations/package.json` (exports map)
- `packages/integrations/src/index.ts` (re-export)
- `packages/integrations/package.json` (add `@modelcontextprotocol/sdk` dep)
- `packages/shared/src/env.ts` (8 new env vars)
- `packages/db/src/schema.ts` (emailSends table)
- `packages/db/src/index.ts` (export emailSends + email-throttle helpers)
- `.env.example`
- `packages/agents/src/backlink-builder/index.ts` (lines 4, 339-355, 449, 496)
- `packages/agents/src/backlink-builder/index.test.ts` (line 107 update)
- `packages/agents/src/outreach-agent/index.ts` (lines 12, 198-205, 330)
- `apps/operator/components/Sidebar.tsx` (new nav link)

### Untouched
- `packages/integrations/src/resend/index.ts` — Resend stays
- `apps/operator/app/api/lead/route.ts` — operator email notifications stay on Resend
- `packages/agents/src/billing-dunning/index.ts` — stays on Resend
- `packages/agents/src/portfolio-analyst/index.ts` — stays on Resend
- `apps/operator/app/api/cron/agent/[name]/route.ts` — agent dispatch unchanged

---

## Required env vars (handed off to user)

```
# Zoho MCP
ZOHO_MCP_URL=https://mcp.zoho.com/...           # from Zoho MCP console Connect tab
ZOHO_OAUTH_CLIENT_ID=                           # from api-console.zoho.com (self-client)
ZOHO_OAUTH_CLIENT_SECRET=
ZOHO_OAUTH_REFRESH_TOKEN=                       # one-time generation, never expires
ZOHO_ACCOUNTS_HOST=https://accounts.zoho.com    # change if non-US DC
ZOHO_DEFAULT_FROM=molly@leadslandlord.com
ZOHO_DAILY_SEND_CAP=50                          # post-warmup steady cap
ZOHO_WARMUP_SCHEDULE_JSON=[{"days":7,"cap":10},{"days":7,"cap":25},{"days":1000000,"cap":50}]
ZOHO_MCP_ENABLED=false                          # flip to true after smoke test

# Compliance
LEADLANDLORD_POSTAL_ADDRESS="LeadLandlord, [real PO box], [city], [state] [zip]"
```

OAuth scope to grant when generating refresh token: `ZohoMail.messages.CREATE` (plus any MCP-specific scope the console requires — capture verbatim during provisioning).

---

## Rollout checklist

- [ ] User: provision MCP server, set up molly@leadslandlord.com, generate OAuth self-client + refresh token
- [ ] User: populate env vars in Vercel preview env (NOT production yet)
- [ ] Phase 1: discovery script — confirms tool name, schema, auth header
- [ ] Phase 2: build zoho-mcp package
- [ ] Phase 3: migrate email_sends table (against staging DB first)
- [ ] Phase 4: wire into agents behind `ZOHO_MCP_ENABLED=false`
- [ ] Phase 5: operator UI page
- [ ] Phase 6: smoke test in preview, flip flag, monitor first 24h of sends in operator UI
- [ ] Production flip after 1 successful preview run
