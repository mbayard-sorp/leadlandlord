interface ProspectPromoteToTrialPayload {
  prospect_id: string;
  site_id: string;
  business_name: string;
  prospect_score?: number;
}

function isPayload(p: unknown): p is ProspectPromoteToTrialPayload {
  if (!p || typeof p !== 'object') return false;
  const o = p as Record<string, unknown>;
  return (
    typeof o.prospect_id === 'string' &&
    typeof o.site_id === 'string' &&
    typeof o.business_name === 'string'
  );
}

interface Props {
  payload: unknown;
}

export function ProspectPromoteToTrialPreview({ payload }: Props) {
  if (!isPayload(payload)) {
    return <span className="text-red-400 text-xs">Invalid prospect_promote_to_trial payload</span>;
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-slate-200 font-medium">{payload.business_name}</span>
      {typeof payload.prospect_score === 'number' && (
        <span
          className={`inline-block text-xs px-2 py-0.5 rounded border ${
            payload.prospect_score >= 80
              ? 'bg-emerald-900/40 text-emerald-300 border-emerald-700/50'
              : payload.prospect_score >= 50
              ? 'bg-amber-900/40 text-amber-300 border-amber-700/50'
              : 'bg-slate-800/60 text-slate-400 border-slate-700'
          }`}
        >
          score {payload.prospect_score}
        </span>
      )}
    </div>
  );
}
