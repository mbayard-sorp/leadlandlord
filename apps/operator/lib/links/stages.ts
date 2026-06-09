/**
 * Stage model — single source of truth mapping DB statuses to UI stages.
 *
 * Two entity types flow through here:
 *   - backlinkProspects (prospects)
 *   - backlinks (guest_post, citation, directory)
 *
 * We never do a mega-join; counts are assembled from two separate queries.
 */

export type UIStage =
  | 'Scouted'
  | 'Needs review'
  | 'Pitching'
  | 'Response'
  | 'Draft review'
  | 'In flight'
  | 'Done'
  | 'Dead';

/** Ordered for funnel strip (Dead excluded from strip, shown via filter). */
export const FUNNEL_STAGES: UIStage[] = [
  'Scouted',
  'Needs review',
  'Pitching',
  'Response',
  'Draft review',
  'In flight',
  'Done',
];

export const ALL_STAGES: UIStage[] = [...FUNNEL_STAGES, 'Dead'];

// ---- Prospect status → UI stage ----

// All valid values from the backlinkProspectStatusEnum in packages/db
export type ProspectStatus =
  | 'prospected'
  | 'scored'
  | 'flagged_top5'
  | 'approved'
  | 'pitched';

export function prospectStage(status: ProspectStatus): UIStage {
  switch (status) {
    case 'prospected':
    case 'scored':
      return 'Scouted';
    case 'flagged_top5':
      return 'Needs review';
    case 'approved':
      return 'Pitching';
    case 'pitched':
      return 'In flight';
    default:
      return 'Scouted';
  }
}

// ---- Backlink status → UI stage ----

export type BacklinkStatus =
  | 'pending'
  | 'submitted'
  | 'awaiting_reply'
  | 'reply_received'
  | 'accepted'
  | 'drafting'
  | 'escalated'
  | 'manual_review'
  | 'draft_pending_review'
  | 'draft_approved'
  | 'delivered'
  | 'published'
  | 'verified'
  | 'live'
  | 'declined'
  | 'silent'
  | 'rejected'
  | 'lost'
  | 'dormant';

export function backlinkStage(status: BacklinkStatus): UIStage {
  switch (status) {
    case 'pending':
    case 'submitted':
    case 'awaiting_reply':
    case 'reply_received':
      return 'Pitching';
    case 'accepted':
    case 'drafting':
    case 'escalated':
    case 'manual_review':
      return 'Response';
    case 'draft_pending_review':
      return 'Draft review';
    case 'draft_approved':
    case 'delivered':
      return 'In flight';
    case 'published':
    case 'verified':
    case 'live':
      return 'Done';
    case 'declined':
    case 'silent':
    case 'rejected':
    case 'lost':
    case 'dormant':
      return 'Dead';
    default:
      return 'Pitching';
  }
}

// ---- Citation/directory status → UI stage label ----

export type CitationStatus = 'pending' | 'submitted' | 'live' | 'verified';

export function citationStageLabel(status: CitationStatus | string): string {
  switch (status) {
    case 'pending':
      return 'Queued';
    case 'submitted':
      return 'Submitted';
    case 'live':
    case 'verified':
      return 'Live';
    default:
      return status;
  }
}

// ---- Age helpers ----

export function ageInDays(date: Date | string | null | undefined): number {
  if (!date) return 0;
  return Math.floor((Date.now() - new Date(date).getTime()) / 86400000);
}

export function ageLabel(date: Date | string | null | undefined): string {
  if (!date) return '—';
  const d = ageInDays(date);
  if (d === 0) return 'today';
  if (d === 1) return '1d ago';
  return `${d}d ago`;
}
