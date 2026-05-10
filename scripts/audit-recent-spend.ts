import { config } from 'dotenv';
config({ path: '.env.local' });
import { getDb } from '@leadlandlord/db';
import { sql } from 'drizzle-orm';

async function main() {
  const db = getDb();

  // Last 72h of agent_runs cost — group by agent + day
  console.log('=== Spend by agent, last 72h ===');
  const byAgent = await db.execute(sql`
    select
      agent,
      date_trunc('day', started_at) as day,
      count(*) as runs,
      sum(coalesce(cost_usd, 0))::numeric(10,4) as total_usd,
      sum(coalesce(tokens_in, 0)) as in_tokens,
      sum(coalesce(tokens_out, 0)) as out_tokens
    from agent_runs
    where started_at > now() - interval '72 hours'
    group by agent, day
    order by day desc, total_usd desc nulls last
    limit 40;
  `);
  console.table(byAgent.rows ?? byAgent);

  // Top 10 most expensive single runs in last 72h
  console.log('\n=== Top 10 single runs by cost, last 72h ===');
  const topRuns = await db.execute(sql`
    select
      id,
      agent,
      status,
      started_at,
      coalesce(cost_usd, 0)::numeric(10,4) as cost_usd,
      coalesce(tokens_in, 0) as in_tok,
      coalesce(tokens_out, 0) as out_tok,
      dedupe_key
    from agent_runs
    where started_at > now() - interval '72 hours'
    order by cost_usd desc nulls last
    limit 10;
  `);
  console.table(topRuns.rows ?? topRuns);

  // Failed runs that retried — these are the runaway smell
  console.log('\n=== Failed/retry patterns (same dedupe_key, multiple runs) ===');
  const retries = await db.execute(sql`
    select
      agent,
      dedupe_key,
      count(*) as attempts,
      sum(coalesce(cost_usd, 0))::numeric(10,4) as total_usd,
      string_agg(distinct status::text, ',') as statuses
    from agent_runs
    where started_at > now() - interval '72 hours'
      and dedupe_key is not null
    group by agent, dedupe_key
    having count(*) > 1
    order by total_usd desc nulls last
    limit 15;
  `);
  console.table(retries.rows ?? retries);

  // Current budget caps + spend
  console.log('\n=== Current agent_budgets ===');
  const budgets = await db.execute(sql`
    select agent,
           daily_cost_cap_usd::numeric(10,2)  as daily_cap,
           weekly_cost_cap_usd::numeric(10,2) as weekly_cap,
           monthly_cost_cap_usd::numeric(10,2) as monthly_cap,
           spent_today_usd::numeric(10,4)     as today,
           spent_this_month_usd::numeric(10,4) as month,
           enabled
    from agent_budgets
    order by agent;
  `);
  console.table(budgets.rows ?? budgets);

  console.log('\n=== Operator state (kill switch + mode) ===');
  const op = await db.execute(sql`select kill_switch, kill_switch_reason, kill_switch_activated_at, mode, operator_enabled from operator_state limit 1`);
  console.table(op.rows ?? op);

  console.log('\n=== Pending agent_events (queue depth) ===');
  const ev = await db.execute(sql`
    select type, target_agent, status, count(*)::int as n
    from agent_events
    where status in ('pending','claimed')
    group by 1,2,3 order by 1;
  `);
  console.table(ev.rows ?? ev);
}

main().catch((e) => { console.error(e); process.exit(1); });
