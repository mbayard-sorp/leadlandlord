import { SiteBuilder } from './site-builder/index.js';
import { ContentEngine } from './content-engine/index.js';
import { TrackingSetup } from './tracking-setup/index.js';
import { NicheHunter } from './niche-hunter/index.js';
import { DomainProcurer } from './domain-procurer/index.js';
import { SeoOperator } from './seo-operator/index.js';
import { BacklinkBuilder } from './backlink-builder/index.js';
import { TenantProspector } from './tenant-prospector/index.js';
import { OutreachAgent } from './outreach-agent/index.js';
import { TrialManager } from './trial-manager/index.js';
import { CloserAgent } from './closer-agent/index.js';
import { BillingDunning } from './billing-dunning/index.js';
import { ChurnRecovery } from './churn-recovery/index.js';
import { PortfolioAnalyst } from './portfolio-analyst/index.js';
import { ComplianceGuard } from './compliance-guard/index.js';
import { Operator } from './operator/index.js';
import type { BaseAgent } from './base.js';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyAgent = BaseAgent<any, any>;

export const agentRegistry: Record<string, () => AnyAgent> = {
  'site-builder': () => new SiteBuilder(),
  'content-engine': () => new ContentEngine(),
  'tracking-setup': () => new TrackingSetup(),
  'niche-hunter': () => new NicheHunter(),
  'domain-procurer': () => new DomainProcurer(),
  'seo-operator': () => new SeoOperator(),
  'backlink-builder': () => new BacklinkBuilder(),
  'tenant-prospector': () => new TenantProspector(),
  'outreach-agent': () => new OutreachAgent(),
  'trial-manager': () => new TrialManager(),
  'closer-agent': () => new CloserAgent(),
  'billing-dunning': () => new BillingDunning(),
  'churn-recovery': () => new ChurnRecovery(),
  'portfolio-analyst': () => new PortfolioAnalyst(),
  'compliance-guard': () => new ComplianceGuard(),
  operator: () => new Operator(),
};

export function getAgent(name: string): AnyAgent {
  const factory = agentRegistry[name];
  if (!factory) throw new Error(`Unknown agent: ${name}`);
  return factory();
}
