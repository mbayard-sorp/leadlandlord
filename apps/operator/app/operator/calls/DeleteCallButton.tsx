'use client';

import { useTransition, useState } from 'react';
import { deleteCall } from './actions';

interface Props {
  id: string;
}

export function DeleteCallButton({ id }: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    if (!window.confirm('Delete this call permanently?')) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteCall(id);
      if (!result.ok) {
        setError(result.message ?? 'Delete failed.');
      }
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={handleClick}
        title="Delete call"
        className="rounded bg-red-900 hover:bg-red-800 disabled:opacity-50 px-2 py-1 text-xs font-medium text-red-100"
      >
        {pending ? '…' : 'Delete'}
      </button>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
