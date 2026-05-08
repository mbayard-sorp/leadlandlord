import { SiteBuilder } from './site-builder/index';
import { ContentEngine } from './content-engine/index';
import { TrackingSetup } from './tracking-setup/index';
import { NicheHunter } from './niche-hunter/index';
import { KeywordPlanner } from './keyword-planner/index';
import { DomainProcurer } from './domain-procurer/index';
import { SeoOperator } from './seo-operator/index';
import { SeoIngestGsc } from './seo-ingest-gsc/index';
import { SeoIngestGa4 } from './seo-ingest-ga4/index';
import { LighthouseAudit } from './lighthouse-audit/index';
import { BacklinkBuilder } from './backlink-builder/index';
import { TenantProspector } from './tenant-prospector/index';
import { OutreachAgent } from './outreach-agent/index';
import { TrialManager } from './trial-manager/index';
import { CloserAgent } from './closer-agent/index';
import { BillingDunning } from './billing-dunning/index';
import { ChurnRecovery } from './churn-recovery/index';
import { PortfolioAnalyst } from './portfolio-analyst/index';
import { MaintenanceAgent } from './maintenance/index';
import { ComplianceGuard } from './compliance-guard/index';
import { CallClassifier } from './call-classifier/index';
import { Operator } from './operator/index';
import type { BaseAgent } from './base';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyAgent = BaseAgent<any, any>;

export const agentRegistry: Record<string, () => AnyAgent> = {
  'site-builder': () => new SiteBuilder(),
  'content-engine': () => new ContentEngine(),
  'tracking-setup': () => new TrackingSetup(),
  'niche-hunter': () => new NicheHunter(),
  'keyword-planner': () => new KeywordPlanner(),
  'domain-procurer': () => new DomainProcurer(),
  'seo-operator': () => new SeoOperator(),
  'seo-ingest-gsc': () => new SeoIngestGsc(),
  'seo-ingest-ga4': () => new SeoIngestGa4(),
  'lighthouse-audit': () => new LighthouseAudit(),
  'backlink-builder': () => new BacklinkBuilder(),
  'tenant-prospector': () => new TenantProspector(),
  'outreach-agent': () => new OutreachAgent(),
  'trial-manager': () => new TrialManager(),
  'closer-agent': () => new CloserAgent(),
  'billing-dunning': () => new BillingDunning(),
  'churn-recovery': () => new ChurnRecovery(),
  'portfolio-analyst': () => new PortfolioAnalyst(),
  maintenance: () => new MaintenanceAgent(),
  'compliance-guard': () => new ComplianceGuard(),
  'call-classifier': () => new CallClassifier(),
  operator: () => new Operator(),
};

export function getAgent(name: string): AnyAgent {
  const factory = agentRegistry[name];
  if (!factory) throw new Error(`Unknown agent: ${name}`);
  return factory();
}
