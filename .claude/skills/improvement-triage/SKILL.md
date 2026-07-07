---
name: improvement-triage
description: Daily fleet triage — pull latest main, run read-only fleet metrics, detect failures / dead letters / budget anomalies / dedupe cascades / stale schedules, update docs/improvement-backlog.md, and open at most one small draft PR. Safe to run with no DB access (repo-only mode). Use for the daily triage Routine or whenever someone asks for a quick fleet health check with follow-through.
---

# Daily improvement triage

You are running LeadLandlord's daily fleet triage. The goal is small and strict: detect anomalies, record them in the backlog, ship at most one tiny draft PR. Deep fixes belong to the weekly `/improvement-cycle`.

## Ground rules (override everything else)

- Draft PRs only. Never push to `main`. Only branches named `improve/*`.
- **At most ONE PR per triage run.** No findings → no PR, no branch.
- Never edit runtime agent behavior in triage. The only code allowed in a triage PR is `docs/improvement-backlog.md` plus at most one Tier-1 fix of ≤5 lines with obvious evidence (e.g. a metadata description contradicting code).
- Never touch a path that an open non-`improve/*` PR modifies.
- The niche approval gate and Phase-6 deferred agents are out of bounds.

## Steps

1. **Sync.** `git fetch origin && git checkout main && git pull origin main`. Operate from fresh `main` only.
2. **Collision check.** List open PRs (GitHub MCP or `gh pr list`). Record: (a) paths touched by open PRs — excluded from today's edits; (b) whether an open `improve/triage-*` PR exists. If yesterday's triage PR is unmerged, do NOT open another — either append new backlog rows to that same branch (only if purely additive) or just report findings in your summary.
3. **Measure.** Delegate to the `fleet-performance-analyst` subagent: run `pnpm exec tsx scripts/fleet-metrics.ts --window 24h` plus a `--window 7d` baseline. If the script exits `NO_DB`, the analyst runs repo-only consistency mode instead — proceed; do not hunt for credentials.
4. **Detect.** Apply the thresholds in [references/queries.md](references/queries.md). Anything at or past a threshold becomes a finding with severity P1/P2/P3.
5. **Backlog update.** Read `docs/improvement-backlog.md`. Dedupe: if a finding matches an existing open item, refresh that item's evidence/status line instead of adding a new row. New findings get the next `BL-###` id, status `proposed`, today's date, and the analyst's evidence.
6. **Ship.** If the backlog changed: branch `improve/triage-<YYYY-MM-DD>`, commit the backlog (plus the one optional Tier-1 micro-fix), push, open a **draft** PR titled `improve: triage <YYYY-MM-DD> — <n> new findings`, body = the findings table with evidence. If nothing changed: no PR — end with a one-paragraph "all quiet" summary of the fleet numbers.
7. **Summary.** End with: fleet numbers for the window, findings added/refreshed, PR link or "all quiet", and anything urgent enough that Mike should look today (P1s).
