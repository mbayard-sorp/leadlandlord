'use client';

/**
 * Customer portal sign-in page.
 *
 * Uses `@neondatabase/auth/next` (hook-oriented React client) for sign-in.
 * The form POSTs to the local Neon Auth API route (/api/auth/sign-in/email)
 * via the auth client, which sets the signed session cookie on success.
 *
 * "Forgot password" is available: the client exposes `forgetPassword.email()`
 * which triggers a password-reset email from Neon Auth.
 */

import { createAuthClient } from '@neondatabase/auth/next';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';

const authClient = createAuthClient();

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get('next') ?? '/dashboard';

  const [mode, setMode] = useState<'signin' | 'forgot'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const { error: authError } = await authClient.signIn.email({
        email,
        password,
      });
      if (authError) {
        setError(authError.message ?? 'Sign-in failed. Please try again.');
      } else {
        router.replace(next);
      }
    } catch {
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setPending(false);
    }
  }

  async function handleForgotPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setPending(true);
    try {
      const { error: authError } = await authClient.requestPasswordReset({
        email,
        redirectTo: `${window.location.origin}/login`,
      });
      if (authError) {
        setError(authError.message ?? 'Could not send reset email. Please try again.');
      } else {
        setInfo('Check your inbox for a password reset link.');
      }
    } catch {
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold" style={{ color: 'var(--color-fg)' }}>
            {mode === 'signin' ? 'Sign in to your portal' : 'Reset your password'}
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--color-muted)' }}>
            {mode === 'signin'
              ? 'Enter the credentials from your welcome email.'
              : 'Enter your email and we will send a reset link.'}
          </p>
        </div>

        <form
          onSubmit={mode === 'signin' ? handleSignIn : handleForgotPassword}
          className="space-y-4"
        >
          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium mb-1"
              style={{ color: 'var(--color-fg)' }}
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input"
              placeholder="you@example.com"
            />
          </div>

          {mode === 'signin' && (
            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium mb-1"
                style={{ color: 'var(--color-fg)' }}
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input"
                placeholder="••••••••"
              />
            </div>
          )}

          {error && (
            <p className="text-sm" style={{ color: 'var(--color-error)' }}>
              {error}
            </p>
          )}
          {info && (
            <p className="text-sm" style={{ color: 'var(--color-success)' }}>
              {info}
            </p>
          )}

          <button type="submit" disabled={pending} className="btn-primary w-full">
            {pending
              ? 'Please wait...'
              : mode === 'signin'
              ? 'Sign in'
              : 'Send reset link'}
          </button>
        </form>

        <div className="mt-4 text-center">
          {mode === 'signin' ? (
            <button
              type="button"
              onClick={() => {
                setMode('forgot');
                setError(null);
                setInfo(null);
              }}
              className="text-sm"
              style={{ color: 'var(--color-accent)' }}
            >
              Forgot your password?
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setMode('signin');
                setError(null);
                setInfo(null);
              }}
              className="text-sm"
              style={{ color: 'var(--color-accent)' }}
            >
              Back to sign in
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
