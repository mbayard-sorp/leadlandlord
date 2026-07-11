import { SiteBuilder } from './site-builder/index';
import { ContentEngine } from './content-engine/index';
import { TrackingSetup } from './tracking-setup/index';
import { NicheScout } from './niche-hunter/scout';
import { NicheValidator } from './niche-hunter/validator';
import { NicheKeywordRefresher } from './niche-hunter/refresher';
import { KeywordPlanner } from './keyword-planner/index';
import { DomainProcurer } from './domain-procurer/index';
import { SeoOperator } from './seo-operator/index';
import { SeoIngestGsc } from './seo-ingest-gsc/index';
import { SeoIngestGa4 } from './seo-ingest-ga4/index';
import { LighthouseAudit } from './lighthouse-audit/index';
import { TenantProspector } from './tenant-prospector/index';
import { OutreachAgent } from './outreach-agent/index';
import { TrialManager } from './trial-manager/index';
import { CloserAgent } from './closer-agent/index';
import { BillingDunning } from './billing-dunning/index';
import { ChurnRecovery } from './churn-recovery/index';
import { PortfolioAnalyst } from './portfolio-analyst/index';
import { NicheCalibrator } from './niche-calibrator/index';
import { NichePriorSuggester } from './niche-prior-suggester/index';
import { MaintenanceAgent } from './maintenance/index';
import { ComplianceGuard } from './compliance-guard/index';
import { CallClassifier } from './call-classifier/index';
import { LeadQualifier } from './lead-qualifier/index';
import { Operator } from './operator/index';
import { MollyScorer } from './molly-scorer/index';
import { MollyDigest } from './molly-digest/index';
import { MollyInbox } from './molly-inbox/index';
import { MollyCopywriter } from './molly-copywriter/index';
import { NetworkLinker } from './network-linker/index';
import { WaveLauncher } from './wave-launcher/index';
import { LocalContentScout } from './local-content-scout/index';
import { LocalContentWriter } from './local-content-writer/index';
import { IndexNowSubmitter } from './indexnow-submitter/index';
import { CompetitorAnalyzer } from './competitor-analyzer/index';
import { GeoAeoAuditor } from './geo-aeo-auditor/index';
import { LocalSeoOptimizer } from './local-seo-optimizer/index';
import { NetworkMetricsAggregator } from './network-metrics-aggregator/index';
import { ContentDataAuditor } from './content-data-auditor/index';
import { DataInputsScaffolder } from './data-inputs-scaffolder/index';
import { FleetDigest } from './fleet-digest/index';
import { CitationRunner } from './citation-runner/index';
import { Molly } from './molly/index';
import { SpecSiteBuilder } from './spec-site-builder/index';
import { ContentMigrator } from './content-migrator/index';
import { BuildsellReviewRefresh } from './buildsell-review-refresh/index';
import type { BaseAgent } from './base';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyAgent = BaseAgent<any, any>;

export const agentRegistry: Record<string, () => AnyAgent> = {
  'site-builder': () => new SiteBuilder(),
  'content-engine': () => new ContentEngine(),
  'tracking-setup': () => new TrackingSetup(),
  'niche-scout': () => new NicheScout(),
  'niche-validator': () => new NicheValidator(),
  'niche-keyword-refresher': () => new NicheKeywordRefresher(),
  'keyword-planner': () => new KeywordPlanner(),
  'domain-procurer': () => new DomainProcurer(),
  'seo-operator': () => new SeoOperator(),
  'seo-ingest-gsc': () => new SeoIngestGsc(),
  'seo-ingest-ga4': () => new SeoIngestGa4(),
  'lighthouse-audit': () => new LighthouseAudit(),
  'tenant-prospector': () => new TenantProspector(),
  'outreach-agent': () => new OutreachAgent(),
  'trial-manager': () => new TrialManager(),
  'closer-agent': () => new CloserAgent(),
  'billing-dunning': () => new BillingDunning(),
  'churn-recovery': () => new ChurnRecovery(),
  'portfolio-analyst': () => new PortfolioAnalyst(),
  // Niche calibration feedback loop (Phase 2): measures GSC/portfolio outcomes
  // against scout/validate predictions, then surfaces data-derived prior
  // suggestions. See docs/adr/0027-niche-calibration-feedback-loop.md.
  'niche-calibrator': () => new NicheCalibrator(),
  'niche-prior-suggester': () => new NichePriorSuggester(),
  maintenance: () => new MaintenanceAgent(),
  'compliance-guard': () => new ComplianceGuard(),
  'call-classifier': () => new CallClassifier(),
  'lead-qualifier': () => new LeadQualifier(),
  operator: () => new Operator(),
  'molly-scorer': () => new MollyScorer(),
  'molly-digest': () => new MollyDigest(),
  'molly-inbox': () => new MollyInbox(),
  'molly-copywriter': () => new MollyCopywriter(),
  'network-linker': () => new NetworkLinker(),
  'wave-launcher': () => new WaveLauncher(),
  'local-content-scout': () => new LocalContentScout(),
  'local-content-writer': () => new LocalContentWriter(),
  'indexnow-submitter': () => new IndexNowSubmitter(),
  'competitor-analyzer': () => new CompetitorAnalyzer(),
  'geo-aeo-auditor': () => new GeoAeoAuditor(),
  'local-seo-optimizer': () => new LocalSeoOptimizer(),
  'network-metrics-aggregator': () => new NetworkMetricsAggregator(),
  'content-data-auditor': () => new ContentDataAuditor(),
  'data-inputs-scaffolder': () => new DataInputsScaffolder(),
  'fleet-digest': () => new FleetDigest(),
  'citation-runner': () => new CitationRunner(),
  molly: () => new Molly(),
  // Build & Sell — its own queue lane (targetAgent:'spec-site-builder'),
  // fully separate from R&R's 'site-builder'.
  'spec-site-builder': () => new SpecSiteBuilder(),
  // Build & Sell content migration: crawls a prospect's existing site and
  // stages operator-reviewable suggestions (never touches the live doc).
  'content-migrator': () => new ContentMigrator(),
  // Build & Sell monthly review refresh: re-pulls the aggregate Google rating +
  // review count for non-draft sites (no verbatim review text — ADR 0025 D5).
  'buildsell-review-refresh': () => new BuildsellReviewRefresh(),
  // NOTE: the `orchestrator` agent (packages/agents/src/orchestrator/brain.ts)
  // is intentionally NOT registered here. The registry feeds the cron worker
  // (/api/cron/agent/[name]); registering it would make the chat brain firable
  // via an arbitrary HTTP POST. It is instead instantiated directly by the
  // operator chat server action in response to a human message. It still has an
  // agent_budgets row ($5 cap) via FLEET_DISPOSITION + the seed script. See ADR 0019.
};

export function getAgent(name: string): AnyAgent {
  const factory = agentRegistry[name];
  if (!factory) throw new Error(`Unknown agent: ${name}`);
  return factory();
}
