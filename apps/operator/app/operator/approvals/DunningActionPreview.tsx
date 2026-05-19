const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
});

interface DunningActionPayload {
  invoice_id: string;
  tenant_id: string;
  step: string | number;
  channel: string;
  action: string;
  amount_usd: number;
}

function isPayload(p: unknown): p is DunningActionPayload {
  if (!p || typeof p !== 'object') return false;
  const o = p as Record<string, unknown>;
  return (
    typeof o.invoice_id === 'string' &&
    typeof o.tenant_id === 'string' &&
    typeof o.action === 'string'
  );
}

interface Props {
  payload: unknown;
}

export function DunningActionPreview({ payload }: Props) {
  if (!isPayload(payload)) {
    return <span className="text-red-400 text-xs">Invalid dunning_action payload</span>;
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="font-semibold text-slate-200">{payload.action}</span>
      {typeof payload.amount_usd === 'number' && (
        <span className="text-amber-300">{currency.format(payload.amount_usd)}</span>
      )}
      <span className="text-slate-500 text-xs">step {payload.step}</span>
      {payload.channel && (
        <span className="inline-block text-xs px-2 py-0.5 rounded border bg-sky-900/40 text-sky-300 border-sky-700/50">
          {payload.channel}
        </span>
      )}
    </div>
  );
}
