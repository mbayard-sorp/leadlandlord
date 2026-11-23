# A0 findings (2026-11-23)

Phase A0 of [decommission-plan.md](../decommission-plan.md): read-only inventory and safety net. Nothing was changed at any provider.

## Done

### Live baseline (raw captures in [baseline/](baseline/))

| Check | tesshauling.com | karkens.com | constructionadrservices.com |
|---|---|---|---|
| `/` | 200 | 200 | 200 |
| `<title>` | TESS Hauling & Cleanouts LLC — Junk Removal in Chandler, AZ | Karkens Painting Company — Painter in San Tan Valley, AZ | Michael J. Bayard Construction ADR |
| canonical | https://tesshauling.com | https://karkens.com | https://constructionadrservices.com |
| www | 200 (serves the site, no redirect) | 200 (serves the site, no redirect) | 308 to apex |
| robots.txt / sitemap.xml / llms.txt | 200 / 200 (1 URL) / 200 | 200 / 200 (1 URL) / 200 | 200 / 200 (74 URLs) / 200 |
| `.md` twin | `/index.md` 200 | `/index.md` 200 | `/adr-services.md` 200 |
| Every sitemap URL | n/a | n/a | 74/74 return 200 ([cadr-status.txt](baseline/cadr-status.txt)) |
| Phone (`tel:`) | 6024132889 | 16025688168 | none on home |
| Form posts to | operator `/api/bs/lead` | operator `/api/bs/lead` | site-host `/api/cs-lead` |

Note: the karkens and TESS `www` hosts serve the full page instead of redirecting to the apex. The canonical tag points at the apex, so SEO is fine. The new project should still 308 www to the apex, like constructionadr does.

### Sanity checks (project `ybdv5za2`, dataset `production`)

- **karkens** `bs-site-1f233990-3680-44db-83eb-ffa679afa972`: `draftMode=false`, `robotsDisallow=false`, owner email set (a gmail.com address), no Klaviyo list, `formEndpoint=/api/bs/lead`.
- **TESS** `bs-site-bee4b653-70ff-4a4b-a7c8-f1d44cab85e8`: `draftMode=false`, `robotsDisallow=false`, owner email set (a tesshauling.com address), no Klaviyo list, `formEndpoint=/api/bs/lead`.
- **Unpublished customer-portal drafts** (`drafts.bs-site-*`): **none**. Nothing would be lost when the portal goes away.
- **cs drafts:** none.
- **constructionadr** `cs-site-constructionadr`: `robotsDisallow=false`, 1 lead recipient, **no `indexnowKey`**. The IndexNow submission in the go-live runbook has never been run. Handle it after A3 cutover, from the new repo.
- `cs-site-alignedadvisors` and `cs-site-cueduo` (cuelit) still exist. Delete them in A6.
- **Dataset size:** 1,653 docs in total. That's 61 `buildsellSite`, 14 R&R `site`, 510 `page`, 139 `cs-*`, and 463 assets. 2 `buildsellSite` docs, about 46 constructionadr `cs-*` docs, and their assets are kept.
- **Backup:** `sanity dataset export production` (with assets) to `/Users/mikebayard/Claude/LeadLandlord/_decommission-archive/sanity-production-2026-11-23.tar.gz`. That folder is outside the repo. Move it to cold storage (iCloud, external disk).

### Domains and DNS

