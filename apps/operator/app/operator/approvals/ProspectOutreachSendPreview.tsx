interface ProspectOutreachSendPayload {
  prospect_id: string;
  step: string | number;
  channel: string;
  recipient: string;
  est_cost_usd: number;
}

function isPayload(p: unknown): p is ProspectOutreachSendPayload {
  if (!p || typeof p !== 'object') return false;
  const o = p as Record<string, unknown>;
  return (
    typeof o.prospect_id === 'string' &&
    typeof o.channel === 'string' &&
    typeof o.recipient === 'string'
  );
}

function truncateRecipient(r: string): string {
  if (r.includes('@')) {
    const [local, domain] = r.split('@');
    return `${(local ?? '').slice(0, 4)}…@${domain}`;
  }
  if (r.length > 12) return `${r.slice(0, 6)}…${r.slice(-4)}`;
  return r;
}

interface Props {
  payload: unknown;
}

export function ProspectOutreachSendPreview({ payload }: Props) {
  if (!isPayload(payload)) {
    return <span className="text-red-400 text-xs">Invalid prospect_outreach_send payload</span>;
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="inline-block text-xs px-2 py-0.5 rounded border bg-sky-900/40 text-sky-300 border-sky-700/50">
        {payload.channel}
      </span>
      <span className="text-slate-400">step {payload.step}</span>
      <span className="text-slate-300">{truncateRecipient(payload.recipient)}</span>
      {typeof payload.est_cost_usd === 'number' && (
        <span className="text-slate-500 text-xs">${payload.est_cost_usd.toFixed(2)} est</span>
      )}
    </div>
  );
}
