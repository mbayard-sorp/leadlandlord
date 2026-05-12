'use client';

import { useState, useTransition } from 'react';
import { approveProspect, rejectProspect } from './molly-actions';
import type { BacklinkProspect } from '@leadlandlord/db';

interface ReceptivitySignals {
  receptive: boolean;
  signals: string[];
  sampledUrls: string[];
}

interface Top5CardProps {
  prospect: BacklinkProspect;
  siteLabel: string;
}

function Top5Card({ prospect, siteLabel }: Top5CardProps) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  const metadata = (prospect.metadata ?? {}) as Record<string, unknown>;
  const receptivity = metadata.receptivity as ReceptivitySignals | undefined;

  function approve() {
    setMsg(null);
    startTransition(async () => {
      const r = await approveProspect(prospect.id);
      setMsg(r.ok ? 'approved' : (r.message ?? 'approve failed'));
    });
  }

  function reject() {
    setMsg(null);
    startTransition(async () => {
      const r = await rejectProspect(prospect.id);
      setMsg(r.ok ? 'returned to pool' : (r.message ?? 'reject failed'));
    });
  }

  const scoreVal = prospect.score != null ? Number(prospect.score) : null;
  const scoreTone =
    scoreVal == null
      ? 'text-slate-400'
      : scoreVal >= 70
      ? 'text-emerald-300'
      : scoreVal >= 45
      ? 'text-amber-300'
      : 'text-red-300';

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900/50 p-4 space-y-3">
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-mono text-sm text-slate-100 font-semibold">{prospect.domain}</div>
          <div className="text-xs text-slate-400 mt-0.5">{siteLabel}</div>
        </div>
        <div className="text-right shrink-0">
          <div className={`text-2xl font-bold tabular-nums ${scoreTone}`}>
            {scoreVal != null ? scoreVal : '—'}
          </div>
          <div className="text-xs text-slate-500">/ 100</div>
        </div>
      </div>

      {/* Rationale */}
      {prospect.rationale && (
        <p className="text-xs text-slate-300 italic leading-relaxed">&ldquo;{prospect.rationale}&rdquo;</p>
      )}

      {/* Metadata row */}
      <div className="flex flex-wrap gap-3 text-xs text-slate-400">
        <span>
          DA <span className="text-slate-200 font-mono">{prospect.domainRank ?? '—'}</span>
        </span>
        {receptivity != null && (
          <span>
            Receptive:{' '}
            <span className={receptivity.receptive ? 'text-emerald-300' : 'text-slate-400'}>
              {receptivity.receptive ? 'yes' : 'no'}
            </span>
          </span>
        )}
        {receptivity?.signals && receptivity.signals.length > 0 && (
          <span className="text-slate-400">
            Signals:{' '}
            <span className="text-slate-300">{receptivity.signals.slice(0, 3).join(', ')}</span>
          </span>
        )}
        {prospect.flaggedTop5At && (
          <span>
            Flagged{' '}
            <span className="text-slate-300 font-mono">
              {new Date(prospect.flaggedTop5At).toLocaleDateString()}
            </span>
          </span>
        )}
      </div>

      {/* Actions */}
      {(prospect.status === 'flagged_top5') && (
        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={approve}
            disabled={pending}
            className="text-xs px-3 py-1.5 rounded bg-emerald-700/40 hover:bg-emerald-700/60 text-emerald-200 disabled:opacity-50 font-medium"
          >
            Approve
          </button>
          <button
            type="button"
            onClick={reject}
            disabled={pending}
            className="text-xs px-3 py-1.5 rounded bg-slate-700/60 hover:bg-slate-700/80 text-slate-300 disabled:opacity-50"
          >
            Reject (return to pool)
          </button>
          {msg && (
            <span
              className={`text-xs ${
                msg === 'approved'
                  ? 'text-emerald-300'
                  : msg === 'returned to pool'
                  ? 'text-slate-400'
                  : 'text-amber-300'
              }`}
            >
              {msg}
            </span>
          )}
        </div>
      )}
      {prospect.status === 'approved' && (
        <div className="text-xs text-emerald-400 font-medium pt-1">
          Approved{prospect.approvedAt ? ` on ${new Date(prospect.approvedAt).toLocaleDateString()}` : ''} — pitch send queued for R4.3
        </div>
      )}
    </div>
  );
}

interface MollyTop5SectionProps {
  prospects: BacklinkProspect[];
  siteLabelMap: Record<string, string>;
}

export function MollyTop5Section({ prospects, siteLabelMap }: MollyTop5SectionProps) {
  if (prospects.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-700 bg-slate-900/40 p-6 text-center text-sm text-slate-500">
        No prospects have been flagged yet. Run MollyScorer on a site with prospected rows to populate this tab.
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {prospects.map((p) => (
        <Top5Card
          key={p.id}
          prospect={p}
          siteLabel={siteLabelMap[p.siteId] ?? p.siteId.slice(0, 8)}
        />
      ))}
    </div>
  );
}
