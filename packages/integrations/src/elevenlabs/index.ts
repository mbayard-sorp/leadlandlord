import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { IntegrationError } from '@leadlandlord/shared/errors';
import { log } from '@leadlandlord/shared/log';

const ELEVENLABS_BASE = 'https://api.elevenlabs.io/v1';

/**
 * ElevenLabs Conversational AI — outbound calls bridged via Twilio.
 *
 * Setup (manual, in the ElevenLabs dashboard):
 *   1. Create an Agent (Conversational AI → Agents → Create new). Give it a
 *      voice + system prompt. Use {{variable}} placeholders for fields we'll
 *      pass via dynamic_variables (e.g. {{niche}}, {{city}}, {{first_name}}).
 *   2. Import a Twilio phone number (Phone Numbers → Add → Twilio). Provide
 *      Twilio Account SID + Auth Token. ElevenLabs assigns a phone_number_id.
 *   3. Drop both IDs into env:
 *        ELEVENLABS_API_KEY=xi-...
 *        ELEVENLABS_AGENT_ID=agent_...
 *        ELEVENLABS_PHONE_NUMBER_ID=phnum_...
 *
 * Docs: https://elevenlabs.io/docs/conversational-ai/api-reference/twilio
 */

async function elevenlabsFetch<T>(path: string, init: { method?: string; body?: unknown }): Promise<T> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new IntegrationError('elevenlabs', 'ELEVENLABS_API_KEY is not set');
  }
  const res = await fetch(`${ELEVENLABS_BASE}${path}`, {
    method: init.method ?? 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new IntegrationError(
      'elevenlabs',
      `${path} → ${res.status} ${text.slice(0, 500)}`,
      res.status,
      text,
    );
  }
  return (await res.json()) as T;
}

const OutboundCallResponseSchema = z.object({
  success: z.boolean().optional(),
  message: z.string().optional(),
  conversation_id: z.string().optional(),
  callSid: z.string().optional(),
  call_sid: z.string().optional(),
});
export type OutboundCallResponse = z.infer<typeof OutboundCallResponseSchema>;

export interface OutboundCallArgs {
  /** Recipient phone in E.164 (e.g. +15125550100). */
  toNumber: string;
  /** ElevenLabs Agent ID. Defaults to ELEVENLABS_AGENT_ID env. */
  agentId?: string;
  /** ElevenLabs phone_number_id. Defaults to ELEVENLABS_PHONE_NUMBER_ID env. */
  agentPhoneNumberId?: string;
  /** Dynamic variables interpolated into the agent's system prompt — e.g.
   * { niche: 'tree removal', city: 'Tucson', first_name: 'Joe' }. */
  dynamicVariables?: Record<string, string | number>;
  /** First message the agent says when the call connects (overrides agent default). */
  firstMessage?: string;
}

/**
 * Place an outbound call via ElevenLabs Conversational AI bridged through
 * Twilio. The agent runs the conversation; we get back a conversation_id +
 * Twilio call SID for correlation.
 *
 * Webhooks for completion can be configured in the agent's dashboard
 * (post-call-summary webhook). For now we don't poll for status — we'll
 * surface conversation outcomes via the operator dashboard once the
 * webhook lands in a future commit.
 */
export async function startOutboundCall(args: OutboundCallArgs): Promise<OutboundCallResponse> {
  const agentId = args.agentId ?? process.env.ELEVENLABS_AGENT_ID;
  const agentPhoneNumberId = args.agentPhoneNumberId ?? process.env.ELEVENLABS_PHONE_NUMBER_ID;
  if (!agentId) {
    throw new IntegrationError(
      'elevenlabs',
      'ELEVENLABS_AGENT_ID not set — create an agent in the ElevenLabs dashboard first',
    );
  }
  if (!agentPhoneNumberId) {
    throw new IntegrationError(
      'elevenlabs',
      'ELEVENLABS_PHONE_NUMBER_ID not set — import a Twilio number in the ElevenLabs dashboard first',
    );
  }

  const body: Record<string, unknown> = {
    agent_id: agentId,
    agent_phone_number_id: agentPhoneNumberId,
    to_number: args.toNumber,
  };

  // Dynamic variables + firstMessage are passed via conversation_initiation_client_data.
  const initData: Record<string, unknown> = {};
  if (args.dynamicVariables && Object.keys(args.dynamicVariables).length > 0) {
    initData.dynamic_variables = args.dynamicVariables;
  }
  if (args.firstMessage) {
    initData.conversation_config_override = {
      agent: { first_message: args.firstMessage },
    };
  }
  if (Object.keys(initData).length > 0) {
    body.conversation_initiation_client_data = initData;
  }

  const res = await elevenlabsFetch<unknown>('/convai/twilio/outbound-call', {
    method: 'POST',
    body,
  });
  const parsed = OutboundCallResponseSchema.parse(res);
  log.info(
    {
      conversationId: parsed.conversation_id,
      callSid: parsed.callSid ?? parsed.call_sid,
      to: args.toNumber,
    },
    'elevenlabs outbound call started',
  );
  return parsed;
}

