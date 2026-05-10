# R2 — `leadlandlord.com` apex + Central GA4 + Search Console runbook

This is the click-through guide for the parts of R2 that require external account access. Code-side prep (env validation, GSC/GA4 integration audit, central GA4 fallback, GSC TXT verification helper) already landed in this branch. This runbook covers what only you can do.

Total time budget: ~45–90 minutes the first time. Most of it is GCP project setup; the rest is fast.

## What you're setting up

| Thing | Where | Used for |
|---|---|---|
| `leadlandlord.com` apex pointed at Vercel | Namecheap → Vercel | Operator/dashboard public address |
| GA4 property + `site_id` custom dimension | Google Analytics | Central pageview tracking across all tenants |
| GCP project + service account JSON key | Google Cloud Console | Headless server-side access to GSC + GA4 APIs |
| Service account granted on tenant GSC + GA4 properties | per tenant | Lets the SEO Expert agent read each tenant's data |
| Env vars pushed to Vercel | Vercel CLI | Wires it all together |

## Step 1 — Connect `leadlandlord.com` (Namecheap → Vercel)

The operator/dashboard apex. Tenant sites stay on their own domains via `leadlandlord-sites`.

1. **Vercel:** open the `leadlandlord-operator` project → Settings → Domains → "Add" → enter `leadlandlord.com` → choose "Add". Vercel will tell you which DNS records to set.
2. **Vercel:** also add `www.leadlandlord.com` and configure it to redirect to the apex (Vercel UI lets you pick this when adding the second domain).
3. **Namecheap:** Domain List → `leadlandlord.com` → Manage → Advanced DNS. Replace the existing host records with what Vercel showed:
   - **A record** at `@` → `76.76.21.21`
   - **CNAME** at `www` → `cname.vercel-dns.com`
4. Wait 5–60 min for propagation. Vercel UI auto-issues SSL once DNS resolves.

**Verification:** `curl -I https://leadlandlord.com` returns a `200` from Vercel. The operator dashboard at `/operator` loads (auth-gated as configured).

## Step 2 — Create the central GA4 property + `site_id` custom dimension

One property collects pageviews from every tenant. The `site_id` custom dimension differentiates them.

1. **Google Analytics** (`https://analytics.google.com`) → Admin → Create → Property.
2. Name: `LeadLandlord Portfolio`. Time zone: your local. Currency: USD.
3. Set up a Web data stream:
   - Stream name: `LeadLandlord Tenants`
   - Stream URL: `https://leadlandlord.com` (any URL — the property will accept events from any tenant domain because the measurement ID is shared)
   - Note the **Measurement ID** (`G-XXXXXXXXXX`). Save it; you'll push it to Vercel in Step 5.
4. Configure the custom dimension. Property → Admin → Custom Definitions → Custom dimensions → Create:
   - Dimension name: `Site ID`
   - Scope: **Event**
   - Event parameter: `site_id`
   - Description: `Sanity site doc UUID — distinguishes tenants in shared GA4 property`
5. (Optional) Create a custom report or exploration filtered by `Site ID` so you can see per-tenant metrics in the GA4 UI.

**Note:** the code already passes `site_id` as a config param when the layout injects gtag (see [`apps/site-host/app/layout.tsx`](../apps/site-host/app/layout.tsx)). The property starts collecting the dimension as soon as the env var lands and a tenant page is hit.

## Step 3 — GCP project + APIs + Service Account

Creates the headless credentials that GSC + GA4 integrations use server-side. **Service account, not OAuth.** No consent screen, no refresh tokens — just a JSON key.

1. **Google Cloud Console** (`https://console.cloud.google.com`) → top bar project selector → New Project.
   - Name: `LeadLandlord`. Org: leave personal/default. Click Create.
2. Enable APIs. Project → APIs & Services → Library → enable each:
   - **Google Search Console API** (`webmasters.googleapis.com`)
   - **Google Analytics Data API** (`analyticsdata.googleapis.com`)
