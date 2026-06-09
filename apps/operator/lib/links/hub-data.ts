/**
 * Server-side data helpers for /operator/links hub page.
 * Two separate queries (prospects, backlinks) — no mega-join.
 */

import { desc, eq, inArray, and } from 'drizzle-orm';
import {
  getDb,
  backlinks,
  backlinkProspects,
  sites,
  agentBudgets,
  agentRuns,
  emailSends,
  type Backlink,
  type BacklinkProspect,
  type Site,
} from '@leadlandlord/db';
import {
  prospectStage,
  backlinkStage,
  ageInDays,
  type UIStage,
  type ProspectStatus,
  type BacklinkStatus,
} from './stages';

export interface StageCounts {
  Scouted: number;
  'Needs review': number;
  Pitching: number;
  Response: number;
  'Draft review': number;
  'In flight': number;
  Done: number;
  Dead: number;
}

export interface WorkstreamHealth {
  running: boolean;
  /** ISO string of last molly-scorer run, or null */
  lastScorerRunAt: string | null;
  /** Count of pitch emails sent this week (purpose like molly-pitch) */
  pitchesThisWeek: number;
}

export interface NeedsYou {
  prospectReviewCount: number;
  draftReviewCount: number;
  escalations: Array<{
    id: string;
    sourceDomain: string;
    status: string;
    responseSnippet: string | null;
    siteLabel: string;
  }>;
}

export interface InFlightGroup {
  siteId: string;
  siteLabel: string;
  citationLive: number;
  citationTotal: number;
  rows: InFlightRow[];
}

export interface InFlightRow {
  id: string;
  kind: 'backlink' | 'prospect';
  sourceDomain: string;
  status: string;
  stage: UIStage;
  ageInStageDays: number;
  lastEventLabel: string | null;
  isDraftReview: boolean;
  isEscalated: boolean;
  draftLink: string | null;
}

export interface CitationSiteGroup {
  siteId: string;
  siteLabel: string;
  rows: Array<{
    id: string;
    sourceDomain: string;
    status: string;
    submitUrl: string | null;
  }>;
}

export async function loadWorkstreamHealth(): Promise<WorkstreamHealth> {
  const db = getDb();

  const [scorerBudget, lastScorerRun] = await Promise.all([
    db
      .select({ enabled: agentBudgets.enabled })
      .from(agentBudgets)
      .where(eq(agentBudgets.agent, 'molly-scorer'))
      .limit(1),

    db
      .select({ endedAt: agentRuns.endedAt })
      .from(agentRuns)
      .where(and(eq(agentRuns.agent, 'molly-scorer'), eq(agentRuns.status, 'succeeded')))
      .orderBy(desc(agentRuns.startedAt))
      .limit(1),
  ]);

  const weekAgo = new Date(Date.now() - 7 * 86400000);
  // Do a targeted count query with sentAt available for week filtering.
  const pitchCountRows = await db
    .select({ id: emailSends.id, sentAt: emailSends.sentAt })
    .from(emailSends)
    .where(eq(emailSends.purpose, 'molly-pitch'))
    .orderBy(desc(emailSends.sentAt))
    .limit(200);

  const weekPitches = pitchCountRows.filter(
    (r) => r.sentAt && new Date(r.sentAt) >= weekAgo,
  ).length;

  return {
    running: scorerBudget[0]?.enabled ?? true,
    lastScorerRunAt:
      lastScorerRun[0]?.endedAt instanceof Date
        ? lastScorerRun[0].endedAt.toISOString()
        : typeof lastScorerRun[0]?.endedAt === 'string'
        ? lastScorerRun[0].endedAt
        : null,
    pitchesThisWeek: weekPitches,
  };
}

export async function loadStageCounts(): Promise<StageCounts> {
  const db = getDb();

  const [prospectRows, backlinkRows] = await Promise.all([
    db
      .select({ status: backlinkProspects.status })
      .from(backlinkProspects)
      .limit(2000),
    db
      .select({ status: backlinks.status, type: backlinks.type })
      .from(backlinks)
      .limit(2000),
  ]);

  const counts: StageCounts = {
    Scouted: 0,
    'Needs review': 0,
    Pitching: 0,
    Response: 0,
    'Draft review': 0,
    'In flight': 0,
    Done: 0,
    Dead: 0,
  };

  for (const r of prospectRows) {
    const stage = prospectStage(r.status as ProspectStatus);
    counts[stage] += 1; // ProspectStatus enum has no Dead-mapped values
  }

  for (const r of backlinkRows) {
    if (r.type === 'citation' || r.type === 'directory') continue; // citations excluded from funnel
    const stage = backlinkStage(r.status as BacklinkStatus);
    counts[stage] += 1;
  }

  return counts;
}

