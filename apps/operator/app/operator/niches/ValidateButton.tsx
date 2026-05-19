'use client';

import { useTransition, useState } from 'react';
import { validateNiche } from './actions';

interface Props {
  nicheId: string;
  alreadyValidated: boolean;
}

export function ValidateButton({ nicheId, alreadyValidated }: Props) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  function handleValidate() {
    setMessage(null);
    startTransition(async () => {
      const result = await validateNiche(nicheId);
      setMessage({ ok: result.ok, text: result.message ?? (result.ok ? 'Done.' : 'Failed.') });
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={handleValidate}
        className="rounded bg-indigo-700 hover:bg-indigo-600 disabled:opacity-50 px-3 py-1 text-xs font-medium text-white whitespace-nowrap"
      >
        {pending ? '…' : alreadyValidated ? 'Re-validate' : 'Validate'}
      </button>
      {message && (
        <p className={`text-xs ${message.ok ? 'text-emerald-400' : 'text-red-400'}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