const ConversationDetailSchema = z.object({
  agent_id: z.string().optional(),
  conversation_id: z.string(),
  status: z.string().optional(),
  transcript: z
    .array(
      z.object({
        role: z.string().optional(),
        message: z.string().optional(),
        time_in_call_secs: z.number().optional(),
      }),
    )
    .optional(),
  metadata: z.record(z.unknown()).optional(),
  analysis: z
    .object({
      call_successful: z.string().optional(),
      transcript_summary: z.string().optional(),
    })
    .optional(),
});
export type ConversationDetail = z.infer<typeof ConversationDetailSchema>;

/**
 * Pull the full transcript + analysis for a completed conversation. Used by
 * the operator dashboard after the post-call webhook fires (or for manual
 * inspection). Returns undefined when the conversation hasn't yet completed
 * its post-call analysis.
 */
export async function getConversation(conversationId: string): Promise<ConversationDetail | null> {
  try {
    const json = await elevenlabsFetch<unknown>(`/convai/conversations/${conversationId}`, {
      method: 'GET',
    });
    return ConversationDetailSchema.parse(json);
  } catch (err) {
    if (err instanceof IntegrationError && err.status === 404) return null;
    throw err;
  }
}

/**
 * Fetch the recorded audio for a completed ElevenLabs conversation (used as
 * the tenant-recording fallback for AI-answered calls, which never get a
 * Twilio `recordingUrl` since the call bridges straight to ElevenLabs — see
 * apps/operator/app/api/tenant-recordings/[callId]/route.ts). Returns null
 * when the conversation has no audio yet (404) or credentials aren't
 * configured — mirrors `getConversation`'s null-on-404 pattern. Mock mode
 * (no ELEVENLABS_API_KEY / MOCK_TELEPHONY=true) returns null so downstream
 * routes fall through to their own "no recording" 404 without a live call.
 */
export async function getConversationAudio(conversationId: string): Promise<Buffer | null> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const useMock = !apiKey || process.env.MOCK_TELEPHONY === 'true';
  if (useMock) return null;

  const res = await fetch(`${ELEVENLABS_BASE}/convai/conversations/${conversationId}/audio`, {
    method: 'GET',
    headers: { 'xi-api-key': apiKey as string },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text();
    throw new IntegrationError(
      'elevenlabs',
      `convai/conversations/${conversationId}/audio → ${res.status} ${text.slice(0, 500)}`,
      res.status,
      text,
    );
  }
  const arrayBuf = await res.arrayBuffer();
  if (arrayBuf.byteLength === 0) return null;
  return Buffer.from(arrayBuf);
}

// ─────────────────────────────────────────────────────────────────────────
// Inbound AI lead call qualification (ADR 0031).
//
// We keep our own Twilio voice webhook as the entry point (signature check,
// `calls` row, spam throttle) and, when the site's call_mode calls for it,
// hand the call off to ElevenLabs' native Twilio inbound integration by
// POSTing to their "register call" endpoint and relaying the TwiML it
// returns back to Twilio. Per-call context (niche, city, question script,
// transfer number) rides along as dynamic variables.
//
// ⚠️ Confidence note: re-verified against current ElevenLabs docs/search
// (this sandboxed environment's egress proxy still blocks elevenlabs.io
// directly, so verification happened out-of-band). `POST
// https://api.elevenlabs.io/v1/convai/twilio/register-call` is the
// documented "use your own Twilio infrastructure" endpoint for inbound
// calls and returns TwiML directly (typically
// `<Response><Connect><Stream .../></Connect></Response>`), with body
// `agent_id`, `from_number`, `to_number`, `direction`,
// `conversation_initiation_client_data: { dynamic_variables,
// conversation_config_override }` — matching the shape below. Still worth a
// final check against the live ElevenLabs account before the first
// production call (endpoint/response shapes can drift between doc
// snapshots and what an account actually returns). Mock mode (below) does
// not depend on the shape being exactly right.
// ─────────────────────────────────────────────────────────────────────────

const RegisterInboundCallResponseSchema = z.union([
  // Most likely shape: ElevenLabs responds with raw TwiML (Content-Type
  // text/xml) that we relay to Twilio unchanged — handled before we ever
  // reach JSON parsing, see registerInboundCall() below.
  z.string(),
  // Fallback shape some ElevenLabs endpoints use: JSON wrapping the TwiML.
  z.object({
    twiml: z.string().optional(),
    callSid: z.string().optional(),
    call_sid: z.string().optional(),
    conversation_id: z.string().optional(),
  }),
]);

