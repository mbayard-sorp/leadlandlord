import pino, { type Logger } from 'pino';

export type { Logger };

export const log = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  base: { service: 'leadlandlord' },
  ...(process.env.NODE_ENV !== 'production'
    ? {
        transport: {
          target: 'pino/file',
          options: { destination: 1 },
        },
      }
    : {}),
});

export function child(bindings: Record<string, unknown>) {
  return log.child(bindings);
}
