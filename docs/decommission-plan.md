# LeadLandlord decommission plan

**Date:** 2026-11-23 (rev 2, after Mike's decisions)
**Goal:** Shut down the LeadLandlord platform completely. Move the 3 live sites to a fresh repo and a new Vercel project with **no Neon** (Part A). Then move them **off Sanity** (Part B).
**Status:** Draft, awaiting approval. Nothing has been executed.

---

## 1. Decisions (Mike, 2026-11-23)

| # | Decision |
|---|---|
| D1 | Keep exactly 3 sites: **karkens.com**, **tesshauling.com**, **constructionadrservices.com**. |
| D2 | alignedadvisors.com never went live: delete its code and Sanity content. cuelit.app already lives in another project: delete it from this one. |
| D3 | No paying tenants and no live Stripe subscriptions. |
| D4 | Lead emails keep sending from a `@leadslandlord.com` address via Resend. leadslandlord.com stays registered for email only. |
| D5 | Lead and call data can be deleted. No archive is required. |
| D6 | None of the rank-and-rent domains are worth keeping. Let them all lapse. |
| D7 | Start a fresh repo for the 3 sites. Archive this one. |
| D8 | Part A: get completely off Neon. Part B (later): get off Sanity. |

---

## 2. The 3 sites (verified 2026-11-23)

| Site | Type | Renders from | Form posts to | Phone |
|---|---|---|---|---|
| constructionadrservices.com (+ www, 308 to apex) | Custom Site (`csSite`, ns `cadr`) | Sanity only | site-host `/api/cs-lead`: Resend to `csSite.leadRecipients`. No DB. | Client's own (Sanity) |
| karkens.com (+ www) | Build & Sell (`buildsellSite`) | Sanity only (`customDomain==host && draftMode==false`) | **Operator app** `/api/bs/lead`: inserts into Neon `buildsell_site_leads`, then Resend to `buildsell_sites.owner_email` (+ Klaviyo) | 602-568-8168, business's own (Sanity), no Twilio |
| tesshauling.com (+ www) | Build & Sell (`buildsellSite`) | Sanity only | Same operator route | 602-413-2889, business's own (Sanity), no Twilio |

All 3 are attached to the Vercel project `leadlandlord-sites` (team `mikebayard-5194s-projects`). DNS points at Vercel. constructionadrservices.com DNS is hosted at Bluehost, where the client's email also lives.

**The only Neon dependency of the 3 sites is the Build & Sell lead form.** Rendering, metadata, robots, sitemap, llms.txt and the `.md` twins all read from Sanity alone. The owner email and Klaviyo list ID that the lead route reads from Postgres are already mirrored on the Sanity `buildsellSite` doc (hidden fields `ownerEmail`, `klaviyoListId`).

**What goes away with Neon:**
- **Customer portal** (`edit.leadslandlord.com`): its login is Neon Auth. Once it's gone, the karkens and TESS owners can no longer self-edit. Their last *published* edits keep rendering, but any unpublished `drafts.bs-site-*` docs are lost unless published first.
- **Lead history** (`buildsell_site_leads`). It's deletable per D5.

---

## 3. Target architecture (new repo)

One small Next.js 16 app, one Vercel project, no workspace packages.

```
<new-repo>/
  app/
    layout.tsx              minimal shell, no LeadLandlord GA4
    (cadr)/...              copied from site-host app/cadr (rewrite target)
    bs/...                  B&S home for karkens + tess (rewrite target)
    api/lead/route.ts       one same-origin lead route for all 3 sites, Resend via fetch, no DB
    sitemap.ts robots.ts llms.txt llms-full.txt md/[[...path]]  per-site branches
    api/indexnow-key/route.ts
  proxy.ts                  host -> site map (3 hosts + www), dev fallback ?site=<key>
  lib/
    sites.ts                static registry: host, kind (cs|bs), Sanity doc id, lead recipients
    sanity.ts               client + only the cs and bs projections
    customsites-*.ts        copied from site-host
    buildsell-{meta,theme,fonts,markdown}.ts, presets.ts (copied verbatim from sanity-schema)
  components/customsites/**, components/buildsell/** (minus ThemeBar, DraftShield, preview chrome)
  styles/customsites/adr.css, styles/themes/buildsell.css, globals.css (base only)
  scripts/ customsites-indexnow.ts, customsites-geo-audit.ts (+ checks.ts copied), migrate-construction-adr.ts
```

Key choices:
- **Lead route:** one route, modeled on today's zero-DB `cs-lead`.
  - It resolves the site from the Host header against `lib/sites.ts`.
  - It sends to `leadRecipients`: from `csSite.leadRecipients` for constructionadrservices.com, and from `ownerEmail` for the Build & Sell sites.
  - It keeps the honeypot, Zod validation and the in-memory rate limit.
  - It calls the Resend REST API with `fetch` (no integrations package).
  - `ContactBlock` posts to the same origin, so there's no cross-origin call to the operator.
  - Klaviyo forwarding is dropped.
- **Analytics:**
  - Drop LeadLandlord's GA4, which currently loads on the Build & Sell sites.
  - constructionadrservices.com keeps its own GTM (`csSite`).
  - Keep Vercel Analytics and Speed Insights.
  - Drop the `/api/cwv` beacon (it fed the operator DB).
- **Not carried over:**
  - R&R, corporate, preview/draft-mode and the theme bar;
  - Aligned Advisors and Cuelit;
  - Sentry (optional to keep);
  - every `@leadlandlord/*` package.
- **Sanity stays read-only in Part A** (same project `ybdv5za2`, dataset `production`, CDN reads, no token needed at runtime). Studio stays available for content edits until Part B.

**Env vars (new project):**
- `NEXT_PUBLIC_SANITY_PROJECT_ID`
- `NEXT_PUBLIC_SANITY_DATASET`
- `RESEND_API_KEY` (a new key restricted to sending)
- `RESEND_FROM_ADDRESS` (`leads@leadslandlord.com`)
- optional `NEXT_PUBLIC_GOOGLE_MAPS_EMBED_KEY`

`DATABASE_URL` is not set.

---

## 4. Part A: off Neon, platform shut down

Order: **freeze, then build and verify the new home, then move domains, then tear down, then delete data.** Every destructive step gets an explicit go-ahead before it runs.

### A0. Inventory and safety net (read-only)

- [ ] **Mike runs** this read-only query (Claude's access to prod DB was blocked). It confirms the owner emails before the DB disappears:
  ```sql
  SELECT custom_domain, status, owner_email, klaviyo_list_id, live_at,
         (SELECT count(*) FROM bs_customer_site_access a WHERE a.buildsell_site_id = s.id) AS portal_users
  FROM buildsell_sites s WHERE custom_domain IN ('karkens.com','tesshauling.com');
  ```
- [ ] **Cross-check in Sanity** that `ownerEmail` on both `buildsellSite` docs matches. Fix it in Studio if it doesn't.
- [ ] **Check for unpublished portal edits:** `*[_id in path("drafts.bs-site-**")]`. If any exist, ask the owner to publish (or publish them on their behalf) before the portal goes.
- [ ] **Confirm who holds** karkens.com and tesshauling.com: registrar, account, expiry, and who pays. If we registered them via the domain-procurer (Namecheap/Cloudflare), they must **stay on auto-renew** and need a decision on transferring them to the owners.
- [ ] **Confirm leadslandlord.com DNS** holds the Resend SPF/DKIM records, and note which records are Zoho (MX), web (A/CNAME) and Resend.
- [ ] **Snapshot inventories:**
  - Twilio numbers;
  - Namecheap and Cloudflare domains (expiry, autoRenew);
  - Vercel domains and env vars for all 3 projects;
  - Klaviyo lists;
  - ElevenLabs agent and number.
- [ ] **Export Sanity** with `sanity dataset export production` (with assets). It's the source of truth for both parts and the input to Part B.
- [ ] **Record a baseline for each site:**
  - home page plus one inner page: 200 and title;
  - sitemap, robots, llms.txt and one `.md` twin;
  - IndexNow key file;
  - a test lead received;
  - the `customsites-geo-audit` score for constructionadr.
- [ ] Tag this repo: `git tag pre-decommission-2026-11`.

### A1. Freeze the platform (reversible)

- [ ] Run `scripts/system-state.ts on "decommission"`. This blocks every agent run and the queue drain.
- [ ] Set `agent_budgets.enabled=false` for every agent. The kill switch alone misses the domain-verifier, alert-evaluator, supervision pass and backups.
- [ ] **Pause** the `leadlandlord-operator` Vercel project. This stops all 26 crons and the webhooks.
  - **Exception:** the Build & Sell lead route lives on the operator. Until A3 cuts the Build & Sell sites over, either keep the operator running with crons removed (deploy an empty `crons` in `vercel.json`), or accept that the karkens and TESS forms fail for the A2 to A3 window.
  - **Recommended:** remove the crons but leave the operator up until A3.
- [ ] **Turn off auto-renew** on every Namecheap and Cloudflare domain **except** leadslandlord.com, karkens.com and tesshauling.com.
- [ ] **Do not run** any operator Build & Sell action (regenerate, rebuild, detach domain) from here on. They overwrite or unset the live Sanity docs.
- [ ] Soak for 48h: no agent_runs, no outbound email, no purchases.

### A2. Build the new repo (no production impact)

- [ ] Create the repo (name TBD) and a new Vercel project. Connect git and set the env vars above.
- [ ] Port the code per section 3:
  - copy the files and trim the imports;
  - add `lib/sites.ts` and the unified `/api/lead`;
  - point `ContactBlock` at `/api/lead`;
  - add `ownerEmail` to the Build & Sell GROQ projection, or hold recipients in `lib/sites.ts` (simpler, and it survives Part B unchanged).
- [ ] Port the tests:
  - the cs-lead route test (adapt it to `/api/lead`);
  - the `customsites-{metadata,sanity,markdown}` tests.
- [ ] Add:
  - a proxy routing test (each host maps to the right site; unknown host gets a 404);
  - a lead route test per site kind.
- [ ] Run `pnpm typecheck && pnpm test && pnpm build`.
- [ ] **Preview verification:** on the new project's `.vercel.app` URL with `?site=<key>`, run the full section 6 gate for all 3 sites, including a real test lead to a recipient you control.

### A3. Cut over domains (one at a time, lowest stakes first)

Order: **tesshauling.com, then karkens.com, then constructionadrservices.com.**

All 3 projects are in the same Vercel team and DNS already points at Vercel, so moving a domain between projects needs no DNS change. For each site:
1. Remove the apex + www from `leadlandlord-sites`, then add both to the new project, with www redirecting to the apex as today. The gap is seconds. Do it at a quiet hour.
2. Run the section 6 gate on the live domain, including a test lead.
3. Wait 24h with no 5xx before moving the next site.

For constructionadrservices.com, confirm `robotsDisallow=false` survives, then run `customsites-indexnow --execute` from the new repo.

Rollback for each site: move the domain back to `leadlandlord-sites`, which is untouched until A4.

### A4. Tear down the platform

Run these after all 3 sites have been stable on the new project for at least 7 days.

- [ ] **Twilio:** A0 found no LeadLandlord numbers. The only number on the account belongs to xdipx.
  - Delete the LeadLandlord call recordings (D5).
  - **Keep the account**, since xdipx uses it.
- [ ] **ElevenLabs:** delete the agent, the imported number and the conversations. Cancel the plan.
- [ ] **Stripe:** delete the webhook endpoint. Deactivate the account if it's unused elsewhere.
- [ ] **Klaviyo:** delete the lists and profiles, then cancel.
- [ ] **Zoho:** shut down the Molly mailbox. Remove the Zoho MX records from leadslandlord.com. **Keep** the Resend SPF/DKIM/DMARC records.
- [ ] **Vercel:**
  - Delete `leadlandlord-operator`.
  - Delete the customer-portal project and remove the `edit.leadslandlord.com` record.
  - Detach the remaining R&R domains and leadslandlord.com/www from `leadlandlord-sites`, then delete that project.
  - leadslandlord.com then serves no website. Optionally point it at a one-line static page in the new project.
- [ ] **Fly.io:** `fly apps destroy leadlandlord-namecheap-proxy`, which releases the dedicated IPv4.
- [ ] **Cloudflare:** delete the zones for retired domains. Let the R&R registrations lapse (D6).
- [ ] **Sanity webhooks:** remove any webhooks pointing at the operator or site-host `/api/revalidate`.
- [ ] **Metered and SaaS accounts:** cancel or revoke keys for:
  - Apollo, DataForSEO, Google Places, SEMrush, BrightLocal, FireCrawl, PageSpeed;
  - AI Gateway / Imagen, the Anthropic key used by the fleet;
  - the GSC/GA4 service account;
  - PagerDuty, Slack webhooks, the operator Sentry project.

### A5. Delete Neon

- [ ] Confirm nothing references the DB: the new project has no `DATABASE_URL`, and the old projects are deleted.
- [ ] **Delete the Neon project.** This covers the prod DB, all branches and Neon Auth. Per D5, no export is required. The only rows worth keeping (two owner emails) are already captured in A0.
- [ ] Revoke the Neon roles and `READONLY_DATABASE_URL`, and remove the DB lines from local `.env.local` files.

### A6. Close out the old repo

- [ ] Strip the Sanity content that isn't kept (one delete mutation per type, after the A0 export):
  - R&R and corporate: `site`, `page`, `theme`, `siteDomain`, `corporate*`, `keywordCluster`, `review`;
  - all `buildsellSite`/`bsReview` docs except karkens and TESS;
  - Aligned Advisors and Cuelit `cs-*` docs.
- [ ] **Prune the Studio schema** to the cs and Build & Sell types the 3 sites use. Deploy it from the new repo (move `apps/studio` there, trimmed) so content edits still work until Part B.
- [ ] Revoke the remaining old secrets: `CRON_SECRET`, the operator password and session secret, `BS_PREVIEW_HMAC_SECRET`, the Neon Auth secret, the proxy secret, the old Resend and Sanity write tokens, and `VERCEL_TOKEN`.
- [ ] Archive this GitHub repo (read-only). The `pre-decommission-2026-11` tag is the restore point.

---

## 5. Part B: off Sanity (later)

Goal: content lives in the new repo, there's no CMS, and edits happen as code changes.

- [ ] **Content:** export the 3 sites' documents into typed content files in the repo:
  - Build & Sell: `content/karkens.ts` and `content/tess.ts` matching the current `buildsellSite` projection.
  - constructionadr: `content/cadr/*.ts`. Keep Portable Text bodies as JSON rendered with `@portabletext/react`; this is the smallest change, since the renderer already handles it. Converting to MDX is optional.
- [ ] **Images:** download every referenced asset (logo, favicon, OG, sections, before/after, UGC, review avatars, attorney photos, hero) into `public/sites/<key>/`. Replace `urlForImage` with `next/image` on local files, and drop `cdn.sanity.io` from `remotePatterns`.
- [ ] **Code:**
  - Replace the Sanity fetchers with imports from `content/`.
  - Delete `lib/sanity.ts`, the Sanity client dependency and the GROQ projections.
  - Each site's `robotsDisallow` and `indexnowKey` move into `lib/sites.ts`.
- [ ] **Verify:** with Sanity disconnected (env vars removed), the section 6 gate passes on preview for all 3 sites. Then compare the rendered HTML of each page against production, which still runs on Sanity at that point.
- [ ] **Deploy and soak** for 7 days.
- [ ] **Delete the Sanity side:** the Studio deployment (`leadlandlord.sanity.studio`), the datasets, then the project `ybdv5za2`, after one final export to cold storage. Revoke all Sanity tokens.
- [ ] **Editing model after Part B:** customer edit requests for karkens and TESS, and client edits for cadr, become code changes. Tell both Build & Sell owners and the cadr client.

---

## 6. Verification gate (every site, every step)

1. The home page and one inner page return 200 with the correct `<title>` and canonical.
2. `/robots.txt`, `/sitemap.xml`, `/llms.txt` and one `.md` twin return the expected per-site content.
3. `/<indexnowKey>.txt` returns 200 (constructionadr).
4. A test form submission arrives at the right recipient, from `leads@leadslandlord.com`, with reply-to set to the submitter.
5. The `tel:` links and phone numbers match the A0 baseline. The Google Map renders, if enabled.
6. No 5xx in the new project's logs for 24h.
7. The `customsites-geo-audit` score for constructionadr is not lower than the A0 baseline.

## 7. Rollback summary

- **A1 to A3:** fully reversible. Unpause or redeploy the operator, turn the kill switch off, and move the domains back to `leadlandlord-sites`.
- **A4:** released Twilio numbers and lapsed domains are gone for good. None are needed (D6).
- **A5:** Neon deletion is final (accepted per D5).
- **Part B:** reversible until the Sanity project is deleted. Keep the final export.

## 8. Still open

- **Customer portal:**
  - Do the karkens and TESS owners actually use it?
  - They lose self-editing at A4. Should they be told in advance?
  - A0 found no unpublished drafts, so no content is at risk.
- **Domain ownership: resolved.**
  - karkens.com is in Mike's Namecheap account. Keep auto-renew on.
  - tesshauling.com is owned by the business owner. No action needed.
  - Details are in [decommission/A0-findings.md](decommission/A0-findings.md).
- **New repo:** name, and whether it stays under the same GitHub account and Vercel team.
- **Sentry:** keep it for the new project, or drop it.
