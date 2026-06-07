import { IntegrationError } from '@leadlandlord/shared/errors';
import { log } from '@leadlandlord/shared/log';

const AI_GATEWAY_BASE = 'https://ai-gateway.vercel.sh/v1';
const GOOGLE_AI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * Hero image generation. Returns raw bytes — caller is responsible for
 * uploading to wherever (Sanity assets, Vercel Blob, S3, etc).
 *
 * Routes through one of:
 *
 *   1. Google AI Studio direct — if GOOGLE_API_KEY is set (preferred — one
 *      less hop, simpler debugging).
 *      Get a key at https://aistudio.google.com/apikey.
 *      Model controlled by GOOGLE_IMAGEN_MODEL (default:
 *      imagen-4.0-fast-generate-001).
 *
 *   2. Vercel AI Gateway  — if AI_GATEWAY_API_KEY is set.
 *      Get a key at https://vercel.com/dashboard/ai-gateway.
 *      Model controlled by IMAGEN_MODEL (default: google/imagen-4.0-fast-generate-001).
 *
 *   3. No-op fallback — neither key set. Returns null and the variant
 *      component renders its placeholder background.
 *
 * IMAGEN_PROVIDER=google|ai-gateway forces a specific path (skips fallback).
 *
 * Imagen costs ~$0.02–0.04 per image at Google list pricing. One hero per site.
 */

export interface HeroImageBuffer {
  buffer: Buffer;
  /** image/jpeg or image/png — currently always jpeg from ai-gateway, png from google. */
  contentType: string;
  size: number;
  model: string;
  provider: 'ai-gateway' | 'google';
  costUsd?: number;
}

export async function generateHeroImageBuffer(
  prompt: string,
  opts: {
    aspectRatio?: '16:9' | '4:3' | '1:1' | '3:2';
    negativePrompt?: string;
    /**
     * When false, the prompt is sent verbatim — skipping the hero-photo
     * enrichment ("Photorealistic… professional photography… no text or logos").
     * Required for logo/icon generation, where that enrichment forces a photo
     * and literally instructs the model not to draw a logo. Defaults true.
     */
    enrich?: boolean;
  } = {},
): Promise<HeroImageBuffer | null> {
  // MOCK_AI: skip image generation entirely. Site-builder treats this as
  // non-fatal — the theme renders a placeholder background. Lets the full
  // build pipeline complete with $0 image-gen spend.
  if (process.env.MOCK_AI === 'true') {
    return null;
  }
  const aiGatewayKey = process.env.AI_GATEWAY_API_KEY;
  const googleKey = process.env.GOOGLE_API_KEY;
  const forced = process.env.IMAGEN_PROVIDER as 'google' | 'ai-gateway' | undefined;
  const order: Array<'google' | 'ai-gateway'> = forced ? [forced] : ['google', 'ai-gateway'];

  const aspectRatio = opts.aspectRatio ?? '16:9';
  const enrich = opts.enrich ?? true;
  let lastErr: unknown = null;

  for (const provider of order) {
    if (provider === 'google' && googleKey) {
      try {
        return await bufferViaGoogle(prompt, aspectRatio, googleKey, enrich);
      } catch (err) {
        lastErr = err;
        log.warn(
          { err: err instanceof Error ? err.message : String(err) },
          'google imagen failed — trying next provider',
        );
      }
    }
    if (provider === 'ai-gateway' && aiGatewayKey) {
      try {
        return await bufferViaAiGateway(prompt, aspectRatio, aiGatewayKey, opts.negativePrompt, enrich);
      } catch (err) {
        lastErr = err;
        log.warn(
          { err: err instanceof Error ? err.message : String(err) },
          'ai-gateway imagen failed — trying next provider',
        );
      }
    }
  }
  if (lastErr) throw lastErr;
  log.warn('No AI_GATEWAY_API_KEY or GOOGLE_API_KEY set — skipping hero image generation');
  return null;
}

