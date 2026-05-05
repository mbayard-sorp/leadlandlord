'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';

interface ProgressEvent {
  step: string;
  elapsed_ms: number;
  [k: string]: unknown;
}

interface DoneEvent {
  site_id: string;
  sanity_site_doc_id: string;
  pages_written: number;
  theme: 'classic' | 'modern' | 'premium' | 'bright';
  hero_image_url: string | null;
  tracking_number: string;
  tracking_provider: string;
  deployed_at: string;
  elapsed_ms: number;
}

type StreamEvent =
  | { type: 'start'; data: { niche: string; city: string; state: string; started_at: string } }
  | { type: 'progress'; data: ProgressEvent }
  | { type: 'heartbeat'; data: { elapsed_ms: number } }
  | { type: 'done'; data: DoneEvent }
  | { type: 'error'; data: { message: string; elapsed_ms: number } };

const STEP_LABELS: Record<string, string> = {
  site_row_ready: 'Site row created',
  content_started: 'Generating content with Claude…',
  content_generated: 'Content bundle ready',
  tracking_provisioned: 'Tracking number provisioned',
  klaviyo_list_ready: 'Klaviyo list ready',
  sanity_publish_started: 'Publishing to Sanity…',
  sanity_pages_written: 'Pages written to Sanity',
  sanity_site_doc_written: 'Site doc written to Sanity',
  hero_image_started: 'Generating hero image (Imagen)…',
  hero_image_done: 'Hero image uploaded',
  site_ready: 'Site ready',
};

/**
 * Form + live progress for /operator/build. Fetches /api/operator/build with
 * an SSE response and renders each `event:` line as it arrives.
 */
