import * as Sentry from '@sentry/nextjs';
import { beforeSend } from './lib/sentry-filter';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  environment: process.env.VERCEL_ENV ?? 'development',
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,
  beforeSend,
});