export interface RegisterInboundCallArgs {
  /** Caller's number (Twilio `From`), E.164. */
  fromNumber: string;
  /** The tracking number that was called (Twilio `To`), E.164. */
  toNumber: string;
  /** ElevenLabs Agent ID. Defaults to ELEVENLABS_AGENT_ID env. */
  agentId?: string;
  /** Dynamic variables interpolated into the agent's system prompt — e.g.
   * { niche, city, business_name, question_script, transfer_number }. */
  dynamicVariables?: Record<string, string | number | boolean>;
  /** First message the agent says when the call connects (overrides agent default). */
  firstMessage?: string;
}

/** Deterministic mock TwiML — mirrors twilio/index.ts's mock-mode pattern. */
const MOCK_QUALIFICATION_TWIML =
  '<?xml version="1.0" encoding="UTF-8"?><Response><Say>mock elevenlabs qualification</Say></Response>';

/**
 * Register an inbound Twilio call with ElevenLabs' Conversational AI native
 * Twilio integration and return the TwiML ElevenLabs wants us to hand back
 * to Twilio (bridging the caller to the agent). Falls back to a
 * deterministic mock TwiML string when ELEVENLABS_API_KEY/AGENT_ID are
 * unset or MOCK_TELEPHONY=true, so downstream webhook flows stay testable
 * without a live ElevenLabs account.
 */