export function BuildForm() {
  const [pending, setPending] = useState(false);
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [done, setDone] = useState<DoneEvent | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const fd = new FormData(e.currentTarget);
    setEvents([]);
    setDone(null);
    setErrorMsg(null);
    setPending(true);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const res = await fetch('/api/operator/build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          niche: String(fd.get('niche') ?? '').trim(),
          city: String(fd.get('city') ?? '').trim(),
          state: String(fd.get('state') ?? '').trim().toUpperCase(),
          fast_mode: fd.get('fast_mode') === 'on',
        }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        const text = await res.text();
        throw new Error(`Build kickoff failed (${res.status}): ${text.slice(0, 200)}`);
      }
      await consumeSse(res.body, (evt) => {
        setEvents((prev) => [...prev, evt]);
        if (evt.type === 'done') setDone(evt.data);
        if (evt.type === 'error') setErrorMsg(evt.data.message);
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setErrorMsg(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setPending(false);
      abortRef.current = null;
    }
  }

  function cancel() {
    abortRef.current?.abort();
    setPending(false);
  }

  return (
    <div className="space-y-6">
      <form
        onSubmit={onSubmit}
        className="rounded-lg border border-slate-800 bg-slate-900/40 p-5 space-y-4"
      >
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="Niche">
            <input
              name="niche"
              required
              placeholder="gutter cleaning"
              className="cell"
              disabled={pending}
            />
          </Field>
          <Field label="City">
            <input
              name="city"
              required
              placeholder="Boise"
              className="cell"
              disabled={pending}
            />
          </Field>
          <Field label="State">
            <input
              name="state"
              required
              placeholder="ID"
              maxLength={2}
              minLength={2}
              className="cell uppercase"
              disabled={pending}
            />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            name="fast_mode"
            defaultChecked
            className="w-4 h-4"
            disabled={pending}
          />
          Fast mode (smaller content bundle, ~50% faster)
        </label>
        <div className="flex justify-end gap-3">
          {pending && (
            <button
              type="button"
              onClick={cancel}
              className="px-4 py-2 rounded border border-slate-700 text-slate-300 text-sm hover:bg-slate-800"
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            disabled={pending}
            className="px-4 py-2 rounded bg-sky-600 hover:bg-sky-500 text-white text-sm font-medium disabled:opacity-50"
          >
            {pending ? 'Building…' : 'Build site'}
          </button>
        </div>

        <style jsx>{`
          :global(.cell) {
            width: 100%;
            background: rgb(15 23 42 / 0.6);
            border: 1px solid rgb(51 65 85);
            border-radius: 6px;
            padding: 8px 12px;
            color: rgb(226 232 240);
            font-size: 0.875rem;
          }
          :global(.cell:focus) {
            outline: none;
            border-color: rgb(56 189 248);
          }
        `}</style>
      </form>

      {errorMsg && (
        <div className="rounded-lg border border-red-700/50 bg-red-900/30 p-4 text-sm text-red-200">
          <p className="font-semibold">Build failed</p>
          <p className="mt-1 font-mono text-xs whitespace-pre-wrap">{errorMsg}</p>
        </div>
      )}

      {done && (
        <div className="rounded-lg border border-emerald-700/50 bg-emerald-900/30 p-4 text-sm">
          <p className="font-semibold text-emerald-200">
            Site published to Sanity in {(done.elapsed_ms / 1000).toFixed(1)}s
          </p>
          <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2 text-xs text-slate-300">
            <div>
              <span className="text-slate-500">Theme: </span>
              <span className="font-mono">{done.theme}</span>
              <span className="text-slate-500"> · {done.pages_written} pages</span>
            </div>
            <div>
              <span className="text-slate-500">Tracking: </span>
              <span className="font-mono">{done.tracking_number}</span>{' '}
              <span className="text-slate-500">({done.tracking_provider})</span>
            </div>
            <div className="col-span-full">
              <span className="text-slate-500">Sanity doc: </span>
              <span className="font-mono">{done.sanity_site_doc_id}</span>
            </div>
            {done.hero_image_url && (
              <div className="col-span-full">
                <span className="text-slate-500">Hero: </span>
                <a
                  href={done.hero_image_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sky-300 hover:text-sky-200 break-all"
                >
                  {done.hero_image_url} ↗
                </a>
              </div>
            )}
            <div>
              <Link
                href={`/operator/sites/${done.site_id}`}
                className="text-sky-300 hover:text-sky-200"
              >
                Open in dashboard →
              </Link>
            </div>
            <div className="text-slate-500 text-xs italic">
              Domain attach is now a separate step — operator dashboard / Phase F.
            </div>
          </div>
        </div>
      )}

      {(pending || events.length > 0) && (
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4 space-y-2">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Progress</h3>
          <ul className="space-y-1 text-sm font-mono">
            {events
              .filter((e) => e.type !== 'heartbeat')
              .map((e, i) => (
                <li key={i} className="flex items-baseline gap-3">
                  <span className="text-slate-500 text-xs tabular-nums w-12 shrink-0">
                    {formatElapsed(e)}
                  </span>
                  <span className="flex-1">{renderEventLabel(e)}</span>
                </li>
              ))}
            {pending && (
              <li className="flex items-baseline gap-3 text-slate-500">
                <span className="text-xs tabular-nums w-12 shrink-0">…</span>
                <span className="italic">running…</span>
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs uppercase tracking-wide text-slate-500 mb-1">{label}</span>
      {children}
    </label>
  );
}

function renderEventLabel(e: StreamEvent): React.ReactNode {
  if (e.type === 'start') {
    return (
      <span className="text-slate-300">
        Building <span className="text-slate-100">{e.data.niche}</span> in{' '}
        <span className="text-slate-100">
          {e.data.city}, {e.data.state}
        </span>
        …
      </span>
    );
  }
  if (e.type === 'progress') {
    const label = STEP_LABELS[e.data.step] ?? e.data.step;
    const detail = renderProgressDetail(e.data);
    return (
      <span>
        <span className="text-emerald-300">✓</span> <span className="text-slate-200">{label}</span>
        {detail && <span className="text-slate-500 ml-2">{detail}</span>}
      </span>
    );
  }
  if (e.type === 'done') {
    return <span className="text-emerald-300">★ Deployed</span>;
  }
  if (e.type === 'error') {
    return <span className="text-red-300">✗ {e.data.message.slice(0, 200)}</span>;
  }
  return null;
}

function renderProgressDetail(d: ProgressEvent): string | null {
  switch (d.step) {
    case 'content_generated':
      return `(${d.pages} pages)`;
    case 'tracking_provisioned':
      return `${d.number} via ${d.provider}`;
    case 'klaviyo_list_ready':
      return d.list_id ? String(d.list_id) : '(skipped)';
    case 'env_vars_synced':
      return `(${d.keys} keys)`;
    case 'project_created':
      return String(d.project_name ?? '');
    case 'hero_image_done':
      return d.url ? '(generated)' : '(skipped)';
    case 'deploy_succeeded':
      return String(d.url ?? '');
    default:
      return null;
  }
}

function formatElapsed(e: StreamEvent): string {
  const ms = (e.data as { elapsed_ms?: number }).elapsed_ms;
  if (typeof ms !== 'number') return '';
  const s = ms / 1000;
  return `${s.toFixed(1)}s`;
}

/**
 * Read SSE events from a fetch response body. Each event has the shape:
 *   event: progress
 *   data: {"step":"content_generated", ...}
 *   <blank line>
 */
async function consumeSse(
  body: ReadableStream<Uint8Array>,
  onEvent: (e: StreamEvent) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // SSE messages are separated by double newlines.
    let idx;
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const raw = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const parsed = parseSseMessage(raw);
      if (parsed) onEvent(parsed);
    }
  }
}

function parseSseMessage(raw: string): StreamEvent | null {
  let event = 'message';
  const dataLines: string[] = [];
  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
  }
  if (dataLines.length === 0) return null;
  const data = JSON.parse(dataLines.join('\n'));
  return { type: event as StreamEvent['type'], data } as StreamEvent;
}
