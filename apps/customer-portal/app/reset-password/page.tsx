'use client';

/**
 * Customer portal password-reset page.
 *
 * The reset email links to the Neon Auth service, NOT to us. That endpoint
 * validates the token and then redirects to the `redirectTo` we passed when
 * requesting the reset, appending the token:
 *
 *   <neon-auth-host>/reset-password/<token>?callbackURL=<redirectTo>
 *     -> <redirectTo>?token=<token>
 *
 * So the service only verifies the token exists; the form that actually sets
 * the new password has to live here. Before this page existed, `redirectTo`
 * pointed at /login, which ignored the token and just showed the sign-in
 * form, leaving no way to complete a reset. Since the welcome email tells new
 * customers to use "Forgot password" to set their credentials, that made
 * first-time sign-in impossible.
 *
 * Failure mode to preserve: when the token is missing, expired or already
 * used, Neon Auth redirects with `?error=<code>` instead of `?token=`.
 */

import { createAuthClient } from '@neondatabase/auth/next';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';

const authClient = createAuthClient();

/** Matches the server-side rule Better Auth enforces. */
const MIN_PASSWORD_LENGTH = 8;

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const linkError = searchParams.get('error');

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }
    if (!token) {
      setError('This reset link is missing its token. Request a new one.');
      return;
    }

    setPending(true);
    try {
      const { error: authError } = await authClient.resetPassword({
        newPassword: password,
        token,
      });
      if (authError) {
        setError(authError.message ?? 'Could not reset your password. Request a new link.');
      } else {
        setDone(true);
        // Brief pause so the confirmation is readable before we move on.
        setTimeout(() => router.replace('/login'), 1500);
      }
    } catch {
      setError('An unexpected error occurred. Please request a new reset link.');
    } finally {
      setPending(false);
    }
  }

  // A link that arrived without a usable token: send them back to request one
  // rather than showing a form that cannot succeed.
  if (!token || linkError) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="w-full max-w-sm text-center">
          <h1 className="text-2xl font-semibold" style={{ color: 'var(--color-fg)' }}>
            This link has expired
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--color-muted)' }}>
            Password reset links can only be used once, and they expire. Request a
            new one and it will arrive in a moment.
          </p>
          <button
            type="button"
            onClick={() => router.replace('/login')}
            className="btn-primary w-full mt-6"
          >
            Back to sign in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold" style={{ color: 'var(--color-fg)' }}>
            Choose a password
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--color-muted)' }}>
            This is the password you will use to sign in and edit your website.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="password"
              className="block text-sm font-medium mb-1"
              style={{ color: 'var(--color-fg)' }}
            >
              New password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={MIN_PASSWORD_LENGTH}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input"
              placeholder="At least 8 characters"
            />
          </div>

          <div>
            <label
              htmlFor="confirm"
              className="block text-sm font-medium mb-1"
              style={{ color: 'var(--color-fg)' }}
            >
              Confirm password
            </label>
            <input
              id="confirm"
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="input"
              placeholder="Type it again"
            />
          </div>

          {error && (
            <p className="text-sm" style={{ color: 'var(--color-error)' }}>
              {error}
            </p>
          )}
          {done && (
            <p className="text-sm" style={{ color: 'var(--color-success)' }}>
              Password set. Taking you to sign in...
            </p>
          )}

          <button type="submit" disabled={pending || done} className="btn-primary w-full">
            {pending ? 'Please wait...' : 'Set password'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}
