import type { UIStage } from '@/lib/links/stages';

interface Props {
  status: string;
  stage?: UIStage;
  /** Show a pulsing dot for in-progress states */
  pulse?: boolean;
}

function stageToTone(stage: UIStage): string {
  switch (stage) {
    case 'Needs review':
      return 'bg-amber-900/40 text-amber-200 border-amber-700/50';
    case 'Pitching':
      return 'bg-sky-900/40 text-sky-200 border-sky-700/50';
    case 'Response':
      return 'bg-violet-900/40 text-violet-200 border-violet-700/50';
    case 'Draft review':
      return 'bg-amber-900/40 text-amber-200 border-amber-700/50';
    case 'In flight':
      return 'bg-sky-900/40 text-sky-200 border-sky-700/50';
    case 'Done':
      return 'bg-emerald-900/40 text-emerald-200 border-emerald-700/50';
    case 'Dead':
      return 'bg-red-900/40 text-red-300 border-red-700/50';
    case 'Scouted':
    default:
      return 'bg-slate-800/60 text-slate-300 border-slate-700';
  }
}

function statusToTone(status: string): string {
  if (
    status === 'live' ||
    status === 'verified' ||
    status === 'published' ||
    status === 'accepted' ||
    status === 'draft_approved'
  ) {
    return 'bg-emerald-900/40 text-emerald-300 border-emerald-700/50';
  }
  if (
    status === 'draft_pending_review' ||
    status === 'drafting' ||
    status === 'flagged_top5'
  ) {
    return 'bg-amber-900/30 text-amber-300 border-amber-700/50';
  }
  if (
    status === 'escalated' ||
    status === 'manual_review'
  ) {
    return 'bg-fuchsia-900/40 text-fuchsia-200 border-fuchsia-700/50';
  }
  if (
    status === 'rejected' ||
    status === 'lost' ||
    status === 'declined' ||
    status === 'dormant' ||
    status === 'silent'
  ) {
    return 'bg-red-900/40 text-red-300 border-red-700/50';
  }
  if (status === 'approved' || status === 'pitched') {
    return 'bg-sky-900/40 text-sky-200 border-sky-700/50';
  }
  return 'bg-slate-800/60 text-slate-300 border-slate-700';
}

export function StatusBadge({ status, stage, pulse }: Props) {
  const tone = stage ? stageToTone(stage) : statusToTone(status);
  const isActive =
    status === 'drafting' ||
    status === 'awaiting_reply' ||
    status === 'submitted';

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-xs ${tone}`}>
      {(pulse || isActive) && (
        <span className="relative flex h-1.5 w-1.5 shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-current opacity-60" />
          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-current" />
        </span>
      )}
      {status}
    </span>
  );
}
