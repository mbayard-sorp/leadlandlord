import { IntegrationError } from '@leadlandlord/shared/errors';
import { log } from '@leadlandlord/shared/log';

/**
 * IndexNow — submit changed URLs to participating search engines in one call.
 * A single POST fans out to Bing, Brave, Yandex, and Seznam. We care about the
 * first two: ChatGPT search reads Bing's index, Claude web search reads Brave's,
 * so getting freshly-live tenant URLs into those indexes is what makes the
 * sites eligible to surface in LLM answers.
 *
 * Protocol: https://www.indexnow.org/documentation
 */

const DEFAULT_ENDPOINT = 'https://api.indexnow.org/indexnow';

/** Single-submission cap defined by the protocol. */
const MAX_URLS = 10_000;

export interface SubmitUrlsArgs {
  /** Bare host of the site being submitted (no protocol), e.g. "tree-removal-tucson.com". */
  host: string;
  /** The IndexNow key — also the literal contents of the key file served on `host`. */
  key: string;
  /** Absolute URLs to submit. Every URL must be on `host`. */
  urls: string[];
  /** Override the key-file location. Defaults to `https://{host}/{key}.txt`. */
  keyLocation?: string;
  /** Override the IndexNow endpoint. Defaults to INDEXNOW_ENDPOINT env or api.indexnow.org. */
  endpoint?: string;
}

export interface SubmitUrlsResult {
  statusCode: number;
  ok: boolean;
  /** True for transient failures (429 / 5xx) the caller should retry; false for terminal (4xx). */
  retryable: boolean;
  /** Number of URLs included in the submission. */
  submitted: number;
}

/**
 * Submit URLs to IndexNow.
 *
 * Does NOT throw on an HTTP error status — returns a structured result with a
 * `retryable` flag so the calling agent can distinguish a terminal payload/key
 * error (4xx, dead-letter) from a transient one (429 / 5xx, reaper backoff).
 * Only throws on a transport-level failure (DNS, timeout, reset), which the
 * caller should treat as retryable.
 *
 * Set INDEXNOW_DRY_RUN=true to skip the network call (dry-run script + tests).
 */
export async function submitUrls(args: SubmitUrlsArgs): Promise<SubmitUrlsResult> {
  const { host, key, urls } = args;
  if (!host) throw new IntegrationError('indexnow', 'host is required');
  if (!key) throw new IntegrationError('indexnow', 'key is required');
  if (urls.length === 0) {
    return { statusCode: 0, ok: true, retryable: false, submitted: 0 };
  }
  if (urls.length > MAX_URLS) {
    throw new IntegrationError('indexnow', `urlList exceeds ${MAX_URLS} (${urls.length})`);
  }

  const endpoint = args.endpoint ?? process.env.INDEXNOW_ENDPOINT ?? DEFAULT_ENDPOINT;
  const keyLocation = args.keyLocation ?? `https://${host}/${key}.txt`;

  if (process.env.INDEXNOW_DRY_RUN === 'true') {
    log.info({ host, urlCount: urls.length, endpoint }, 'indexnow dry-run — skipping submit');
    return { statusCode: 200, ok: true, retryable: false, submitted: urls.length };
  }

  const body = { host, key, keyLocation, urlList: urls };
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    // Transport failure — always retryable. Thrown so BaseAgent records a
    // failed run and the queue reaper retries with backoff.
    throw new IntegrationError(
      'indexnow',
      `submit transport error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // 200 = accepted, 202 = accepted (key validation pending). Both are success.
  const ok = res.status === 200 || res.status === 202;
  // 429 / 5xx are transient. 403 = key file unreachable/invalid, which at
  // go-live is usually DNS or edge propagation catching up — retry (the queue
  // reaper bounds attempts and dead-letters if it stays broken). 400 / 422 are
  // terminal payload errors (a code bug), so they are not retried.
  const retryable = res.status === 403 || res.status === 429 || res.status >= 500;
  if (!ok) {
    const text = await res.text().catch(() => '');
    log.warn(
      { host, status: res.status, retryable, body: text.slice(0, 300) },
      'indexnow submit non-success',
    );
  } else {
    log.info({ host, urlCount: urls.length, status: res.status }, 'indexnow submit ok');
  }
  return { statusCode: res.status, ok, retryable, submitted: urls.length };
}
