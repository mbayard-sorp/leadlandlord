'use client';

import { useTransition } from 'react';
import { createAutoApproveRule, deactivateAutoApproveRule } from './actions';

export function DeactivateRuleButton({ id }: { id: string }) {
  const [pending, startTransition] = useTransition();

  function onDeactivate() {
    const fd = new FormData();
    fd.append('id', id);
    startTransition(async () => { await deactivateAutoApproveRule(fd); });
  }

  return (
    <button
      type="button"
      disabled={pending}
      onClick={onDeactivate}
      className="text-xs bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-300 px-2 py-1 rounded"
    >
      {pending ? '...' : 'Deactivate'}
    </button>
  );
}

export function CreateRuleForm({ prefillKind, prefillMatcher }: { prefillKind: string; prefillMatcher: string }) {
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.append('operator_email', 'operator');
    startTransition(async () => { await createAutoApproveRule(fd); });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3 max-w-lg">
      <div>
        <label className="block text-xs text-slate-400 mb-1">Kind</label>
        <select
          name="kind"
          defaultValue={prefillKind}
          className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-sm text-slate-200"
        >
          <option value="niche_candidate">niche_candidate</option>
        </select>
      </div>
      <div>
        <label className="block text-xs text-slate-400 mb-1">Matcher JSON</label>
        <textarea
          name="matcher"
          rows={5}
          defaultValue={prefillMatcher}
          className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm font-mono text-slate-200 resize-y"
          placeholder={'{ "score": { "$gte": 70 } }'}
        />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm px-4 py-1.5 rounded"
      >
        {pending ? 'Creating...' : 'Create rule'}
      </button>
    </form>
  );
}
