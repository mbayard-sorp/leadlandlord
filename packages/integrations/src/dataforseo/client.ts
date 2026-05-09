import { IntegrationError } from '@leadlandlord/shared/errors';

/**
 * Internal DataForSEO HTTP client shared by the keyword/SERP module
 * (./index.ts) and the backlinks module (./backlinks.ts).
 *
 * Auth: HTTP Basic. The `DATAFORSEO_AUTH` env var holds either a raw
 * `login:password` string OR a pre-encoded `base64(login:password)`. We
 * normalize both cases at fetch time.
 */

const BASE = 'https://api.dataforseo.com/v3';

function authHeader(): string {
  const raw = process.env.DATAFORSEO_AUTH;
  if (!raw) throw new IntegrationError('dataforseo', 'DATAFORSEO_AUTH is not set');
  const encoded = raw.includes(':') ? Buffer.from(raw, 'utf-8').toString('base64') : raw;
  return `Basic ${encoded}`;
}

interface DataForSeoResponse<T> {
  status_code: number;
  status_message: string;
  tasks?: Array<{
    status_code: number;
    status_message: string;
    result: T[] | null;
  }>;
}

export async function dfsPost<TaskResult>(
  path: string,
  body: unknown,
): Promise<TaskResult[]> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization: authHeader(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '<no body>');
    throw new IntegrationError(
      'dataforseo',
      `${path} → ${res.status} ${text.slice(0, 300)}`,
      res.status,
    );
  }
  const json = (await res.json()) as DataForSeoResponse<TaskResult>;
  if (json.status_code >= 40000) {
    throw new IntegrationError('dataforseo', `${path} → ${json.status_code} ${json.status_message}`);
  }
  const task = json.tasks?.[0];
  if (!task) return [];
  if (task.status_code >= 40000) {
    throw new IntegrationError(
      'dataforseo',
      `${path} task → ${task.status_code} ${task.status_message}`,
    );
  }
  return task.result ?? [];
}
