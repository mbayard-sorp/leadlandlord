import type { Call } from '@leadlandlord/db';

/**
 * Compact per-call indicators for AI-answered / qualified calls (ADR 0031,
 * Phase E): who answered, qualification score, urgency, job type, and the
 * tenant-notification delivery statuses. Shared between the site-detail
 * recent-calls table and the portfolio-wide /operator/calls table.
 */
export function AnsweredByBadge({ v }: { v: Call['answeredBy'] }) {
  if (!v) return <span className="text-slate-600">—</span>;
  const tone =
    v === 'ai'
      ? 'text-violet-300 border-violet-700/50 bg-violet-900/30'
      : 'text-sky-300 border-sky-700/50 bg-sky-900/30';
  return (
    <span className={`inline-block px-2 py-0.5 rounded border text-xs uppercase ${tone}`}>
      {v === 'ai' ? 'AI' : 'Human'}
    </span>
  );
}

export function QualificationScorePill({ v }: { v: Call['qualificationScore'] }) {
  if (v == null) return <span className="text-slate-600">—</span>;
  const tone =
    v >= 70
      ? 'text-emerald-300 border-emerald-700/50 bg-emerald-900/30'
      : v >= 40
      ? 'text-amber-300 border-amber-700/50 bg-amber-900/30'
      : 'text-red-300 border-red-700/50 bg-red-900/30';
  return <span className={`inline-block px-2 py-0.5 rounded border text-xs ${tone}`}>{v}/100</span>;
}

export function UrgencyPill({ v }: { v: Call['qualificationUrgency'] }) {
  if (!v) return null;
  const tone =
    v === 'emergency'
      ? 'text-red-300 border-red-700/50 bg-red-900/30'
      : v === 'this_week'
      ? 'text-amber-300 border-amber-700/50 bg-amber-900/30'
      : v === 'flexible'
      ? 'text-sky-300 border-sky-700/50 bg-sky-900/30'
      : 'text-slate-400 border-slate-700 bg-slate-800/60';
  return (
    <span className={`inline-block px-2 py-0.5 rounded border text-xs ${tone}`}>
      {v.replace(/_/g, ' ')}
    </span>
  );
}

export function DeliveryStatusPill({ label, v }: { label: string; v: string | null }) {
  if (!v) return null;
  const tone =
    v === 'sent'
      ? 'text-emerald-300/80'
      : v === 'failed'
      ? 'text-red-300/80'
      : v === 'skipped'
      ? 'text-slate-500'
      : 'text-amber-300/80';
  return (
    <span className={`text-xs ${tone}`}>
      {label} {v}
    </span>
  );
}

/**
 * Grouped call-qualification summary — badges + job type + tenant delivery
 * statuses, stacked compactly for a table cell.
 */
export function QualificationSummaryCell({ call }: { call: Call }) {
  if (!call.answeredBy && call.qualificationScore == null) {
    return <span className="text-slate-600">—</span>;
  }
  return (
    <div className="flex flex-col gap-1 text-xs">
      <div className="flex flex-wrap items-center gap-1.5">
        <AnsweredByBadge v={call.answeredBy} />
        <QualificationScorePill v={call.qualificationScore} />
        <UrgencyPill v={call.qualificationUrgency} />
      </div>
      {call.qualificationJobType && (
        <div className="text-slate-400 break-words">{call.qualificationJobType}</div>
      )}
      {(call.tenantSmsStatus || call.tenantEmailStatus) && (
        <div className="flex flex-wrap gap-2">
          <DeliveryStatusPill label="SMS" v={call.tenantSmsStatus} />
          <DeliveryStatusPill label="Email" v={call.tenantEmailStatus} />
        </div>
      )}
    </div>
  );
}