| Domain | Registrar | Expires | Owner / action |
|---|---|---|---|
| karkens.com | Namecheap (Mike's account) | 2027-09-05 | **Keep auto-renew ON.** |
| tesshauling.com | Namecheap (business owner's account) | 2027-04-02 | Not ours. Only the Vercel attachment matters. |
| constructionadrservices.com | Bluehost (client) | 2027-08-07 | Not ours. The client's DNS points at Vercel. |
| leadslandlord.com | Namecheap (Mike) | 2027-05-09 | **Keep auto-renew ON** (email sender, D4). |

leadslandlord.com DNS today:
- **Resend (keep):**
  - `resend._domainkey` (DKIM TXT);
  - `send` (SPF `include:amazonses.com` + MX `feedback-smtp.us-east-1.amazonses.com`);
  - `_dmarc` (`p=none`).
- **Zoho (remove in A4):**
  - MX `mx.zoho.com`, `mx2`, `mx3`;
  - root SPF `include:zoho.com`;
  - `zoho-verification` TXT.
- **Web (remove in A4):** apex A `216.150.1.1`; `www` and `edit` CNAMEs to Vercel.
- **Other:** `google-site-verification` TXT, which can be removed with GSC.
- **Gotcha:** the DMARC `rua=mailto:postmaster@leadslandlord.com` reports land in the Zoho mailbox. After Zoho is gone, either drop `rua` or point it at an address you read.

### Vercel

- **Team `mikebayard-5194s-projects`** has 3 projects: `leadlandlord-sites`, `leadlandlord-operator` and `xdipx` (unrelated, don't touch).
- **`leadlandlord-sites` domains:** the 3 kept sites (plus their www hosts), leadslandlord.com/www, `leadlandlord-sites.vercel.app`, and 13 R&R domains to detach in A4:
  - junk-removal-vegas.com, roof-replacement-owensboro.com, sanangelojunkremoval.com
  - foundation-repair-wichita-falls.com, roof-replacement-west-valley-city.com, deckbuildingfranklin.com
  - epoxygarageflooringrockwall.com, bankruptcy-attorney-queen-creek.com, crawl-space-encapsulation-murfreesboro.com
  - deckbuildingmedford.com, basementwaterproofinggeorgetown.com, water-damage-restoration-midland.com
  - foundation-repair-topeka.com
- **`leadlandlord-sites` env var names:**
  - **needed by the new project:** RESEND_API_KEY, RESEND_FROM_ADDRESS, NEXT_PUBLIC_SANITY_PROJECT_ID, NEXT_PUBLIC_SANITY_DATASET (and SANITY_PROJECT_ID, SANITY_DATASET);
  - **not needed:** SANITY_API_READ_TOKEN, SANITY_API_TOKEN, SANITY_REVALIDATE_SECRET, NEON_AUTH_BASE_URL, NEON_AUTH_COOKIE_SECRET, SEMRUSH_API_KEY, GOOGLE_SERVICE_ACCOUNT_KEY_JSON, NEXT_PUBLIC_GA_MEASUREMENT_ID, DATABASE_URL, OPERATOR_PUBLIC_URL.
  - Vercel flags `SANITY_API_TOKEN`, `SANITY_REVALIDATE_SECRET` and `DATABASE_URL` as "readable-secret". Rotate or revoke them in A6.
- **Customer portal is live at `edit.leadslandlord.com`** (Vercel, 307 to /login), but it is **not in this team**. It's probably in your personal Vercel scope or another team. Find it in the dashboard so A4 can delete it.

### Restore point

- Local git tag `pre-decommission-2026-11` is on `f52e920` (origin/main). It **has not been pushed**. Run `git push origin pre-decommission-2026-11` when you're ready.

### Provider inventory (Mike ran `decommission-inventory.ts`, 2026-11-23)

- **Twilio:** the account holds **1 number**, +1 623-900-1188. Its voice and SMS webhooks point at **xdipx.com**, so it belongs to xdipx, not LeadLandlord.
  - LeadLandlord has **no Twilio numbers to release**.
  - **Do not close or downgrade the Twilio account**, because xdipx uses it.
  - A4 only revokes LeadLandlord's own credentials. If the platform shares xdipx's auth token, leave it in place.
- **Namecheap:** the API call was rejected (`Invalid request IP: 184.101.129.92`, which isn't whitelisted, and the proxy isn't configured locally). `whois` covers the gap instead. All 13 R&R domains are on Namecheap with Namecheap DNS, expiring **2027-05-08 to 2027-07-07**.
  - There's no renewal pressure for about 5 months.
  - A1 auto-renew changes can be done in the Namecheap dashboard (Domain List → Auto-Renew toggle). That also shows any domains the domain-procurer bought but never attached.
- **Auto-renew (Mike, 2026-11-23):** all R&R domains are already set to do-not-renew in Namecheap, and Mike is handling the Namecheap side. **Exceptions that must renew:**
  - leadslandlord.com, expires 2027-05-09. It's the Resend sender for every lead email.
  - karkens.com, expires 2027-09-05.
- **Cloudflare:** there are no credentials in the local `.env.local` (`CLOUDFLARE_API_TOKEN` / `_ACCOUNT_ID` are missing). None of the live domains use Cloudflare DNS or the Cloudflare registrar. In A4, check the Cloudflare dashboard for any leftover zones or registrations; it's likely empty.
- The output is saved to `/Users/mikebayard/Claude/LeadLandlord/_decommission-archive/provider-inventory-2026-11-23.json`.

## Needs Mike (blocked for Claude: prod credentials)

1. ~~**Provider inventory.**~~ Done; see above. This one script lists every Twilio number (with its webhooks), every Namecheap domain (expiry and auto-renew), and the Cloudflare registrar domains and zones. It's read-only.
   ```bash
   pnpm tsx scripts/decommission-inventory.ts --json ../_decommission-archive/provider-inventory-2026-11-23.json
   ```
   Run it from the main checkout so it picks up the root `.env.local`. Its output is the checklist for A1 (auto-renew off) and A4 (number release, zone deletion).
2. **DB snapshot of the 2 Build & Sell rows.** This is optional now: the Sanity docs already carry the owner emails, and there are no portal drafts. It's still worth confirming that the emails match, and that nobody has portal logins they'd miss:
   ```sql
   SELECT custom_domain, status, owner_email, live_at,
          (SELECT count(*) FROM bs_customer_site_access a WHERE a.buildsell_site_id = s.id) AS portal_users
   FROM buildsell_sites s WHERE custom_domain IN ('karkens.com','tesshauling.com');
   ```
3. **Locate the customer-portal Vercel project** (see above).
4. **Test-lead baseline.** Submit one form on each of the 3 sites and confirm each email arrives. I can't verify the inboxes myself.
