interface Props {
  value: number;
  max: number;
  label?: string;
  className?: string;
}

export function MeterBar({ value, max, label, className = '' }: Props) {
  const pct = max === 0 ? 0 : Math.min(100, Math.round((value / max) * 100));
  const tone =
    pct >= 80
      ? 'bg-emerald-500'
      : pct >= 40
      ? 'bg-sky-500'
      : 'bg-slate-500';

  return (
    <div className={`space-y-0.5 ${className}`}>
      {label && (
        <div className="text-[11px] text-slate-400">{label}</div>
      )}
      <div className="h-1.5 bg-slate-800 rounded overflow-hidden w-full">
        <div
          className={`h-full rounded ${tone} transition-all`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="text-[11px] text-slate-500 font-mono">
        {value}/{max} live
      </div>
    </div>
  );
}