export async function loadNeedsYou(siteMap: Map<string, Site>): Promise<NeedsYou> {
  const db = getDb();

  const [flagged, drafts, escalated] = await Promise.all([
    // Prospects needing review (flagged_top5, not snoozed)
    db
      .select({ id: backlinkProspects.id, metadata: backlinkProspects.metadata })
      .from(backlinkProspects)
      .where(eq(backlinkProspects.status, 'flagged_top5'))
      .limit(100),

    // Drafts pending review
    db
      .select({ id: backlinks.id })
      .from(backlinks)
      .where(eq(backlinks.status, 'draft_pending_review'))
      .limit(100),

    // Escalations
    db
      .select({
        id: backlinks.id,
        sourceDomain: backlinks.sourceDomain,
        status: backlinks.status,
        siteId: backlinks.siteId,
        metadata: backlinks.metadata,
      })
      .from(backlinks)
      .where(inArray(backlinks.status, ['escalated', 'manual_review']))
      .limit(3),
  ]);

  // Filter out snoozed prospects
  const now = new Date();
  const notSnoozed = flagged.filter((r) => {
    const md = (r.metadata ?? {}) as Record<string, unknown>;
    const snoozedUntil = typeof md.snoozedUntil === 'string' ? new Date(md.snoozedUntil) : null;
    return !snoozedUntil || snoozedUntil <= now;
  });

  return {
    prospectReviewCount: notSnoozed.length,
    draftReviewCount: drafts.length,
    escalations: escalated.map((r) => {
      const md = (r.metadata ?? {}) as Record<string, unknown>;
      const snippet =
        typeof md.responseSnippet === 'string' ? md.responseSnippet.slice(0, 120) : null;
      const site = siteMap.get(r.siteId);
      const siteLabel = site ? `${site.niche} — ${site.city}, ${site.state}` : r.siteId.slice(0, 8);
      return {
        id: r.id,
        sourceDomain: r.sourceDomain,
        status: r.status,
        responseSnippet: snippet,
        siteLabel,
      };
    }),
  };
}

export async function loadInFlightGroups(siteMap: Map<string, Site>): Promise<InFlightGroup[]> {
  const db = getDb();

  const IN_FLIGHT_PROSPECT_STATUSES: ProspectStatus[] = ['approved', 'pitched'];
  const IN_FLIGHT_BL_STATUSES: BacklinkStatus[] = [
    'pending',
    'submitted',
    'awaiting_reply',
    'reply_received',
    'accepted',
    'drafting',
    'escalated',
    'manual_review',
    'draft_pending_review',
    'draft_approved',
    'delivered',
  ];

  const [prospectRows, backlinkRows] = await Promise.all([
    db
      .select()
      .from(backlinkProspects)
      .where(inArray(backlinkProspects.status, IN_FLIGHT_PROSPECT_STATUSES))
      .orderBy(desc(backlinkProspects.updatedAt))
      .limit(500),

    db
      .select()
      .from(backlinks)
      .where(
        and(
          inArray(backlinks.status, IN_FLIGHT_BL_STATUSES),
          inArray(backlinks.type, ['guest_post']),
        ),
      )
      .orderBy(desc(backlinks.createdAt))
      .limit(500),
  ]);

  // Citation counts per site
  const citationRows = await db
    .select({ siteId: backlinks.siteId, status: backlinks.status })
    .from(backlinks)
    .where(inArray(backlinks.type, ['citation', 'directory']))
    .limit(1000);

  const citationBySite = new Map<string, { live: number; total: number }>();
  for (const r of citationRows) {
    const entry = citationBySite.get(r.siteId) ?? { live: 0, total: 0 };
    entry.total += 1;
    if (r.status === 'live' || r.status === 'verified' || r.status === 'published') {
      entry.live += 1;
    }
    citationBySite.set(r.siteId, entry);
  }

  // Group by site
  const grouped = new Map<string, InFlightRow[]>();

  for (const r of backlinkRows) {
    const md = (r.metadata ?? {}) as Record<string, unknown>;
    const stage = backlinkStage(r.status as BacklinkStatus);
    const age = ageInDays(r.createdAt);

    let lastEvent: string | null = null;
    if (r.nudgeCount > 0 && r.lastNudgeAt) {
      lastEvent = `nudged ${ageInDays(r.lastNudgeAt)}d ago`;
    } else if (typeof md.responseSnippet === 'string') {
      lastEvent = 'reply received';
    } else if (typeof md.draftWordCount === 'number') {
      lastEvent = `draft ${md.draftWordCount} words`;
    }

    const row: InFlightRow = {
      id: r.id,
      kind: 'backlink',
      sourceDomain: r.sourceDomain,
      status: r.status,
      stage,
      ageInStageDays: age,
      lastEventLabel: lastEvent,
      isDraftReview: r.status === 'draft_pending_review',
      isEscalated: r.status === 'escalated' || r.status === 'manual_review',
      draftLink:
        r.status === 'draft_pending_review' || r.status === 'draft_approved' || r.status === 'accepted'
          ? `/operator/links/${r.id}/draft`
          : null,
    };

    const arr = grouped.get(r.siteId) ?? [];
    arr.push(row);
    grouped.set(r.siteId, arr);
  }

  for (const r of prospectRows) {
    const stage = prospectStage(r.status as ProspectStatus);
    const age = ageInDays(r.updatedAt ?? r.createdAt);
    const row: InFlightRow = {
      id: r.id,
      kind: 'prospect',
      sourceDomain: r.domain,
      status: r.status,
      stage,
      ageInStageDays: age,
      lastEventLabel: null,
      isDraftReview: false,
      isEscalated: false,
      draftLink: null,
    };
    const arr = grouped.get(r.siteId) ?? [];
    arr.push(row);
    grouped.set(r.siteId, arr);
  }

  // Sort each group: needs-you first
  const result: InFlightGroup[] = [];
  for (const [siteId, rows] of grouped) {
    const site = siteMap.get(siteId);
    const siteLabel = site
      ? `${site.niche} — ${site.city}, ${site.state}`
      : siteId.slice(0, 8);

    const cit = citationBySite.get(siteId) ?? { live: 0, total: 0 };

    const sorted = [...rows].sort((a, b) => {
      const aNeedsYou = a.isDraftReview || a.isEscalated ? 1 : 0;
      const bNeedsYou = b.isDraftReview || b.isEscalated ? 1 : 0;
      return bNeedsYou - aNeedsYou || b.ageInStageDays - a.ageInStageDays;
    });

    result.push({
      siteId,
      siteLabel,
      citationLive: cit.live,
      citationTotal: cit.total,
      rows: sorted,
    });
  }

  // Sites with needs-you items sort first
  result.sort((a, b) => {
    const aNeedsYou = a.rows.some((r) => r.isDraftReview || r.isEscalated) ? 1 : 0;
    const bNeedsYou = b.rows.some((r) => r.isDraftReview || r.isEscalated) ? 1 : 0;
    return bNeedsYou - aNeedsYou;
  });

  return result;
}

