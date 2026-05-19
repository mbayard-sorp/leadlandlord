'use client';

import { useState } from 'react';

interface Props {
  dfsRaw: unknown;
}

export function RawResponseDrawer({ dfsRaw }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-xs text-indigo-400 hover:text-indigo-300 underline-offset-2 hover:underline"
      >
        {open ? 'Hide raw response' : 'View raw response'}
      </button>
      {open && (
        <div className="mt-2 max-h-96 overflow-auto rounded border border-slate-700 bg-slate-950 p-3">
          <pre className="text-xs text-slate-300 whitespace-pre-wrap break-words">
            {JSON.stringify(dfsRaw, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
