import { z } from 'zod';
import { BaseAgent, type AgentContext } from '../base';
import { getAnthropicClient, estimateCostUsd } from '@leadlandlord/integrations/anthropic';

export const CallClassifierInput = z.object({
  call_id: z.string().uuid(),
  transcript: z.string().min(1),
  niche: z.string(),
  city: z.string(),
  state: z.string(),
  /** Caller-side phone number — useful for spam triangulation. */
  caller_number: z.string().optional(),
  /** Call duration in seconds — short calls are usually voicemail/hangup. */
  duration_s: z.number().int().nonnegative().optional(),
});
export type CallClassifierInput = z.infer<typeof CallClassifierInput>;

export const CallClassifierOutput = z.object({
  classification: z.enum(['won', 'quoted', 'lost', 'spam', 'no_voicemail', 'unclassified']),
  /** Model's confidence 0–1. Used by Operator to decide whether to escalate edge cases. */
  confidence: z.number().min(0).max(1),
  /** One-sentence summary of what the caller wanted. */
  summary: z.string(),
  /** Best-effort revenue estimate when a job was quoted/won, USD. */
  est_revenue_usd: z.number().nonnegative().optional(),
  /** Free-form notes the model wants to surface to the operator. */
  notes: z.string().optional(),
});
export type CallClassifierOutput = z.infer<typeof CallClassifierOutput>;

const SYSTEM_PROMPT = `You classify inbound phone calls to local-services tracking numbers.

A site receives calls from prospects. Each call has a transcript captured by Twilio Voice Intelligence. Your job: read the transcript and decide whether the call was a won job, a quote that hasn't closed yet, a lost lead, a spam/wrong-number call, or a voicemail with no useful content.

Classification labels (pick exactly one):
- won — caller booked a service or gave a clear yes (e.g., "schedule me for Saturday")
- quoted — provider gave a price/estimate but the caller hasn't committed yet
- lost — caller declined, said it was too expensive, or was clearly shopping but not buying
- spam — robocall, sales pitch, telemarketer, wrong number, or non-customer (e.g. someone trying to sell SEO services)
- no_voicemail — voicemail beep with no message, hang-up, blank transcript, or unintelligible noise
- unclassified — something that doesn't fit any other label cleanly (use sparingly)

Output strict JSON. No prose, no markdown, no preamble. The JSON must match exactly:
{
  "classification": "won" | "quoted" | "lost" | "spam" | "no_voicemail" | "unclassified",
  "confidence": <0..1>,
  "summary": "<one sentence>",
  "est_revenue_usd": <number, omit when not quoted/won>,
  "notes": "<optional, omit when nothing notable>"
}

Estimating revenue (only when classification is "won" or "quoted"):
- Use the niche + city to anchor a reasonable price band
- Trades like tree removal, roofing, HVAC: $300–$5,000+ per job
- Cleaning, lawn, dog walking: $80–$300 per visit, monthly recurring possible
- Remodels and custom landscape: $5K–$50K+
- If the transcript mentions a specific dollar figure, use that
- Don't guess wildly — when uncertain, omit est_revenue_usd

Confidence guidance:
- 0.9+ when the caller's intent is unambiguous (booking, decline, robocall opening)
- 0.6–0.8 when there's some ambiguity
- Below 0.5 when the transcript is partial/garbled — operator will review by hand
`;

/**
 * Classify a single call transcript and (optionally) estimate its revenue.
 *
 * Uses Haiku by default for cost — classification is a small task. Override
 * via CALL_CLASSIFIER_MODEL env if you want Sonnet/Opus on hard cases.
 */
export class CallClassifier extends BaseAgent<typeof CallClassifierInput, typeof CallClassifierOutput> {
  constructor() {
    super({
      name: 'call-classifier',
      inputSchema: CallClassifierInput,
      outputSchema: CallClassifierOutput,
      // Same call shouldn't be classified twice — dedupe by call_id.
      dedupeKeyFn: (i) => i.call_id,
      defaultDailyCapUsd: 5,
    });
  }

  protected async execute(
    input: CallClassifierInput,
    ctx: AgentContext,
  ): Promise<CallClassifierOutput> {
    const client = getAnthropicClient();
    const model = process.env.CALL_CLASSIFIER_MODEL ?? 'claude-haiku-4-5-20251001';

    const userPrompt = buildUserPrompt(input);

    ctx.log.info(
      { model, callId: input.call_id, transcriptLen: input.transcript.length },
      'classifying call',
    );

    const response = await client.messages.create({
      model,
      max_tokens: 600,
      temperature: 0,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const usage = response.usage;
    const cost = estimateCostUsd(model, {
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
      cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
    });
    ctx.recordUsage({
      model,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
      cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
      cost_usd: cost,
    });

    const text = response.content
      .filter((block) => block.type === 'text')
      .map((block) => (block as { type: 'text'; text: string }).text)
      .join('');

    const json = extractJson(text);
    return CallClassifierOutput.parse(json);
  }
}

function buildUserPrompt(input: CallClassifierInput): string {
  const lines = [
    `Site: ${input.niche} in ${input.city}, ${input.state}`,
  ];
  if (input.caller_number) lines.push(`Caller: ${input.caller_number}`);
  if (typeof input.duration_s === 'number') lines.push(`Duration: ${input.duration_s}s`);
  lines.push('', 'Transcript:', input.transcript);
  return lines.join('\n');
}

/**
 * Extract a JSON object from the model's response. Tolerates surrounding
 * prose / markdown code fences in case the model deviates from the system
 * prompt's strict-JSON instruction.
 */
function extractJson(text: string): unknown {
  // Strip markdown fences if present.
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = fenced?.[1] ?? text;
  // Find the first balanced JSON object.
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end < 0 || end < start) {
    throw new Error(`call-classifier: response had no JSON: ${text.slice(0, 200)}`);
  }
  const slice = candidate.slice(start, end + 1);
  return JSON.parse(slice);
}
