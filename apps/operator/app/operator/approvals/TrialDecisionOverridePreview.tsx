const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
});

interface TrialDecisionOverridePayload {
  trial_id: string;
  prior_decision: string;
  new_decision: string;
  calls_count?: number;
  won_count?: number;
  est_revenue_usd?: number | string | null;
}

function isPayload(p: unknown): p is TrialDecisionOverridePayload {
  if (!p || typeof p !== 'object') return false;
  const o = p as Record<string, unknown>;
  return (
    typeof o.trial_id === 'string' &&
    typeof o.prior_decision === 'string' &&
    typeof o.new_decision === 'string'
  );
}

interface Props {
  payload: unknown;
}

export function TrialDecisionOverridePreview({ payload }: Props) {
  if (!isPayload(payload)) {
    return <span className="text-red-400 text-xs">Invalid trial_decision_override payload</span>;
  }

  const rev = payload.est_revenue_usd != null ? Number(payload.est_revenue_usd) : null;

  return (
    <div className="space-y-1 text-sm">
      <div className="flex items-center gap-2">
        <span className="text-slate-400">{payload.prior_decision}</span>
        <span className="text-slate-500">→</span>
        <span
          className={`font-semibold ${
            payload.new_decision === 'won' ? 'text-emerald-300' : 'text-rose-300'
          }`}
        >
          {payload.new_decision}
        </span>
      </div>
      <div className="text-xs text-slate-500 flex gap-3">
        {typeof payload.calls_count === 'number' && (
          <span>{payload.calls_count} calls</span>
        )}
        {typeof payload.won_count === 'number' && (
          <span>{payload.won_count} won</span>
        )}
        {rev != null && !isNaN(rev) && (
          <span>{currency.format(rev)} est revenue</span>
        )}
      </div>
    </div>
  );
}