export async function loadCitationGroups(siteMap: Map<string, Site>): Promise<CitationSiteGroup[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(backlinks)
    .where(inArray(backlinks.type, ['citation', 'directory']))
    .orderBy(desc(backlinks.createdAt))
    .limit(1000);

  const grouped = new Map<string, CitationSiteGroup>();
  for (const r of rows) {
    const site = siteMap.get(r.siteId);
    const siteLabel = site
      ? `${site.niche} — ${site.city}, ${site.state}`
      : r.siteId.slice(0, 8);

    if (!grouped.has(r.siteId)) {
      grouped.set(r.siteId, { siteId: r.siteId, siteLabel, rows: [] });
    }
    const md = (r.metadata ?? {}) as Record<string, unknown>;
    const submitUrl = typeof md.submitUrl === 'string' ? md.submitUrl : null;
    grouped.get(r.siteId)!.rows.push({
      id: r.id,
      sourceDomain: r.sourceDomain,
      status: r.status,
      submitUrl,
    });
  }

  return Array.from(grouped.values());
}

export async function loadAllSites(): Promise<Map<string, Site>> {
  const db = getDb();
  const rows = await db.select().from(sites).limit(500);
  return new Map(rows.map((s) => [s.id, s]));
}

export async function loadProspectPool(): Promise<
  Array<BacklinkProspect & { siteLabel: string }>
> {
  const db = getDb();
  const [rows, allSites] = await Promise.all([
    db
      .select()
      .from(backlinkProspects)
      .orderBy(desc(backlinkProspects.updatedAt))
      .limit(500),
    db.select({ id: sites.id, niche: sites.niche, city: sites.city, state: sites.state }).from(sites),
  ]);
  const siteMap = new Map(allSites.map((s) => [s.id, s]));
  return rows.map((r) => {
    const site = siteMap.get(r.siteId);
    const siteLabel = site
      ? `${site.niche} — ${site.city}, ${site.state}`
      : r.siteId.slice(0, 8);
    return { ...r, siteLabel };
  });
}

export async function loadRecentEmailSends() {
  const db = getDb();
  return db
    .select()
    .from(emailSends)
    .orderBy(desc(emailSends.sentAt))
    .limit(50);
}