async function bufferViaGoogle(
  prompt: string,
  aspectRatio: '16:9' | '4:3' | '1:1' | '3:2',
  key: string,
  enrich = true,
): Promise<HeroImageBuffer> {
  const model = process.env.GOOGLE_IMAGEN_MODEL ?? 'imagen-4.0-fast-generate-001';
  const body = {
    instances: [{ prompt: enrich ? enrichPrompt(prompt) : prompt }],
    parameters: { sampleCount: 1, aspectRatio, personGeneration: 'allow_adult' },
  };
  log.info({ model, aspectRatio, prompt: prompt.slice(0, 80) }, 'requesting hero image (google)');
  const url = `${GOOGLE_AI_BASE}/models/${encodeURIComponent(model)}:predict?key=${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = await safeBody(res);
    log.error({ status: res.status, body: errBody, model }, 'google-imagen error response');
    throw new IntegrationError('google-imagen', `Image generation failed: ${res.status}`, res.status, errBody);
  }
  const json = (await res.json()) as {
    predictions?: Array<{ bytesBase64Encoded?: string; mimeType?: string }>;
  };
  const item = json.predictions?.[0];
  if (!item?.bytesBase64Encoded) {
    throw new IntegrationError('google-imagen', 'Empty image response', undefined, json);
  }
  const buffer = Buffer.from(item.bytesBase64Encoded, 'base64');
  return {
    buffer,
    contentType: item.mimeType ?? 'image/jpeg',
    size: buffer.byteLength,
    model,
    provider: 'google',
  };
}

async function bufferViaAiGateway(
  prompt: string,
  aspectRatio: '16:9' | '4:3' | '1:1' | '3:2',
  key: string,
  negativePrompt?: string,
  enrich = true,
): Promise<HeroImageBuffer> {
  const model = process.env.IMAGEN_MODEL ?? 'google/imagen-4.0-fast-generate-001';
  const size = sizeForAspect(aspectRatio);
  const body = {
    model,
    prompt: enrich ? enrichPrompt(prompt) : prompt,
    n: 1,
    size,
    response_format: 'b64_json' as const,
    ...(negativePrompt ? { negative_prompt: negativePrompt } : {}),
  };
  log.info({ model, aspectRatio, prompt: prompt.slice(0, 80) }, 'requesting hero image (ai-gateway)');
  const res = await fetch(`${AI_GATEWAY_BASE}/images/generations`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = await safeBody(res);
    log.error({ status: res.status, body: errBody, model }, 'ai-gateway error response');
    throw new IntegrationError('ai-gateway', `Image generation failed: ${res.status}`, res.status, errBody);
  }
  const json = (await res.json()) as {
    data?: Array<{ b64_json?: string; url?: string }>;
    usage?: { total_cost?: number };
  };
  const item = json.data?.[0];
  if (!item) {
    throw new IntegrationError('ai-gateway', 'Empty image response');
  }
  const buffer = await readImageBuffer(item);
  return {
    buffer,
    contentType: 'image/jpeg',
    size: buffer.byteLength,
    model,
    provider: 'ai-gateway',
    costUsd: json.usage?.total_cost,
  };
}

async function readImageBuffer(item: { b64_json?: string; url?: string }): Promise<Buffer> {
  if (item.b64_json) {
    return Buffer.from(item.b64_json, 'base64');
  }
  if (item.url) {
    const dl = await fetch(item.url);
    if (!dl.ok) {
      throw new IntegrationError('imagen', `Failed to download image: ${dl.status}`);
    }
    return Buffer.from(await dl.arrayBuffer());
  }
  throw new IntegrationError('imagen', 'Image response had neither b64_json nor url');
}

async function safeBody(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    try {
      return await res.text();
    } catch {
      return null;
    }
  }
}

function sizeForAspect(aspect: string): string {
  switch (aspect) {
    case '16:9':
      return '1536x896';
    case '4:3':
      return '1408x1024';
    case '3:2':
      return '1536x1024';
    case '1:1':
    default:
      return '1024x1024';
  }
}

function enrichPrompt(prompt: string): string {
  return [
    prompt,
    'Photorealistic, natural daylight, no text or logos in image, no watermarks, professional photography, high detail.',
  ].join(' ');
}
