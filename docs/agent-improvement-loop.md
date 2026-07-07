# Agent Improvement Loop — Operating Doc

The standing loop that reviews the runtime agent fleet, tightens prompts/rules/cadences, fixes defects, and proposes automation for remaining human-action points. Decision record: [ADR 0027](adr/0027-agent-improvement-loop.md). Durable memory: [improvement-backlog.md](improvement-backlog.md).

Runs as **Claude Code web Routines** (Max-subscription billing) in the managed cloud environment — never on the platform's metered `ANTHROPIC_API_KEY`.

## The team

| Agent | Layer | Role in the loop |
|---|---|---|
| (conductor) | Routine-fired session | git, backlog, PR mechanics, orchestration |
| `fleet-performance-analyst` | `.claude/agents` | read-only telemetry diagnosis → ranked findings |
| `agent-prompt-engineer` | `.claude/agents` | implements prompt/metadata/cadence/budget changes |
| `leadlandlord-architect` | `.claude/agents` | gates T2/T3 changes; ADRs |
| `next-engineer` | `.claude/agents` | app-layer code when a fix crosses out of prompt/config |
| `leadlandlord-qa` | `.claude/agents` | improvement-loop verification mode |
| `leadlandlord-seo-auditor` | `.claude/agents` | spot audit when SEO-affecting prompts change |

## Cadence & stages

- **Daily triage** (`/improvement-triage` skill): sync main → collision check → measure (24h + 7d baseline) → detect vs thresholds → backlog update → ≤1 small draft PR or "all quiet".
- **Weekly cycle** (`/improvement-cycle` skill): measure (7d + 30d) → diagnose → select 1-2 backlog items → architect gate (T2/T3) → implement → QA → ≤2 draft PRs → report with metrics deltas + "Decisions needed from Mike".

Thresholds live in `.claude/skills/improvement-triage/references/queries.md`.

## Telemetry

`pnpm exec tsx scripts/fleet-metrics.ts --window 24h|7d|30d [--json] [--agent <name>]` — SELECT-only, connects via `READONLY_DATABASE_URL` (preferred; read-only Neon role) falling back to `DATABASE_URL`. Neither set → prints `NO_DB`, exit 2, and the loop runs in repo-only consistency mode. This script is the loop's ONLY sanctioned DB path.

## Autonomy tiers

| Tier | Scope | Requirement |
|---|---|---|
| T0 | docs, backlog | self-serve |
| T1 | prompts, metadata, comments, `.claude` defs, skills | self-serve; evidence cited |
| T2 | cron cadences, budgets, seed scripts | architect verdict + stated $ impact |
| T3 | anything touching a human approval gate or agent behavior semantics | decision PR only (docs/ADR asking Mike), `GATE CHANGE` in title; never implemented by the loop |
| — | niche approval gate | permanently human; not even a decision PR |

## PR conventions

- Branches: `improve/triage-<date>` (daily) / `improve/<theme>` (weekly). Titles: `improve: <theme>`. Always **draft**.
- One theme per PR. Caps: 1 PR/triage, 2 PRs/cycle.
- Body template: `.claude/skills/improvement-cycle/references/pr-template.md` (Problem / Evidence / Change / Risk & rollback / Verification / Backlog).
- Collision rules: never commit to non-`improve/*` branches; never touch paths an open PR modifies; no second triage PR while yesterday's is unmerged.

## Routine setup

Create both Routines in a Claude Code web session on this repo's environment **after** the bootstrap PR merges (fresh sessions clone `main`; the skills must exist there). `create_new_session_on_fire: true`. Suggested: daily `0 13 * * *` UTC, weekly `0 14 * * 1` UTC.

### Routine 1 — `leadlandlord-daily-triage` (prompt, verbatim)

```
You are running the LeadLandlord daily fleet triage in the leadlandlord repo (find the repo checkout in this session first).

1. cd into the repo, run `git fetch origin && git checkout main && git pull origin main` so you are on latest main.
2. Invoke the /improvement-triage skill and follow it exactly. It defines the metrics to collect (scripts/fleet-metrics.ts), the anomaly thresholds, how to update docs/improvement-backlog.md, and the PR rules.
3. Ground rules that override everything else: draft PRs only, never push to main, at most ONE PR this session, only branches named improve/*. If READONLY_DATABASE_URL is not set, the metrics script exits with NO_DB — proceed in repo-only mode as the skill describes; do not try to obtain credentials another way. Do not modify runtime agent behavior in triage.
4. If there are no new findings and the backlog is unchanged, open no PR and end with a one-paragraph "all quiet" summary of the fleet numbers you saw.
```

### Routine 2 — `leadlandlord-weekly-improvement-cycle` (prompt, verbatim)

```
You are running the LeadLandlord weekly improvement cycle in the leadlandlord repo (find the repo checkout in this session first).

1. cd into the repo, run `git fetch origin && git checkout main && git pull origin main` so you are on latest main.
2. Invoke the /improvement-cycle skill and follow it exactly. It defines the full loop: measure (scripts/fleet-metrics.ts, 7d window) -> diagnose (delegate to the fleet-performance-analyst subagent) -> select 1-2 items from docs/improvement-backlog.md -> gate via leadlandlord-architect where the skill requires -> implement via agent-prompt-engineer or next-engineer -> QA via leadlandlord-qa -> open draft PRs with the evidence template.
3. Ground rules that override everything else: draft PRs only, never push to main, at most TWO PRs this session, one theme per PR, only branches named improve/*. Never weaken any human approval gate (niches, domains, medium-risk SEO, Molly drafts, go-live) — for those, the only allowed deliverable is a docs/ADR decision PR asking Mike to decide. Skip any backlog item whose files overlap an open PR that isn't yours. If READONLY_DATABASE_URL is not set, run in repo-only mode.
4. End with a summary: metrics deltas vs last week, PRs opened (links), backlog changes, and any decisions you need from Mike.
```

## Token / cost hygiene

- The analyst consumes `fleet-metrics.ts` aggregates, never raw table dumps.
- Skills cap exploration to the agent dirs implicated by findings.
- Subagents are used where `.claude/CLAUDE.md` already mandates them (>20-file reads, wave-wide reviews).
- Rate-limit courtesy: triage is designed to finish in a short session; the deep cycle owns the heavy lifting once a week.
