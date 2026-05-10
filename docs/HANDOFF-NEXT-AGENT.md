# LeadLandlord — Handoff to Next Agent Session

**Last update:** 2026-05-10 ~15:35 UTC

Drop this into a fresh Claude Code session. Read top-to-bottom then act.

---

## What this project is

LeadLandlord is a multi-agent system that builds, ranks, monetizes, and manages a portfolio of "rank-and-rent" lead-generation websites (one per `niche × city`). Sites get rented to local business owners for $300–$5K/mo. Solo operator runs 100+ sites with <2 hr/week.

**Repo:** `/Users/mikebayard/Claude/LeadLandlord` (monorepo, Turborepo + pnpm)
**Architecture:** `apps/site-host` (multi-tenant Next.js 16 App Router renderer, all tenants), `apps/operator` (dashboard + agent runtime + cron + webhooks), Sanity CMS for content, Neon Postgres for ops, four custom agents in `.claude/agents/`.

**Active plan of record:** `/Users/mikebayard/.claude/plans/let-s-take-a-big-compiled-sifakis.md` — read it first. Phases R1–R6, revenue-first. Phases below reference its labels.

---

## Where we are right now

### Shipped + live (don't redo)

| Phase | What | Where |
|---|---|---|
| **R1** | SEO foundation — per-host canonical, BreadcrumbList JSON-LD on nested routes, Twitter cards + OG, complete Service JSON-LD, skip-to-content, hero `next/image`, `apps/site-host/SEO_CHECKLIST.md` | PR #28 merged |
| **R3 variants** | Modern + Premium + Bright refactored to design-brief parity (LeadForm, FAQ, trust band, mid-page phone, hero slot). Premium fake testimonial replaced with `[TESTIMONIAL — REPLACE]`. Paired-surface tokens kill 21 `!important` contrast hacks. | PR #28 merged |
| **R2 GA4** | Central GA4 fallback wired (`NEXT_PUBLIC_GA_MEASUREMENT_ID` + per-tenant override). `Site ID` custom dimension defined in GA4. Live + verified on production. | PRs #29 + #30 merged |
| **R2 domain** | `leadslandlord.com` apex → `leadlandlord-sites` Vercel project, corporate landing page live with SSL. | Manual DNS/Vercel work done |
| **Cluster-coverage runaway fix** | `cluster_key` enum constraint via Anthropic tool-use, theme pass-through (was dead code), system prompt verbatim-copy rule, rejected-bundle pino log. **Verified live first-attempt success on foundation-repair rebuild this session.** | PR #33 merged |
| **Agent team** | `next-engineer`, `leadlandlord-architect`, `leadlandlord-qa`, `leadlandlord-seo-auditor` at `.claude/agents/`, index at `AGENTS.md`. | Already in main |
| **Ops tooling** | `scripts/audit-recent-spend.ts` (PR #32 open), `scripts/cleanup-dead-site.ts` (PR #34 merged), `scripts/verify-search-console.ts` (R2). | See PRs |

### Live tenants

| Domain | Tenant | Variant | Status |
|---|---|---|---|
| `leadslandlord.com` | Corporate landing | classic shell | Live, SSL, GA4 firing |
| `junk-removal-vegas.com` | Las Vegas Junk Removal Pros | classic | Warming (`robotsDisallow=true`), tracking phone live |
| (no domain yet) | Austin Foundation Repair Pros — slug `foundation-repair-austin-tx` | classic | Warming, deployed in this session — needs Namecheap domain attached |

### Locked decisions (don't re-litigate)

- Central GA4 with `site_id` custom dimension (not per-tenant)
- Registrar = Namecheap
- Voice (later, R6+) = ElevenLabs
- Pricing = low to start
- Backlink workflow = half-auto Molly (drafts + you review)
- Content cadence = aggressive 2–3 posts/week per site for first 6 months
- Niche-overlay format = markdown
- SEO Expert = single collapsed agent (R5)
- MVP excludes Twilio A2P, Stripe, outbound SMS, AI voice, Apollo, Smartlead — all deferred until first revenue

---

## Open PRs (from prior session, optional cleanup)

| # | What | Risk |
|---|---|---|
| **#31** | Docs-only — runbook note that GSC service-account grant deferred to R5 | None |
| **#32** | New `scripts/audit-recent-spend.ts` — ops diagnostic | None |

Both safe to merge with `gh pr merge --squash`.

---

## What's left — recommended sequence

### Next session priority 1: R3 fleet expansion (revenue path)

Deploy 3–5 more tenants in different variants so the portfolio diversifies. **The cluster-coverage fix is verified — builds now succeed first-attempt for ~$0.50–0.80 each.**

Concrete first batch (architect-validated for variant fit):

| Variant | Niche × City | Theme key | Status |
|---|---|---|---|
| **Modern** | solar install, Boulder CO | `modern` | Approve in `/operator/niches` |
| **Premium** | custom landscape, Scottsdale AZ | `premium` | Approve in `/operator/niches` |
| **Bright** | house cleaning, Phoenix AZ | `bright` | Approve in `/operator/niches` |
| **Classic** (extra) | foundation repair, Austin TX | `classic` | ✅ already deployed this session |

**Per-tenant flow (each ~10 min of operator time):**
1. Run `niche-hunter` for the niche × city (or pick from `/operator/niches` if already there)
2. Approve in `/operator/niches` → emits `niche.approved` event
3. Operator-tick claims → site-builder runs → keyword-planner + content-engine + tracking-setup
4. Buy domain via Namecheap (~$10–15/year)
5. Add domain to `leadlandlord-sites` Vercel project (Settings → Domains → Add)
6. Set Namecheap DNS: `A @ → 216.150.1.1`, `CNAME www → cname.vercel-dns.com.`
7. Wait ~5–60 min for SSL
8. Add domain to Sanity site doc's `domains[]` field with `isPrimary=true` so site-host's host-resolver routes correctly

**Expected per build (post-fix):**
- ~$0.50–0.80 LLM spend
- 5–8 min wall time
- 1 site row in Postgres (`status='warming'`)
- 1 Sanity site doc + ~25 page docs
- Mock tracking number assigned (Twilio mocked)

**What to watch:**
- `agent_events` for the niche.approved event — `attempts` should stay 0
- `agent_runs` — single content-engine run, status=succeeded
- Vercel logs for `"theme":"<theme-key>","overlay":false` (overlay still false until follow-up below — see Known issues)

---

### Next session priority 2: Niche overlay bundling (Fix 1.6)

**The bug:** `theme` is passed correctly to content-engine (`pickThemeForNiche` works, log shows `"theme":"classic"`), BUT `loadNicheOverlay()` returns null because the `niches/*.md` markdown files aren't in the deployed Vercel function's filesystem at runtime. The catch swallows the ENOENT and the model gets the base prompt only — no niche-specific terminology.

**Diagnosis source:** session log + Vercel logs from foundation-repair rebuild on 2026-05-10 showed `"theme":"classic","overlay":false`.

**Fix options (architect should validate):**
1. **Inline overlays as TS exports** — convert `niches/{trades,modern,premium,bright}.md` into `niches/{trades,modern,premium,bright}.ts` exporting the markdown as a const string. Build-time inclusion guaranteed; ~30 min.
2. **`outputFileTracingIncludes`** in `apps/operator/next.config.ts` — tells Next.js to bundle the `.md` files. Cleaner if it works; depends on monorepo path resolution.
3. **Import-as-string** via a build-time directive — Webpack `?raw` import or similar. Risky given Turbopack vs Webpack.

**Recommended:** option 1 (inline as TS). One-time mechanical conversion, removes the runtime file-I/O entirely, simplifies the loader. Tests already pass against in-memory strings.

**Files:**
- `packages/agents/src/content-engine/niches/{trades,modern,premium,bright}.md` (rename + convert)
- `packages/agents/src/content-engine/index.ts:34-49` `loadNicheOverlay()` — replace `readFileSync` with object map lookup

**Verify after:** redeploy + run a build (any niche) → Vercel log line should show `"overlay":true`.

---

### Next session priority 3: R4 backlinks — citation autopilot

Per the active plan, backlinks split into two tracks:

**R4a — citation autopilot (zero human-in-the-loop):**
- Auto-submit each new tenant to Yelp, BBB, Angi, Google Business Profile, niche-specific directories, Bing Places.
- Persist a `citations` table linking site → directory → status → URL.
- Maintenance Agent re-checks monthly that citations are still live.

**R4b — guest-post pipeline (half-auto):**
- DataForSEO + SERP heuristics build a 50-blog target list per niche.
- Molly (Outreach Agent persona) drafts personalized pitch emails. Operator reviews + approves the batch in `/operator/backlinks`.
- On `yes` reply: Copywriter drafts 1000–1500-word guest post tuned to target blog's voice. Operator reviews. Molly delivers.

R4a is doable now. R4b requires the Outreach Agent persona work which is partially in `commit b325b1a` ("backlink-builder: prospect mode with DataForSEO + Apollo + manual fallback").

---

### Phase pipeline (later sessions)

| Phase | Scope | When |
|---|---|---|
| **R5 — SEO Expert continuous loop** | Weekly cron pulls GSC + GA4 + Lighthouse, auto-applies low-risk fixes (title tweaks, meta rewrites, internal links, schema fixes), queues medium-risk for review. **Prerequisite: GSC service-account ownership claim** — see `docs/r2-setup-runbook.md` Step 4b deferral note. Two implementation paths documented. | After R3 produces real GSC data |
| **R6 — Lightweight lead capture + manual revenue** | `/api/lead` route fires email + push notification (no Klaviyo until traffic). Inbound Twilio call recording + transcript. Manual tenant pitch when calls reach ~5/mo for 2 months. Payment via Zelle/Square invoice — **no Stripe required for MVP**. | When first site gets real call volume (~3–6 mo post-R3) |
| **Phase 6/7/8** | Twilio A2P, Stripe Closer, ElevenLabs voice, AI Trial Manager, monitoring, marketplace, white-label | Only after R6 produces revenue |

---

## Known issues / follow-ups (don't re-discover)

1. **Niche overlay bundling** (above — Fix 1.6) — theme threads through but `.md` files not deployed
2. **Foundation-repair coverage** — 2/21 clusters not covered on the live build (under 20% threshold so accepted, but cluster-coverage gap exists). Probably 2 `info-*` clusters Claude couldn't fit. Defer until SEO impact is measurable.
3. **`APOLLO_API_KEY_KEY`** typo in Vercel operator env — code reads `process.env.APOLLO_API_KEY` so it'd be undefined in prod. Only matters for Phase 6 outreach. Low priority.
4. **`ELEVEVENLABS_PHONE_NUMBER_ID`** typo (extra "EV") in both local + Vercel — code matches the typo so it works. Cosmetic.
5. **`NEXT_PUBLIC_GA_MEASUREMENT_ID`** is Production-only on Vercel (not Preview) — preview deploys won't fire GA. Cosmetic.
6. **Old failed agent_runs rows** from May 7/8 cluster-coverage failures still in DB — `site_id` set to NULL via FK on cleanup. Not affecting anything; could prune for tidiness with a query like `DELETE FROM agent_runs WHERE site_id IS NULL AND error LIKE 'cluster coverage too low%'`.

---

## Project-scoped agents available

All four at `.claude/agents/` (LeadLandlord-native, NOT xdipx — those are different):

- **`next-engineer`** — default product-engineering agent. Next.js 16 App Router, multi-tenant Sanity, BaseAgent boundary. Use for any code changes.
- **`leadlandlord-architect`** — design + ADRs + seam protection + MVP-scope gate. Use before non-trivial features.
- **`leadlandlord-qa`** — typecheck + tests + preview MCP at 375/1024 + JSON-LD/canonical sanity + 4-variant regression sweep.
- **`leadlandlord-seo-auditor`** — SEO checklist enforcement against `apps/site-host/SEO_CHECKLIST.md`.

When triggering work, route through these — `Plan` agent type for architecture, `general-purpose` for engineering/QA. The orchestrator (you/me/main thread) coordinates.

---

## Critical pointers

### Files to read on session start

1. This doc
2. `/Users/mikebayard/.claude/plans/let-s-take-a-big-compiled-sifakis.md` — active plan
3. `README.md` — phase status table + repo layout
4. `docs/cluster-coverage-fix-plan.md` — context on the runaway fix shipped today
5. `docs/r2-setup-runbook.md` — domain + GA4 + GSC setup (with R5 deferral notes)
6. `docs/template-design-brief.md` — variant + brand spec
7. `apps/site-host/SEO_CHECKLIST.md` — standing SEO audit checklist
8. `AGENTS.md` — agent team index

### Env

- `.env.local` lives at repo root: `/Users/mikebayard/Claude/LeadLandlord/.env.local`
- Worktree subdirs auto-find it via `findEnvFile()` walk-up in `next.config.ts`
- For `pnpm tsx scripts/...` from a worktree, copy `.env.local` to that worktree root first (or symlink)
- All sensitive keys in Vercel are encrypted (write-only post-add)

### Operator dashboard

- `https://leadlandlord-operator.vercel.app/operator` (auth-gated by `OPERATOR_PASSWORD`)
- Master kill switch: `/operator` master panel — flips `system_state.kill_switch` to `true` → BaseAgent refuses to start any new run
- Current state: kill switch `false` (off), Foundation Repair build just succeeded

### Useful scripts

```bash
# Audit recent spend across agents (last 72h)
pnpm tsx scripts/audit-recent-spend.ts

# Cleanup a failed/dead site (Sanity + Postgres + reset niche to pending)
pnpm tsx scripts/cleanup-dead-site.ts <site-uuid>

# List all sites in DB + Sanity
pnpm tsx scripts/list-sites.ts

# Plant GSC TXT verification on a domain (R5 prereq)
pnpm tsx scripts/verify-search-console.ts <domain> '<google-site-verification=...>'

# End-to-end build (manual, bypasses event queue) — used for testing
pnpm dry-run --niche "<niche>" --city "<city>" --state "<XX>"
```

### Common monitoring queries (DB)

```sql
-- Active runs in last 5 min
SELECT agent, status, started_at, progress_message, cost_usd
FROM agent_runs
WHERE started_at > now() - interval '5 minutes'
ORDER BY started_at DESC;

-- Pending events (operator-tick will claim within ~60s)
SELECT type, target_agent, attempts, created_at
FROM agent_events
WHERE processed_at IS NULL AND dead_lettered_at IS NULL;

-- Today's spend per agent
SELECT agent, daily_cost_cap_usd, spent_today_usd, enabled
FROM agent_budgets;

-- Kill switch state
SELECT kill_switch, kill_switch_reason, kill_switch_activated_at FROM system_state;
```

---

## What NOT to do

- **Don't enable Anthropic `strict: true`** on tool definitions until the ContentBundle Zod schema is audited — current `.optional()` fields would fail strict mode validation.
- **Don't bump `@anthropic-ai/sdk`** version unless absolutely necessary — current pin is stable.
- **Don't add Twilio A2P / Stripe / outbound SMS / AI voice** — all deferred per active plan, MVP scope is locked.
- **Don't create a new operator Vercel project** — there are exactly two: `leadlandlord-operator` and `leadlandlord-sites`.
- **Don't bypass kill switch + budget caps** — `RUNTIME_MAX_ATTEMPTS=5` cap saved us from $135 May 7 runaway.
- **Don't touch the `niches/*.md` overlay files content** — they're correct as-is; they just need to be loaded (Fix 1.6).

---

## First moves for the next session

Recommended in order:

1. **Read this file end-to-end + the active plan** (~10 min)
2. **Skim recent commits:** `git log --oneline -20` to ground yourself in what just shipped
3. **Confirm live state:** open `/operator/sites` in browser, see foundation-repair-austin-tx and junk-removal-vegas.com both `warming`
4. **Decide path:**
   - **Path A (revenue track):** ship Fix 1.6 (overlay bundling), then deploy first batch of R3 fleet expansion (Modern + Premium + Bright sites)
   - **Path B (R4 track):** start citation autopilot for the 2 existing tenants
   - **Path C (cleanup):** merge open PRs #31 + #32, prune old failed agent_runs

Default recommendation: **A** — the overlay bundling is a 30-min fix that improves every future build, then fleet expansion is the highest-leverage activity per the revenue-first plan.

---

**Anything else the next agent needs comes from reading the plan + this doc + recent commits. Don't ask the operator to re-explain context that's documented.**
