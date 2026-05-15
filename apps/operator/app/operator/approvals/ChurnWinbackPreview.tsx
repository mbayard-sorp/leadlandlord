interface ChurnWinbackPayload {
  site_id: string;
  churned_tenant_id: string;
  prospect_count: number;
  prospects_added: number;
}

function isPayload(p: unknown): p is ChurnWinbackPayload {
  if (!p || typeof p !== 'object') return false;
  const o = p as Record<string, unknown>;
  return (
    typeof o.site_id === 'string' &&
    typeof o.churned_tenant_id === 'string' &&
    typeof o.prospect_count === 'number'
  );
}

interface Props {
  payload: unknown;
}

export function ChurnWinbackPreview({ payload }: Props) {
  if (!isPayload(payload)) {
    return <span className="text-red-400 text-xs">Invalid churn_winback payload</span>;
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-slate-300">
        {payload.prospects_added} replacement prospect{payload.prospects_added !== 1 ? 's' : ''} queued
      </span>
      <span className="text-slate-500 text-xs">({payload.prospect_count} total)</span>
      <span className="text-slate-600 font-mono text-xs">{payload.site_id.slice(0, 8)}…</span>
    </div>
  );
}
