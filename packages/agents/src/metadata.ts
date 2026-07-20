export interface AgentMeta {
  /** One-line summary of what the agent does, shown in the operator UI. */
  description: string;
  /**
   * Human-readable trigger for agents that are NOT cron-scheduled in
   * apps/operator/vercel.json (event-driven or on-demand). Cron-scheduled
   * agents derive their cadence from vercel.json at render time, so this is
   * left undefined for them.
   */
  trigger?: string;
}

/**
 * Display metadata for every agent in `agentRegistry`, keyed by registry name.
 * Descriptions are authored here; cron cadence is derived from vercel.json by
 * the operator agents page so it never drifts from the deployed schedule.
 */
export const agentMetadata: Record<string, AgentMeta> = {
  'site-builder': {
    description: 'Orchestrates building a tenant site: keyword plan, content, Sanity docs, and deploy.',
    trigger: 'Event-driven (niche approved)',
  },
  'content-engine': {
    description: 'Generates the page content bundle — copy, FAQs, info pages — for a site via Claude.',
    trigger: 'Event-driven (cluster ready)',
  },
  'tracking-setup': {
    description: 'Provisions a Twilio tracking number and wires call forwarding for a site.',
    trigger: 'Event-driven (during site build)',
  },
  'competitor-analyzer': {
    description: 'Scrapes top SERP competitors and synthesizes an abstracted competitive brief (topics, gaps, schema) via Claude.',
    trigger: 'Event-driven (during site build)',
  },
  'niche-scout': {
    description: 'Scores the full trade × city grid from cached keyword clusters and static benchmarks, ranking by expected monthly value.',
    trigger: 'On demand (operator)',
  },
  'niche-validator': {
    description: 'Validates top scouted candidates with live DataForSEO data and promotes them into the niche review queue.',
    trigger: 'On demand (operator)',
  },
  'niche-keyword-refresher': {
    description: 'Quarterly warm of the per-trade keyword-cluster cache so scouts stay near-zero cost.',
  },
  'niche-calibrator': {
    description:
      "Compares one site's weekly GSC/portfolio outcomes against the scout/validate engine's predicted priors and snapshots the delta.",
  },
  'niche-prior-suggester': {
    description:
      'Pools calibrator snapshots by trade and trade+state to propose shrinkage-adjusted CTR/call-rate prior updates for the scout.',
  },
  'keyword-planner': {
    description: 'Pulls DataForSEO keywords and clusters them into page-mapped clusters for a site.',
    trigger: 'Event-driven (niche approved)',
  },
  'domain-procurer': {
    description: 'Searches Namecheap for domain candidates and registers an approved domain.',
    trigger: 'On demand (operator)',
  },
  'seo-operator': {
    description: 'Reviews GSC/GA4/Lighthouse data and applies low-risk SEO recommendations.',
  },
  'geo-aeo-auditor': {
    description: 'Scores a site on GEO/AEO answer-engine readiness (llms.txt, schema, entity consistency) and applies low-risk fixes.',
  },
  'local-seo-optimizer': {
    description: 'Scans GSC + network metrics for local-SEO gaps (service-area coverage, keyword drift, local schema) and applies low-risk fixes.',
  },
  'seo-ingest-gsc': {
    description: 'Pulls one day of Google Search Console metrics into seo_metrics_daily.',
  },
  'seo-ingest-ga4': {
    description: 'Pulls one day of GA4 traffic metrics into ga4_metrics_daily.',
  },
  'lighthouse-audit': {
    description: 'Runs PageSpeed Insights against a site URL and stores scores + web vitals.',
  },
  'indexnow-submitter': {
    description: 'Pings Bing + Brave via IndexNow when a site goes live or its content changes, so it enters the indexes LLM search retrieves from.',
    trigger: 'Event-driven (site activated / content updated)',
  },
  'tenant-prospector': {
    description: 'Finds local businesses to prospect as tenants via Google Places + Apollo.',
  },
  'outreach-agent': {
    description: 'Runs one cold-outreach step (SMS / email / voice) against one prospect.',
  },
  'trial-manager': {
    description: 'Orchestrates the free trial week: starts forwarding, tracks calls, ends the trial.',
  },
  'closer-agent': {
    description: 'Closes a trial: computes rent, sends a Stripe checkout link, places a voice call.',
    trigger: 'Event-driven (trial end)',
  },
  'billing-dunning': {
    description: 'Runs the 7-day failed-payment recovery sequence (SMS / email / voice).',
  },
  'churn-recovery': {
    description: 'On churn, refills the prospect pool and restarts outreach for the freed site.',
  },
  'portfolio-analyst': {
    description: "Daily roll-up of every site's MRR, costs, leads, and health status.",
  },
  maintenance: {
    description: 'Daily site-health watchdog: SSL, domain expiry, uptime, and more.',
  },
  'compliance-guard': {
    description: 'Runs rule packs (TCPA / CAN-SPAM / suppression) before outreach and content actions.',
    trigger: 'Event-driven (pre-action)',
  },
  'call-classifier': {
    description: 'Classifies an inbound call transcript and estimates its revenue (Haiku).',
    trigger: 'Event-driven (inbound call)',
  },
  'lead-qualifier': {
    description:
      'Qualifies an AI-answered inbound call transcript into score, intent, urgency, job type, and classification (Haiku).',
    trigger: 'Event-driven (ElevenLabs post-call webhook)',
  },
  operator: {
    description: 'Top-level orchestrator: reads global state and dispatches work to the fleet.',
  },
  'fleet-digest': {
    description: "Daily email digest of the fleet's health, spend vs caps, and what needs Mike (pending niches, go-lives, blocked agents).",
  },
  'molly-scorer': {
    description: 'Scores the top backlink-prospect domains for a site (Haiku).',
    trigger: 'Event-driven (backlink prospecting)',
  },
  'molly-digest': {
    description: 'Emails a daily digest of Molly outreach activity to a human reviewer.',
  },
  'molly-inbox': {
    description: "Polls Molly's mailbox, correlates replies to pitches, and advances backlink state.",
  },
  'molly-copywriter': {
    description: "Drafts a guest post once an editor accepts Molly's pitch.",
    trigger: 'Event-driven (pitch accepted)',
  },
  'network-linker': {
    description:
      'Places cross-site links across the network directly (no approval gate); site-host injects them into page MDX at render time.',
  },
  'citation-runner': {
    description: 'Seeds local citation/directory listings for a live site and verifies pasted profile URLs via Firecrawl.',
  },
  'wave-launcher': {
    description:
      'Advances a launch wave through its 7-stage pipeline (no approval gate; conditions-based transitions).',
    trigger: 'Event-driven (wave progression)',
  },
  'local-content-scout': {
    description: 'Proposes locally-relevant seasonal and gap content ideas for tenant sites, guarded against keyword cannibalization.',
  },
  'local-content-writer': {
    description: 'Drafts and publishes an approved local content idea as an info page on the tenant site.',
    trigger: 'Event-driven (content idea approved)',
  },
  'data-inputs-scaffolder': {
    description:
      'Auto-fills empty proprietary-data fields per site (illustrative seeds, DB-derived facts, team attribution); never touches operator-entered data or contrarian takes.',
  },
  'network-metrics-aggregator': {
    description: 'Computes citation-safe metric snapshots (call volume, job-type mix, seasonality) from owned data for data-study pages to cite.',
  },
  'content-data-auditor': {
    description: 'Detects unfilled proprietary-data gaps against measured metrics and stages content-idea + recommendation rows for review.',
  },
  molly: {
    description: 'Guest-post outreach: prospects domains, sends pitches, nudges editors, delivers approved drafts.',
    trigger: 'Event-driven (operator scout button, prospect approval, nudge scheduler, draft approval)',
  },
  'spec-site-builder': {
    description: 'Build & Sell orchestrator: generates a spec site (copy, layout, hero image) and writes it to Sanity for the prospect preview.',
    trigger: 'Event-driven (operator Build & Sell queue)',
  },
  'content-migrator': {
    description: "Crawls a prospect's existing site and stages operator-reviewable content/image suggestions on the draft Build & Sell site.",
    trigger: 'Event-driven (operator migration action)',
  },
  'buildsell-review-refresh': {
    description: "Monthly re-pull of a paid/live Build & Sell site's aggregate Google rating + review count (no verbatim review text).",
  },
};
