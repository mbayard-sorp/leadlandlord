'use client';

import { useState } from 'react';

export function LoginForm({ next }: { next: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(formData: FormData) {
    setPending(true);
    setError(null);
    const password = String(formData.get('password') ?? '');
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      window.location.href = next;
      return;
    }
    setPending(false);
    setError('Invalid password.');
  }

  return (
    <form action={onSubmit} className="space-y-3">
      <input
        name="password"
        type="password"
        autoFocus
        autoComplete="current-password"
        className="w-full rounded border border-slate-600 bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:border-sky-400"
        placeholder="Operator password"
        required
      />
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded bg-sky-600 hover:bg-sky-500 disabled:opacity-50 px-3 py-2 text-sm font-medium"
      >
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
