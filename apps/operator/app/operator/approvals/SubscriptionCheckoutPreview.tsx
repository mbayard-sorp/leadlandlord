const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
});

interface SubscriptionCheckoutPayload {
  trial_id: string;
  prospect_id: string;
  site_id: string;
  monthly_rent_usd: number;
  prospect_score?: number;
}

function isPayload(p: unknown): p is SubscriptionCheckoutPayload {
  if (!p || typeof p !== 'object') return false;
  const o = p as Record<string, unknown>;
  return (
    typeof o.trial_id === 'string' &&
    typeof o.prospect_id === 'string' &&
    typeof o.site_id === 'string' &&
    typeof o.monthly_rent_usd === 'number'
  );
}

interface Props {
  payload: unknown;
}

export function SubscriptionCheckoutPreview({ payload }: Props) {
  if (!isPayload(payload)) {
    return <span className="text-red-400 text-xs">Invalid subscription_checkout payload</span>;
  }

  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <span className="text-emerald-300 font-semibold">
        {currency.format(payload.monthly_rent_usd)}/mo
      </span>
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
      <span className="text-slate-500 text-xs font-mono">{payload.site_id.slice(0, 8)}…</span>
    </div>
  );
}
