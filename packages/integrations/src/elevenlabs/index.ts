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
