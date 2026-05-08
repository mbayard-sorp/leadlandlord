# Operator Autonomous Runbook (Phase F)

The Operator orchestrator (`packages/agents/src/operator/index.ts`) runs every
10 minutes via `/api/cron/schedule/operator` and dispatches the rest of the
fleet. This runbook covers how to flip it on, what to watch in the first
24 hours, and how to stop it cold if something goes sideways.

## Pre-flight checklist (do before flipping anything)

1. **Per-agent budgets are sane.** Verify `agent_budgets.daily_cost_cap_usd`
   is set for every agent that does meaningful LLM work. The orchestrator
   itself caps at $2/day; downstream agents are gated by their own caps.
   Pull current state:

   ```sql
   SELECT agent, daily_cost_cap_usd, enabled FROM agent_budgets
   ORDER BY agent;
   ```

2. **Kill switch verified working.** Activate from `/operator` (the master
   panel), wait one operator-tick, confirm `agent_runs` shows
   `kill_switch_active` errors, then deactivate. You want muscle memory
   for this BEFORE you need it under stress.

3. **Targets entered on `/operator/control`.** Unset targets default to 0
   which is technically valid but un-actionable. Recommended starter:

   - `targetMrrUsd`: 1.5× current MRR (gives 50% growth headroom)
   - `targetActiveSites`: current sites + 5
   - `targetMonthlyMargin`: 0.30
   - `autoApproveDomainBudgetUsd`: $20 (typical .com renewal ceiling)
   - `autoApproveNiches`: leave OFF for the first 24h

4. **Slack/PagerDuty alert rules enabled.** `alert_rules` should have
   `agent_failure_rate` and `llm_spend_spike` enabled with reasonable
   thresholds. The 24h watch leans on these.

5. **Most recent `portfolio_snapshots` row exists.** The KPI computation
   reads 30-day portfolio rows; an empty `portfolio_snapshots` table
   yields `margin = 0`, which is fine but uninformative.

## Flipping it on (the safe sequence)

Two clicks, in order, on `/operator/control`:

1. **Enable operator.** This sets `operatorEnabled=true`. Mode stays
   `manual` so the agent only computes KPIs and emits a `no_op` for an
   hour while you watch the heartbeat (`lastOperatorRunAt` should
   advance every 10 minutes).

2. **Switch to `supervised`.** The agent now dispatches domain searches
   and pauses runaway agents. Niche/domain auto-approvals stay off.
   Watch for 4-6 hours.

3. **Switch to `autonomous`.** Full decision tree active. The system
   refuses this transition unless `operatorEnabled` is already true.

The `/operator/control` page won't let you skip step 1 → step 3.

## What to watch in the first 24 hours

Open four tabs and refresh on a slow loop:

| Tab | What "good" looks like |
|---|---|
| `/operator/control` recent decisions | mostly `no_op` and `domain_search`; any `pause_agent` should match a real spend spike |
| `/operator/agents` (today stats) | LLM spend tracks within 1.5× of the prior day |
| `/operator/maintenance` | finding count not climbing |
| Slack alert channel | quiet |

Specific things to check at each milestone:

- **+1 hour**: `lastOperatorRunAt` has advanced ~6 times. `agent_runs`
  has six successful operator rows. No `failed`/`budget_exceeded`.
- **+4 hours**: at most one `pause_agent` decision (and only if there's
  actually a runaway). No `niche_approve` decisions yet (we're still
  supervised).
- **+12 hours**: `niche_approve` decisions begin appearing AFTER you
  flip `autoApproveNiches=true` AND mode=autonomous. Each should
  correspond to a `site-builder` event in `agent_events`.
- **+24 hours**: total LLM spend on operator agent < $0.10 (it's
  almost free; the cap is for runaway-loop defense, not budget).

## Rollback procedure

In escalating order of severity:

1. **Soft rollback — operator only.** `/operator/control` → flip
   *Disable operator*. Cron ticks continue but short-circuit to
   `no_op`. Targets and mode are preserved for next time.

2. **Surgical agent pause.** If one downstream agent is misbehaving,
   `UPDATE agent_budgets SET enabled = false WHERE agent = '<name>';`.
   Operator can also do this automatically via the runaway-agent rule.

3. **Hard rollback — kill switch.** `/operator` (the main page) →
   *Activate kill switch*. EVERY agent refuses to run on its next
   dispatch. The operator agent itself also refuses (it goes through
   `BaseAgent.run` like everyone else).

4. **Nuclear — yank the cron.** Remove the
   `/api/cron/schedule/operator` entry from `apps/operator/vercel.json`,
   redeploy. Last-resort lever; the kill switch should be enough.

## Spend caps to set before going autonomous

Recommend (numbers calibrated against current pricing as of phase F):

```sql
-- Run BEFORE flipping autonomous mode.
UPDATE agent_budgets SET daily_cost_cap_usd = '0.50' WHERE agent = 'operator';
UPDATE agent_budgets SET daily_cost_cap_usd = '8.00' WHERE agent = 'site-builder';
UPDATE agent_budgets SET daily_cost_cap_usd = '15.00' WHERE agent = 'content-engine';
UPDATE agent_budgets SET daily_cost_cap_usd = '5.00' WHERE agent = 'outreach-agent';
UPDATE agent_budgets SET daily_cost_cap_usd = '3.00' WHERE agent = 'closer-agent';
UPDATE agent_budgets SET daily_cost_cap_usd = '2.00' WHERE agent = 'portfolio-analyst';
UPDATE agent_budgets SET daily_cost_cap_usd = '2.00' WHERE agent = 'maintenance';
```

The runaway-agent rule fires at 1.2× cap, so these are also the
auto-pause thresholds (cap × 1.2).

## Decision-tree priority order (cheat sheet)

1. Pause runaway agent (any mode, any time)
2. Niche approval (autonomous + autoApproveNiches only)
3. Domain search dispatch (any time operator is enabled)
4. Auto-approve domain candidate (autonomous + budget>0 only)
5. Cross-sell adjacent cities (autonomous only)
6. No-op fallback

Each tick emits AT MOST one decision (except domain-search dispatch
which fans out up to 3 sites in one tick). The cron fires every 10
minutes, so the absolute upper bound is ~144 decisions/day — and in
steady state it should be in the single digits.

## Known gotchas

- **Manual mode + autoApproveNiches=true does NOTHING.** The flag only
  activates inside the autonomous branch. Documented behaviour, not a bug.
- **Supervised mode is currently identical to manual w.r.t. niches.**
  Reserved for a future "queue for human review" path. For now it
  differs only in domain-search dispatch (which already runs in any
  enabled mode).
- **Cross-sell needs ≥ 30 days of stable tenant.** Brand new portfolios
  will never trigger this branch — that's intentional.
- **Dedupe by minute bucket.** If you click "run now" twice in the same
  minute you'll get the same cached output. Wait one minute between
  manual triggers.
