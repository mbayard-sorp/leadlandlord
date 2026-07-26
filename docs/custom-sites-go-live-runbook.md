# Go-live runbook: Custom Sites (ADR 0033, Amendment 1)

Checklist for taking a Custom Sites line site (client-owned, `csSite`-keyed, no Postgres row — see ADR 0033 D4) from "built in Sanity" to "live at the client's domain." First instance: `constructionadrservices.com`, siteKey `constructionadr`, internal route namespace `cadr`. Cross-references [ADR 0033](./adr/0033-custom-sites-line.md).

Nothing here activates a site by itself: `csSite.robotsDisallow` defaults to `true` (ADR 0033 D6), so a site stays noindexed through build-out and client review until step 3 below is done deliberately.

## 1. Pre-cutover

- **Sanity schema deploy.** Confirm the Amendment-1 `cs*` fields are live in the deployed Studio: `csSite.indexnowKey`, `csSite.titleTemplate`, `csSite.areaServed`, `csAttorney.barAdmissions` (`csBarAdmission` object: `jurisdiction`, `barNumber`, `admittedYear`), `csAttorney.credentials` (`csCredential` object: `name`, `issuer`, `year`, `url` — note this replaced a plain string array, so re-check any already-authored `credentials` data migrated cleanly), `csAttorney.arbitratorPanels`, `csSeo.noindex` / `csSeo.canonicalOverride`, `csFaqBlock` on `csPage.pageBuilder`, `csTestimonial.rating`. Confirm `apps/studio/structure.ts` lists the Custom Sites folder so these types are actually visible in Studio.
- **Author content.** Fill in real values, not placeholders, for anything schema-driven JSON-LD depends on:
  - Attorney bar admissions and credentials (`csAttorney.barAdmissions`, `.credentials`, `.arbitratorPanels`) — feeds `hasCredential`/`memberOf`.
  - Page-level FAQ blocks (`csFaqBlock` on generic pages, or `csPracticeArea.faqs`) — feeds `FAQPage` JSON-LD.
  - Testimonial ratings (`csTestimonial.rating`) — only if the rating is real/sourced from the client, since it feeds `Review`/`AggregateRating` JSON-LD once a renderer consumes it. Do not fabricate.
- **Confirm `robotsDisallow` is still `true`.** It should stay noindexed through this entire section — do not flip it until step 3.

## 2. DNS cutover

1. Point the client's domain (or subdomain) at the site-host deployment per the client's DNS provider.
2. Add the host → siteKey mapping to `CUSTOM_HOSTS` in `apps/site-host/proxy.ts` (currently `constructionadr: 'cadr'` — see `proxy.ts:16-27`). This is an additive map entry, not a routing redesign (ADR 0033 D1/Consequences).
3. Attach the domain in the Vercel project for `apps/site-host`.

## 3. Flip `robotsDisallow`

In Sanity, set `csSite.robotsDisallow` to `false` for this site. This is the **one switch** that un-gates `robots.txt`, `sitemap.xml`, `llms.txt`, `llms-full.txt`, and every `.md` twin (ADR 0033 D6). Do this only once the domain is actually live and serving this site as the site of record — never before, per the same never-index-before-DNS invariant R&R and B&S follow.

## 4. Post-flip: IndexNow submission

```bash
pnpm customsites-indexnow --site constructionadr --execute
```

This is operator-run, not automated via Vercel Cron (ADR 0033 D7) — there's no `agent_events` row to hang a scheduled trigger on for this line, and a handful of sites doesn't justify a new scheduled-function surface. Run it once now (right after the robots flip) and again after any content edit worth a recrawl ping.

Note the gate is intentional: the script is a no-op (skips, does not submit) for any `csSite` where `robotsDisallow !== false` — so running it *before* step 3 silently does nothing. That's by design, not a bug.

## 5. Re-audit GEO/AEO score

```bash
pnpm customsites-geo-audit --site constructionadr
```

Record the score. The pre-cutover baseline captured 2026-07-25 for `constructionadr` was **53/100** (entityConsistency 100, schemaCoverage 75, answerExtractability 58, citationReadiness 52, llmsTxtCompleteness 0, markdownCoverage 0) — the two zero subscores were an artifact of `robotsDisallow: true` gating `llms.txt`/`.md` twins to 404, not a content defect. The post-cutover run (after step 3) is the **first true reading**; expect `llmsTxtCompleteness` and `markdownCoverage` to move off zero. This script prints to stdout only — nothing is persisted (ADR 0033 D8) — so record the number here or wherever the go-live tracking for this site lives.

## 6. Verification

- Confirm the 32-hex IndexNow key file resolves at the live host: `https://<domain>/<csSite.indexnowKey>.txt` should return 200 with the key as body (served via `apps/site-host/app/api/indexnow-key/route.ts`'s custom-mode branch, ADR 0033 D7).
- Spot-check JSON-LD on at least the home page and one practice-area page in [Google's Rich Results Test](https://search.google.com/test/rich-results).
- Confirm pickup in Google Search Console and Bing Webmaster Tools once crawled (may take longer than the IndexNow ping itself — IndexNow accelerates discovery, it doesn't guarantee indexing).

## Outstanding human content tasks

Track these separately from the technical cutover — they don't block DNS/robots but should close out before calling the site fully done:

- **Hero image format.** Currently a 1920x1080 PNG; re-upload as JPEG (smaller payload, no transparency need for a photographic hero).
- **Public contact email.** Currently `michaeljbayard@yahoo.com`; swap to a domain email (e.g. `@constructionadrservices.com`) once DNS/Resend is live for that domain.

## Reference

- Architecture decision: `docs/adr/0033-custom-sites-line.md` (Amendment 1 — D7 IndexNow, D8 GEO/AEO audit, D9 freshness deferral, D10 schema).
- Proxy host-mode routing: `apps/site-host/proxy.ts`.
- GEO/AEO audit script: `scripts/customsites-geo-audit.ts` (read-only, stdout-only, per D8).
- IndexNow submission script: `scripts/customsites-indexnow.ts` (dry-run by default, per D7).
- IndexNow key route: `apps/site-host/app/api/indexnow-key/route.ts`.
