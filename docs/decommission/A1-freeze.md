# A1: Freeze the platform

Phase A1 of [decommission-plan.md](../decommission-plan.md). Everything here is reversible.

**Goal:** no agent runs, no cron wakeups, no outbound email or purchases. The operator app **stays deployed** until A3, because the karkens and TESS contact forms still post to its `/api/bs/lead` route. That route is not gated by the kill switch or by agent budgets; it validates, inserts into the DB and emails the owner via Resend.

## Step 1: Remove all operator crons (this PR)

- `apps/operator/vercel.json`: `crons` goes from 26 entries to `[]`. When this deploys to production, Vercel unregisters every cron, which stops the 10-minute `tick` that wakes Neon plus all 25 scheduled agents and backups.
- `apps/operator/app/operator/agents/page.tsx`: adds a type annotation so the empty-array JSON import still typechecks. The agents page then shows no cron cadence, which is expected.
- **Rollback:** revert this PR. The full cron list is in git history at tag `pre-decommission-2026-11`.

The site-host project also rebuilds on merge, with no code change on its side.

## Step 2: Kill switch + disable every agent (Mike runs: prod DB)

Run from the main checkout (`/Users/mikebayard/Claude/LeadLandlord`), which has `.env.local` and `node_modules`:

```bash
pnpm exec tsx scripts/system-state.ts on "decommission 2026-11"
```

```bash
pnpm exec tsx scripts/fleet-config.ts set operatorEnabled=false operatorMode=manual autoApproveNiches=false
```

Then disable every agent budget. Run this in the Neon SQL editor, or with `psql "$DATABASE_URL"`:

```sql
UPDATE agent_budgets SET enabled = false;
SELECT count(*) FILTER (WHERE enabled) AS still_enabled, count(*) AS total FROM agent_budgets;
```

Expect `still_enabled = 0`.

The order is deliberate. The kill switch blocks every `BaseAgent.run` and the queue drain immediately. The other two are belt-and-suspenders for the paths the kill switch misses (domain-verifier, alert-evaluator, supervision), which also stop once the crons are gone.

**Rollback:**
- `system-state.ts off`
- `UPDATE agent_budgets SET enabled = true WHERE agent IN (...)`, using the A0 disposition list
- `fleet-config.ts lock`

## Step 3: Hands off the operator's Build & Sell actions

From now until the operator is deleted, **do not click** Regenerate, Rebuild or Detach domain on `/operator/buildsell/*`. Regenerate and rebuild overwrite the live karkens and TESS Sanity docs. Detach unsets `customDomain`, which instantly 404s the site.

## Step 4: 48h soak, then check

| Check | How | Expect |
|---|---|---|
| No agent runs | `SELECT count(*) FROM agent_runs WHERE started_at > now() - interval '48 hours';` | 0 |
| No queue activity | `SELECT count(*) FROM agent_events WHERE created_at > now() - interval '48 hours';` | 0 (`/api/bs/lead` does not enqueue events) |
| Crons gone | Vercel dashboard, then `leadlandlord-operator`, then Settings, then Cron Jobs | empty |
| No outbound mail | Resend dashboard, Emails | only lead notifications (`New inquiry for ...`), if any |
| Neon idle | Neon console, Monitoring | compute suspended except around real lead submissions |
| 3 sites healthy | the section 6 gate in the plan | unchanged from the A0 baseline |

## Not in A1 (moved or done)

- **Domain auto-renew:** Mike already set all R&R domains to do-not-renew in Namecheap. leadslandlord.com and karkens.com must stay on auto-renew.
- **Twilio:** nothing to release. The only number belongs to xdipx (A0).
