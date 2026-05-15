export function ProspectStatusBadge({ status }: { status: string }) {
  const tone =
    status === 'new'
      ? 'bg-slate-800/60 text-slate-400 border-slate-700'
      : status === 'contacted'
      ? 'bg-sky-900/40 text-sky-300 border-sky-700/50'
      : status === 'replied'
      ? 'bg-indigo-900/40 text-indigo-300 border-indigo-700/50'
      : status === 'accepted_trial'
      ? 'bg-amber-900/40 text-amber-300 border-amber-700/50'
      : status === 'converted'
      ? 'bg-emerald-900/40 text-emerald-300 border-emerald-700/50'
      : 'bg-rose-900/40 text-rose-300 border-rose-700/50';
  return (
    <span className={`inline-block px-2 py-0.5 rounded border text-xs ${tone}`}>{status}</span>
  );
}

export function ScoreBandBadge({ score }: { score: number | null | undefined }) {
  if (score == null) {
    return (
      <span className="inline-block px-2 py-0.5 rounded border text-xs bg-slate-800/60 text-slate-500 border-slate-700">
        C
      </span>
    );
  }
  if (score >= 80) {
    return (
      <span className="inline-block px-2 py-0.5 rounded border text-xs bg-emerald-900/40 text-emerald-300 border-emerald-700/50">
        A
      </span>
    );
  }
  if (score >= 50) {
    return (
      <span className="inline-block px-2 py-0.5 rounded border text-xs bg-amber-900/40 text-amber-300 border-amber-700/50">
        B
      </span>
    );
  }
  return (
    <span className="inline-block px-2 py-0.5 rounded border text-xs bg-slate-800/60 text-slate-500 border-slate-700">
      C
    </span>
  );
}

export function scoreBand(score: number | null | undefined): 'A' | 'B' | 'C' {
  if (score == null || score < 50) return 'C';
  if (score < 80) return 'B';
  return 'A';
}
