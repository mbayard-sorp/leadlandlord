/**
 * Shared types for the Build & Sell portfolio dashboard.
 *
 * Kept in a plain module (NOT the colocated `'use server'` actions.ts) because
 * Next's server-action transform rejects type/const exports from a
 * `'use server'` file — same rationale as the sibling `buildsell/types.ts`.
 */

export type BuildsellStatus =
  | 'draft'
  | 'building'
  | 'invoiced'
  | 'paid'
  | 'live'
  | 'failed';

export type AttentionKind =
  | 'build_failed'
  | 'domain_pending'
  | 'lead_delivery_failed'
  | 'migration_pending'
  | 'invoice_overdue';

/** One "needs attention" flag on a site, derived live from loaded data. */
export interface BsAttentionItem {
  siteId: string;
  businessName: string;
  kind: AttentionKind;
  detail: string;
}

/** Aggregate counters for the KPI row + status funnel. */
export interface BsKpis {
  total: number;
  draft: number;
  building: number;
  invoiced: number;
  paid: number;
  live: number;
  failed: number;
  /** Sum of price_usd across paid+live sites, as a formatted string. */
  totalSoldUsd: string;
  /** Contact-form submissions across all sites in the last 30 days. */
  leads30d: number;
  /** Distinct sites with at least one attention flag. */
  needsAttentionCount: number;
}

/**
 * A non-draft site row, fully serialized (Dates -> ISO strings, numerics ->
 * strings) so it can cross the server/client boundary into the table.
 */
export interface BsPortfolioRow {
  id: string;
  businessName: string;
  trade: string;
  city: string;
  state: string;
  slug: string | null;
  status: BuildsellStatus;
  ownerEmail: string | null;
  priceUsd: string | null;
  themePreset: string | null;
  customDomain: string | null;
  domainStatus: 'none' | 'pending' | 'verified';
  domainAttachedAt: string | null;
  domainVerifiedAt: string | null;
  invoiceSentAt: string | null;
  liveAt: string | null;
  lastBuildError: string | null;
  createdAt: string;
  /** Contact-form submissions for this site (all-time). */
  leadsCount: number;
  /** Submissions whose forward OR klaviyo push failed. */
  leadFailureCount: number;
  /** Active (non-revoked) customer-portal grants. */
  activeAccessCount: number;
  /** Whether the pending-migration blob is awaiting review. */
  migrationPending: boolean;
  /** Sanity draftMode (null when the read failed / doc missing). */
  draftMode: boolean | null;
  /** Sanity themeLocked (null when unknown). */
  themeLocked: boolean | null;
  /** Live preset name from Sanity (may differ from the stale PG column). */
  sanityPreset: string | null;
}