export async function registerInboundCall(args: RegisterInboundCallArgs): Promise<string> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const agentId = args.agentId ?? process.env.ELEVENLABS_AGENT_ID;
  const useMock = !apiKey || !agentId || process.env.MOCK_TELEPHONY === 'true';

  if (useMock) {
    log.info(
      { from: args.fromNumber, to: args.toNumber, provider: 'mock' },
      'elevenlabs.registerInboundCall using mock TwiML',
    );
    return MOCK_QUALIFICATION_TWIML;
  }

  const initData: Record<string, unknown> = {};
  if (args.dynamicVariables && Object.keys(args.dynamicVariables).length > 0) {
    initData.dynamic_variables = args.dynamicVariables;
  }
  if (args.firstMessage) {
    initData.conversation_config_override = {
      agent: { first_message: args.firstMessage },
    };
  }

  const body: Record<string, unknown> = {
    agent_id: agentId,
    from_number: args.fromNumber,
    to_number: args.toNumber,
    direction: 'inbound',
  };
  if (Object.keys(initData).length > 0) {
    body.conversation_initiation_client_data = initData;
  }

  // Inbound calls can't wait indefinitely for ElevenLabs to respond — Twilio
  // needs TwiML back quickly or the caller hears dead air. An AbortController
  // timeout turns a hung registration into a thrown IntegrationError, which
  // aiQualificationResponseForSite's catch turns into a voicemail fallback
  // rather than leaving the caller connected to nothing.
  const REGISTER_CALL_TIMEOUT_MS = 8_000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REGISTER_CALL_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${ELEVENLABS_BASE}/convai/twilio/register-call`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey as string,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new IntegrationError(
        'elevenlabs',
        `convai/twilio/register-call timed out after ${REGISTER_CALL_TIMEOUT_MS}ms`,
      );
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
  if (!res.ok) {
    const text = await res.text();
    throw new IntegrationError(
      'elevenlabs',
      `convai/twilio/register-call → ${res.status} ${text.slice(0, 500)}`,
      res.status,
      text,
    );
  }

  const contentType = res.headers.get('content-type') ?? '';
  const rawText = await res.text();

  // Raw TwiML response — relay unchanged.
  if (contentType.includes('xml') || rawText.trim().startsWith('<?xml') || rawText.trim().startsWith('<Response')) {
    return rawText;
  }

  // JSON-wrapped TwiML — unwrap.
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawText);
  } catch {
    // Not JSON either — treat the raw body as TwiML-ish text and relay it.
    return rawText;
  }
  const parsed = RegisterInboundCallResponseSchema.parse(parsedJson);
  if (typeof parsed === 'string') return parsed;
  if (parsed.twiml) return parsed.twiml;
  throw new IntegrationError(
    'elevenlabs',
    'convai/twilio/register-call returned JSON with no twiml field',
  );
}

export interface VerifyElevenLabsWebhookArgs {
  /** Raw (unparsed) request body — signature is computed over the exact bytes sent. */
  rawBody: string;
  /** The `ElevenLabs-Signature` header value, e.g. "t=1700000000,v0=abcd...". */
  signatureHeader: string | null;
  secret?: string;
  /** Injectable clock for tests. Defaults to Date.now(). */
  nowMs?: number;
}

const WEBHOOK_MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Verify the `ElevenLabs-Signature` header on inbound ElevenLabs webhooks
 * (conversation-init + post-call).
 *
 * Header format: `t=<unix_seconds>,v0=<hex hmac-sha256>` where the HMAC is
 * computed over `"<t>.<rawBody>"` keyed by the webhook secret. Rejects a
 * missing/malformed header, a timestamp older than 30 minutes, or a
 * signature mismatch (timing-safe compare).
 */
export function verifyElevenLabsWebhook(args: VerifyElevenLabsWebhookArgs): boolean {
  const secret = args.secret ?? process.env.ELEVENLABS_WEBHOOK_SECRET;
  if (!secret || !args.signatureHeader) return false;

  const parts = Object.fromEntries(
    args.signatureHeader
      .split(',')
      .map((piece) => piece.trim())
      .filter(Boolean)
      .map((piece) => {
        const eq = piece.indexOf('=');
        if (eq === -1) return [piece, ''];
        return [piece.slice(0, eq), piece.slice(eq + 1)];
      }),
  );
  const timestampRaw = parts.t;
  const signatureHex = parts.v0;
  if (!timestampRaw || !signatureHex) return false;
  if (!/^\d+$/.test(timestampRaw)) return false;

  const timestampMs = Number.parseInt(timestampRaw, 10) * 1000;
  const now = args.nowMs ?? Date.now();
  if (Number.isNaN(timestampMs) || Math.abs(now - timestampMs) > WEBHOOK_MAX_AGE_MS) {
    return false;
  }

  const signedPayload = `${timestampRaw}.${args.rawBody}`;
  const expectedHex = createHmac('sha256', secret).update(signedPayload, 'utf-8').digest('hex');

  // Hex digests should always be lowercase, but normalize case on both sides
  // before comparing so an uppercase-hex signature header (a legitimate
  // variance some providers/clients use) doesn't spuriously fail verification.
  const expected = Buffer.from(expectedHex.toLowerCase(), 'utf-8');
  const actual = Buffer.from(signatureHex.toLowerCase(), 'utf-8');
  if (expected.length !== actual.length) return false;
  try {
    return timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

/**
 * Render a flat, numbered question script for the `{{question_script}}`
 * dynamic variable passed to the shared ElevenLabs qualification agent.
 * Pure + trivial, but exported so Phase C's conversation-init route reuses
 * exactly this formatting.
 */
export function renderQuestionScript(questions: string[]): string {
  return questions.map((q, i) => `${i + 1}. ${q}`).join('\n');
}

// ─────────────────────────────────────────────────────────────────────────
// Plain TTS (text-to-speech) — used for static voicemail greetings.
// Distinct from the Conversational AI agents above. Returns raw MP3 bytes
// the caller can persist (Sanity asset, Vercel Blob, etc.) and reference
// from `<Play>` TwiML.
//
// Docs: https://elevenlabs.io/docs/api-reference/text-to-speech/convert
// ─────────────────────────────────────────────────────────────────────────

export interface SynthesizeSpeechArgs {
  text: string;
  /** ElevenLabs voice id; defaults to ELEVENLABS_VOICE_ID env or "Rachel". */
  voiceId?: string;
  /** Model id; default `eleven_turbo_v2_5` (fast + cheap, suitable for greetings). */
  modelId?: string;
  /** Output format. Default `mp3_44100_128` (128kbps stereo MP3, Twilio-compatible). */
  outputFormat?: string;
}

export async function synthesizeSpeech(args: SynthesizeSpeechArgs): Promise<Buffer> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new IntegrationError('elevenlabs', 'ELEVENLABS_API_KEY is not set');

  const voiceId =
    args.voiceId ?? process.env.ELEVENLABS_VOICE_ID ?? '21m00Tcm4TlvDq8ikWAM'; // Rachel
  const modelId = args.modelId ?? 'eleven_turbo_v2_5';
  const outputFormat = args.outputFormat ?? 'mp3_44100_128';

  const res = await fetch(
    `${ELEVENLABS_BASE}/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${encodeURIComponent(outputFormat)}`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({ text: args.text, model_id: modelId }),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new IntegrationError(
      'elevenlabs',
      `tts ${voiceId} → ${res.status} ${text.slice(0, 500)}`,
      res.status,
      text,
    );
  }
  const arrayBuf = await res.arrayBuffer();
  log.info({ voiceId, modelId, bytes: arrayBuf.byteLength }, 'elevenlabs.synthesizeSpeech ok');
  return Buffer.from(arrayBuf);
}
