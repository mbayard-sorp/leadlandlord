interface TrialProvisioningPayload {
  prospect_id: string;
  site_id: string;
  forwarding_to: string;
  duration_days: number;
}

function isPayload(p: unknown): p is TrialProvisioningPayload {
  if (!p || typeof p !== 'object') return false;
  const o = p as Record<string, unknown>;
  return (
    typeof o.prospect_id === 'string' &&
    typeof o.site_id === 'string' &&
    typeof o.forwarding_to === 'string'
  );
}

interface Props {
  payload: unknown;
}

export function TrialProvisioningPreview({ payload }: Props) {
  if (!isPayload(payload)) {
    return <span className="text-red-400 text-xs">Invalid trial_provisioning payload</span>;
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="font-mono text-xs bg-slate-800 px-1.5 py-0.5 rounded text-slate-300">
        {payload.site_id.slice(0, 8)}…
      </span>
      <span className="text-slate-500">→</span>
      <span className="text-slate-300 font-mono text-xs">{payload.forwarding_to}</span>
      {typeof payload.duration_days === 'number' && (
        <span className="text-slate-500 text-xs">{payload.duration_days}d trial</span>
      )}
    </div>
  );
}
