# Triage metrics: invocations and thresholds

## Invocations

```bash
pnpm exec tsx scripts/fleet-metrics.ts --window 24h --json   # today's picture
pnpm exec tsx scripts/fleet-metrics.ts --window 7d --json    # baseline
pnpm exec tsx scripts/fleet-metrics.ts --window 7d --agent content-engine  # drill into one agent
```

`NO_DB` on stderr + exit code 2 means no `READONLY_DATABASE_URL` / `DATABASE_URL` in this environment → repo-only mode.

## Thresholds → severity

| Signal | Threshold | Severity |
|---|---|---|
| Agent auto-disabled (`agent_budgets.enabled=false` set by supervisor) or `consecutiveFailures >= 3` | any | P1 |
| `consecutiveFailures == 2` (one failure from auto-disable) | any | P2 |
| Dead-lettered `agent_events` | any; `failureKind` validation_error/unknown_agent (code bug) or target in the site-build chain | P2 (P1 if site-build chain) |
| Global daily spend | > $30 (cap is $40, `GLOBAL_DAILY_COST_CAP_START_USD`) | P1 |
| Per-agent budget utilization | ≥ 80% of daily cap | P2 (P1 at breach) |
| Failure rate | > 20% over ≥ 5 runs AND materially above the agent's 7d/30d baseline | P2 |
| Dedupe-skip ratio | > 90% of an agent's runs dedupe-short-circuited for 3+ consecutive days | P2 |
| Stale schedule | cadence exists in vercel.json / agent_schedules but zero runs in window (and not paused) | P2 |
| Cost-per-successful-run | > 2× the agent's 30d baseline without volume explanation | P3 |

## Repo-only mode checks

- `packages/agents/src/registry.ts` vs `metadata.ts` vs `DEPRECATIONS.md` vs `apps/operator/vercel.json` vs `scripts/seed-agent-schedules.ts` — description/status/cadence contradictions.
- New `TODO|FIXME|HACK` in `packages/agents/src` not yet in the backlog.
- `.claude/agents/*.md` frontmatter validity.
