import { NextResponse } from 'next/server';
import { z } from 'zod';
import { SiteBuilder, type SiteBuilderProgressEvent } from '@leadlandlord/agents/site-builder';
import { log } from '@leadlandlord/shared/log';
import { verifySession, sessionCookieName } from '../../../../lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// 800s is Vercel Pro's ceiling. Site Builder pipeline can take 4-7 min on
// niche-heavy bundles — 300s was racing the cap. Bumped here so manual
// kickoffs from /operator/build don't get killed mid-deploy.
export const maxDuration = 800;

const Body = z.object({
  niche: z.string().min(1).max(80),
  city: z.string().min(1).max(80),
  state: z.string().length(2),
  niche_id: z.string().uuid().optional(),
  fast_mode: z.boolean().optional(),
});

/**
 * Manual site build kickoff with live progress over Server-Sent Events.
 *
 * The client (apps/operator/app/operator/build/page.tsx) POSTs niche/city/
 * state and reads the response stream. SiteBuilder emits progress events
 * via its onProgress callback at each lifecycle step; we translate those into
 * SSE messages so the dashboard updates in real time.
 *
 * Auth: gated by the operator session cookie — no auto-deploy from outside.
 */
export async function POST(req: Request) {
  // Auth gate — same cookie as the operator dashboard.
  const cookies = req.headers.get('cookie') ?? '';
  const cookieName = sessionCookieName();
  const match = cookies.match(new RegExp(`(?:^|;\\s*)${cookieName}=([^;]+)`));
  if (!verifySession(match?.[1])) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'invalid_payload', issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const { niche, city, state, niche_id, fast_mode } = parsed.data;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          // Controller may be closed when the client disconnects mid-build.
        }
      };

      const startedAt = Date.now();
      send('start', { niche, city, state, started_at: new Date(startedAt).toISOString() });

      // Heartbeat keeps proxies (and Vercel) from idle-killing the connection.
      const heartbeat = setInterval(() => {
        send('heartbeat', { elapsed_ms: Date.now() - startedAt });
      }, 5000);

      try {
        const builder = new SiteBuilder((event: SiteBuilderProgressEvent) => {
          send('progress', { ...event, elapsed_ms: Date.now() - startedAt });
        });

        const result = await builder.run({
          niche,
          city,
          state: state.toUpperCase(),
          niche_id,
          fast_mode: fast_mode ?? true,
        });

        send('done', {
          ...result,
          elapsed_ms: Date.now() - startedAt,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.error({ niche, city, state, err: message }, '/api/operator/build failed');
        send('error', { message, elapsed_ms: Date.now() - startedAt });
      } finally {
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // disable nginx-style buffering
    },
  });
}