3. Create the service account. IAM & Admin → Service Accounts → Create:
   - Service account name: `leadlandlord-seo-reader`
   - ID: auto-fills (note it — you'll need the `…@leadlandlord-XXXX.iam.gserviceaccount.com` address)
   - Skip role grant (we're scoping at the GSC/GA4 property level instead)
   - Done.
4. Generate the JSON key. Service Accounts → click the row → Keys tab → Add Key → Create new key → JSON. A file downloads. **Save it somewhere safe and don't commit it.**

The JSON looks like:
```json
{
  "type": "service_account",
  "project_id": "leadlandlord-XXXX",
  "private_key_id": "...",
  "private_key": "-----BEGIN PRIVATE KEY-----\\n...",
  "client_email": "leadlandlord-seo-reader@leadlandlord-XXXX.iam.gserviceaccount.com",
  ...
}
```

Save the `client_email` — you'll grant it Viewer access on each tenant's GSC and GA4 property in Step 4.

## Step 4 — Grant the service account access on the existing tenant

Currently one tenant (`junk-removal-vegas.com` / Las Vegas Junk Removal Pros). Do this once now; repeat per tenant going forward.

### 4a. GSC TXT verification (DNS)

Search Console requires DNS-level ownership proof for domain properties. Use the new helper script.

1. **Google Search Console** (`https://search.google.com/search-console`) → Add property → Domain → enter `junk-removal-vegas.com`.
2. GSC will show a TXT record like `google-site-verification=abc123XYZ…`. Copy the **full string** (the `google-site-verification=` prefix is part of the value).
3. From the repo:
   ```bash
   pnpm tsx scripts/verify-search-console.ts junk-removal-vegas.com 'google-site-verification=abc123XYZ…'
   ```
   This reads existing Namecheap host records, appends the TXT record at `@`, and rewrites via `setHosts` (read-merge-write — won't nuke the live A record).
4. Wait 5–60 min for DNS propagation, then click **Verify** in GSC.

### 4b. Grant the service account on GSC ⚠️ DEFERRED TO R5

**Status:** GSC's Users-and-permissions UI rejects service-account email addresses for both `sc-domain:` and URL-prefix property types. This was confirmed live on 2026-05-09 against `junk-removal-vegas.com` with the email `leadlandlord-agent@leadlandlord.iam.gserviceaccount.com` — form validation says "Enter a valid Google account email" and won't accept the submit. Domain properties also don't expose "Add an owner" so the verified-owner UI workaround doesn't apply.

This is a known Google constraint for personal (non-Workspace) Google accounts — there is no UI path to grant a service account on a property owned by a personal account.

**The R5 fix:** when SEO Expert continuous-loop work begins, pick one of:

- **Option A — Site Verification API claim flow** (recommended, ~30 min). Build a one-time `scripts/claim-gsc-ownership.ts`:
  1. Service account calls `siteVerification.tokens.getToken({ site: { identifier: 'sc-domain:<domain>', type: 'INET_DOMAIN' }, verificationMethod: 'DNS_TXT' })` → Google returns a TXT token unique to this service account.
  2. Plant the TXT via the existing `addTxtRecord()` helper in `packages/integrations/src/namecheap/`.
  3. Service account calls `siteVerification.webResources.insert` to claim ownership.
  Service account becomes a verified owner and can query the property. One CLI run per new tenant. Reuses existing `GOOGLE_SERVICE_ACCOUNT_KEY_JSON` env var.

- **Option B — OAuth refresh-token pivot** (~1 hr). Refactor `packages/integrations/src/google-auth/index.ts` to support both service-account and OAuth-refresh-token modes. Create an OAuth 2.0 Client ID in GCP, run a one-time browser flow that captures a refresh token, store it in env. Subsequent GSC + GA4 calls run as the operator's personal account, inheriting all property access without per-tenant grants.

**Until then:** GSC API access from the SEO Expert agent is dormant. The integration code (committed in PR #29 + #30) is correct and will work as soon as one of the paths above is taken. R3 (fleet expansion) and R6 (lead capture) don't depend on this.

### 4c. Grant the service account on GA4

GA4 → Admin → Property → Property Access Management → Add:
- Email: same service account address
- Roles: **Viewer**

## Step 5 — Push env vars to Vercel

Both Vercel projects (`leadlandlord-operator` and `leadlandlord-sites`) need these:

```bash
# From the repo root, point at the operator project first
vercel link  # if not already linked
vercel env add NEXT_PUBLIC_GA_MEASUREMENT_ID production  # paste G-XXXXXXXXXX
vercel env add NEXT_PUBLIC_GA_MEASUREMENT_ID preview     # same value
vercel env add GOOGLE_SERVICE_ACCOUNT_KEY_JSON production  # paste the FULL JSON contents from Step 3.4 — single line is fine; the validator accepts it
vercel env add GOOGLE_SERVICE_ACCOUNT_KEY_JSON preview
vercel env add GOOGLE_DRY_RUN production
# value: false
vercel env add GOOGLE_DRY_RUN preview
# value: true   ← keeps preview deployments from hammering real APIs

# Repeat for the sites project
cd apps/site-host
vercel link
vercel env add NEXT_PUBLIC_GA_MEASUREMENT_ID production
vercel env add NEXT_PUBLIC_GA_MEASUREMENT_ID preview
# (sites project doesn't need GOOGLE_SERVICE_ACCOUNT_KEY_JSON — only the operator/SEO agents call those APIs)
```

Also add the same vars to your local `.env.local` at the repo root so dev mode works:
```
NEXT_PUBLIC_GA_MEASUREMENT_ID=G-XXXXXXXXXX
GOOGLE_SERVICE_ACCOUNT_KEY_JSON={"type":"service_account",...}
GOOGLE_DRY_RUN=false
```

Trigger a redeploy of both Vercel projects so the new env takes effect.

**Verify:** load any tenant page in production, open DevTools → Network → search for `gtag/js?id=G-` — confirm the measurement ID matches your central property. GA4 → Realtime should show the pageview within ~30s with `site_id` populated.

## Step 6 — (Optional) Test the GSC + GA4 connections

There are `testConnection()` exports on both integrations that hit cheap endpoints. Quickest sanity check:

```bash
pnpm tsx -e '
import { testConnection as testGsc } from "@leadlandlord/integrations/google-search-console";
import { testConnection as testGa4 } from "@leadlandlord/integrations/google-analytics";
console.log("GSC:", await testGsc());
// GA4 needs a property ID — find it in GA4 Admin → Property Settings.
console.log("GA4:", await testGa4("YOUR_GA4_PROPERTY_ID"));
'
```

Both should return `{ ok: true }`. If GSC complains about missing access, recheck Step 4b. If GA4 complains, recheck 4c + the property ID.

## Follow-up (not needed today, flag for the next pass)

The agents flagged one architectural gap during the audit — call it out so we don't lose it:

**Tenant → property mapping.** Currently both integrations are stateless and take `domain` / `propertyId` as args. The SEO Expert agent will need a way to resolve "for tenant X, what's its GSC `domain` URL and GA4 `propertyId`?" The clean home for that mapping is two new fields on the **Sanity site doc**:

```
gscSiteUrl: string        // e.g. "sc-domain:junk-removal-vegas.com"
ga4PropertyId: string     // e.g. "123456789"
```

This is a Sanity schema change in `packages/sanity-schema/`, which the active LeadLandlord agent team doesn't have a writer for. When R5 (SEO Expert continuous loop) picks up, that schema change is the first dependency — file it as the entry task.

For R2 today, you can pass these as args directly when test-driving the integrations against the Vegas tenant.
