import { z } from 'zod';
import { BaseAgent, type AgentContext } from '../base';
import { getAnthropicClient, estimateCostUsd } from '@leadlandlord/integrations/anthropic';

export const LeadQualifierInput = z.object({
  call_id: z.string().uuid(),
  transcript: z.string().min(1),
  niche: z.string(),
  city: z.string(),
  state: z.string(),
  /** Caller-side phone number — useful for spam triangulation. */
  caller_number: z.string().optional(),
  /** Call duration in seconds. */
  duration_s: z.number().int().nonnegative().optional(),
});
export type LeadQualifierInput = z.infer<typeof LeadQualifierInput>;

// Same enum values CallClassifier emits — the two agents feed the same
// operator UI / trial / portfolio-analyst consumers, so they must stay in
// sync. AI-answered calls use LeadQualifier instead of CallClassifier
// (ADR 0031); non-AI calls keep CallClassifier unchanged.
export const LeadQualifierClassification = z.enum([
  'won',
  'quoted',
  'lost',
  'spam',
  'no_voicemail',
  'unclassified',
]);

export const LeadQualifierOutput = z.object({
  classification: LeadQualifierClassification,
  /** Model's confidence 0-1. */
  confidence: z.number().min(0).max(1),
  /** 2-3 sentence tenant-facing summary — this is what the tenant reads in the SMS/email. */
  summary: z.string(),
  /** Overall lead quality 0-100 — higher means more likely to convert to a paying job. */
  qualification_score: z.number().int().min(0).max(100),
  /** What the caller wants, in the caller's own terms. Never invented — "unclear" when the transcript doesn't say. */
  intent: z.string(),
  urgency: z.enum(['emergency', 'this_week', 'flexible', 'just_browsing']),
  /** The type of job/service requested, e.g. "water heater replacement". "unclear" when not stated. */
  job_type: z.string(),
  /** Budget band the caller mentioned, e.g. "$500-1000". Omit — never guess — when not mentioned. */
  budget_band: z.string().optional(),
  /** Service address/area the caller gave. Omit when not mentioned. */
  address: z.string().optional(),
  /** Free-form notes the model wants to surface to the tenant/operator. */
  notes: z.string().optional(),
});
export type LeadQualifierOutput = z.infer<typeof LeadQualifierOutput>;

const SYSTEM_PROMPT = `You qualify inbound phone calls that were answered by an AI voice agent on behalf of a local-service business (the "tenant"). The AI agent asked the caller a niche-specific set of qualifying questions; you read the resulting transcript and produce a structured qualification the tenant can act on within minutes.

Classification labels (pick exactly one — same taxonomy used across the whole call pipeline):
- won — caller booked a service or gave a clear yes
- quoted — the agent/caller discussed a price/estimate but nothing is committed yet
- lost — caller declined, said it was too expensive, or was clearly not going to proceed
- spam — robocall, sales pitch, telemarketer, wrong number, or non-customer
- no_voicemail — dead air, hang-up before any exchange, or an unintelligible transcript
- unclassified — doesn't fit cleanly (use sparingly)

Qualification fields:
- qualification_score (0-100): how likely this lead is to become a paying job. Weigh urgency, clarity of the job description, and whether the caller gave real contact/address details. A caller who hung up immediately or was clearly a robocall scores near 0.
- intent: what the caller wants, in plain language grounded in what they actually said. If the transcript doesn't make this clear, say "unclear" — never invent detail.
- urgency: "emergency" (needs help today/ASAP, safety issue), "this_week" (wants it scheduled soon), "flexible" (no rush, planning ahead), "just_browsing" (price-shopping / no real timeline).
- job_type: the type of work requested (e.g. "water heater replacement", "gutter cleaning"). Use "unclear" when the transcript doesn't specify.
- budget_band: ONLY include when the caller stated a number or range. Omit the field entirely otherwise — do not guess.
- address: ONLY include when the caller gave a service address, street, neighborhood, or ZIP. Omit entirely otherwise.
- notes: optional free-form context worth flagging to the tenant (e.g. "caller mentioned two other properties needing quotes"). Omit when there's nothing notable.

Be honest about missing information. Never fabricate a budget, address, or job detail the caller didn't actually provide — tenants will act on this data and a fabricated address is worse than no address.

Output strict JSON. No prose, no markdown, no preamble. The JSON must match exactly:
{
  "classification": "won" | "quoted" | "lost" | "spam" | "no_voicemail" | "unclassified",
  "confidence": <0..1>,
  "summary": "<2-3 sentences a tenant can read in 5 seconds>",
  "qualification_score": <integer 0-100>,
  "intent": "<plain-language intent, or \\"unclear\\">",
  "urgency": "emergency" | "this_week" | "flexible" | "just_browsing",
  "job_type": "<job type, or \\"unclear\\">",
  "budget_band": "<optional, omit if not mentioned>",
  "address": "<optional, omit if not mentioned>",
  "notes": "<optional, omit when nothing notable>"
}
`;

/**
 * Qualify an AI-answered inbound call transcript into structured lead data
 * (score, intent, urgency, job type, budget band, address) plus the shared
 * classification enum, in a single LLM call. Feeds the tenant SMS/email
 * fan-out (Phase D) and the operator calls list.
 *
 * Uses Haiku by default — cheap per-call qualification. Override via
 * LEAD_QUALIFIER_MODEL env for hard cases.
 */
export class LeadQualifier extends BaseAgent<typeof LeadQualifierInput, typeof LeadQualifierOutput> {
  constructor() {
    super({
      name: 'lead-qualifier',
      inputSchema: LeadQualifierInput,
      outputSchema: LeadQualifierOutput,
      // Same call shouldn't be qualified twice — dedupe by call_id.
      dedupeKeyFn: (i) => i.call_id,
      defaultDailyCapUsd: 5,
    });
  }

  protected async execute(
    input: LeadQualifierInput,
    ctx: AgentContext,
  ): Promise<LeadQualifierOutput> {
    const client = getAnthropicClient();
    const model = process.env.LEAD_QUALIFIER_MODEL ?? 'claude-haiku-4-5-20251001';

    const userPrompt = buildUserPrompt(input);

    ctx.log.info(
      { model, callId: input.call_id, transcriptLen: input.transcript.length },
      'qualifying lead',
    );

    const response = await client.messages.create({
      model,
      max_tokens: 700,
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
    return LeadQualifierOutput.parse(json);
  }
}

function buildUserPrompt(input: LeadQualifierInput): string {
  const lines = [`Site: ${input.niche} in ${input.city}, ${input.state}`];
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
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end < 0 || end < start) {
    throw new Error(`lead-qualifier: response had no JSON: ${text.slice(0, 200)}`);
  }
  const slice = candidate.slice(start, end + 1);
  return JSON.parse(slice);
}
