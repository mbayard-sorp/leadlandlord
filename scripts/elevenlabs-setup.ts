/**
 * Create/update the single shared ElevenLabs Conversational AI agent used
 * for inbound AI lead call qualification (ADR 0031).
 *
 * MUST be run by a human with real internet egress (elevenlabs.io is
 * blocked from the Claude Code sandbox that authored this script — never
 * attempt to invoke it there).
 *
 * What it does:
 *   1. Builds the agent config (system prompt, first message, voice,
 *      dynamic-variable defaults, transfer_to_number tool) from the exact
 *      dynamic-variable contract in
 *      apps/operator/lib/twilio-voice.ts (aiQualificationResponseForSite).
 *   2. If ELEVENLABS_AGENT_ID is set, PATCHes that agent in place.
 *      Otherwise POSTs to create a new agent and prints the new id.
 *   3. Prints the post-call webhook URL to configure in the dashboard, plus
 *      the remaining manual steps the API can't do for you.
 *
 * Usage:
 *   pnpm tsx scripts/elevenlabs-setup.ts --operator-host operator.example.com --dry-run
 *   pnpm tsx scripts/elevenlabs-setup.ts --operator-host operator.example.com
 *
 * Env:
 *   ELEVENLABS_API_KEY    required
 *   ELEVENLABS_AGENT_ID   optional — update-in-place target. If unset, creates a new agent.
 *   ELEVENLABS_VOICE_ID   optional — default Rachel (21m00Tcm4TlvDq8ikWAM)
 *
 * ⚠️ API-shape confidence note: this sandbox cannot reach elevenlabs.io, so
 * the payload shape below (conversation_config.agent.prompt.prompt /
 * first_message / language, conversation_config.tts.voice_id,
 * conversation_config.agent.prompt.tools[] for transfer_to_number, and
 * dynamic variable placeholders) is written to the best-documented current
 * shape but is NOT verified against a live account from here. The payload
 * builder lives in ONE function (buildAgentPayload) so it's a single edit
 * point if the shape has drifted, and callElevenLabs() below fails LOUDLY
 * with the full response body on any 4xx so shape drift is self-diagnosing
 * the first time a human runs this for real.
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { parseArgs } from 'node:util';

const ELEVENLABS_BASE = 'https://api.elevenlabs.io/v1';
const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM'; // Rachel

// Canonical dynamic-variable list — MUST match the keys
// aiQualificationResponseForSite() sends in
// apps/operator/lib/twilio-voice.ts. Keep in sync by hand; there's no
// shared module to import from a standalone script.
const DYNAMIC_VARIABLE_DEFAULTS: Record<string, string> = {
  business_name: 'the local service provider',
  niche: 'home services',
  city: 'your area',
  state: '',
  question_script:
    '1. Can I get your full name?\n2. What\'s the best callback number for you?\n3. What\'s the service address for this job?\n4. Can you describe the job or issue you need help with?\n5. Is this an emergency, or can it wait a few days?\n6. How did you hear about us?',
  caller_number: '',
  caller_name: '',
  transfer_number: '',
  warm_transfer_enabled: 'false',
  call_sid: '',
};

const SYSTEM_PROMPT = `You are a professional receptionist answering calls for {{business_name}}, a {{niche}} business serving {{city}}, {{state}}.

Greet the caller warmly, identify yourself as answering for {{business_name}}, and briefly explain you'll take down some details so the team can help them.

Then work through this question script conversationally — ask ONE question at a time, in your own natural words, and let the caller's answers guide follow-ups. Do not read the list verbatim or interrogate the caller:

{{question_script}}

Rules:
- Never fabricate or guess an answer on the caller's behalf. If they don't know or won't say, note that and move on.
- Keep the call efficient and friendly. Most calls should wrap up in a few minutes.
- If the caller is clearly a spam call, robocall, wrong number, or solicitor, end the call briefly and politely without running the question script.

Transfer logic:
- If {{warm_transfer_enabled}} is exactly 'true' AND the caller has a genuine service inquiry, once you have gathered the essentials (name, callback number, job description, urgency) use the transfer_to_number tool to connect them live to {{transfer_number}}.
- Otherwise (warm transfer disabled, or the caller isn't a real lead), close the call politely and let them know the team will call them back shortly. Do not attempt a transfer in this case.`;

const FIRST_MESSAGE =
  "Hi, thanks for calling {{business_name}}! I'm happy to help — can I get a few quick details so the team can get back to you?";

const TRANSFER_TOOL_AGENT_MESSAGE =
  "I have a caller with a {{niche}} inquiry from {{city}}, {{state}} — connecting you now.";
const TRANSFER_TOOL_CLIENT_MESSAGE = 'One moment while I connect you...';

interface CliArgs {
  operatorHost?: string;
  dryRun: boolean;
}

function parseCli(): CliArgs {
  const { values } = parseArgs({
    options: {
      'operator-host': { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
    },
    allowPositionals: false,
  });
  return {
    operatorHost: values['operator-host'],
    dryRun: values['dry-run'] ?? false,
  };
}

/**
 * Single build point for the ElevenLabs agent payload. If the ElevenLabs
 * API rejects this shape, this is the only function you need to edit.
 */
function buildAgentPayload(voiceId: string) {
  return {
    conversation_config: {
      agent: {
        prompt: {
          prompt: SYSTEM_PROMPT,
          // System tool: transfers the live call to the tenant's number
          // once the caller is qualified and warm_transfer_enabled=='true'.
          // Shape per ElevenLabs "system tools" docs (transfer_to_number):
          // a tool entry with type "system", name "transfer_to_number", and
          // params carrying the transfer target + the messages spoken to
          // each party during handoff.
          tools: [
            {
              type: 'system',
              name: 'transfer_to_number',
              description:
                'Transfer the live call to the tenant business when the caller has a genuine, qualified service inquiry and warm_transfer_enabled is true.',
              params: {
                transfers: [
                  {
                    transfer_destination: {
                      type: 'phone',
                      // Dynamic-variable placeholder — resolved per-call from
                      // conversation_initiation_client_data.dynamic_variables.transfer_number.
                      phone_number: '{{transfer_number}}',
                    },
                    condition:
                      "warm_transfer_enabled is 'true' and the caller has a genuine, qualified service inquiry",
                  },
                ],
                agent_message: TRANSFER_TOOL_AGENT_MESSAGE,
                client_message: TRANSFER_TOOL_CLIENT_MESSAGE,
              },
            },
          ],
        },
        first_message: FIRST_MESSAGE,
        language: 'en',
      },
      tts: {
        voice_id: voiceId,
      },
      // ElevenLabs requires a default value for every {{variable}} referenced
      // in the prompt/first_message so the agent validates outside of a live
      // call (e.g. in the dashboard test console). These are generic
      // placeholders — every real call overrides them via
      // conversation_initiation_client_data.dynamic_variables (see
      // packages/integrations/src/elevenlabs/index.ts registerInboundCall).
      dynamic_variables: {
        dynamic_variable_placeholders: DYNAMIC_VARIABLE_DEFAULTS,
      },
    },
    platform_settings: {
      // Keep call recording on so getConversationAudio() has audio to serve
      // via the tenant-recording proxy (ADR 0031 Phase D).
      call_limits: {},
    },
    name: 'LeadLandlord — Shared Inbound Qualifier',
  };
}

/**
 * Fails loudly with the full response body on any 4xx/5xx — this is the
 * self-diagnosing seam for API-shape drift, since the payload shape above
 * could not be verified live from the authoring sandbox.
 */
async function callElevenLabs(
  method: 'POST' | 'PATCH',
  path: string,
  apiKey: string,
  body: unknown,
): Promise<unknown> {
  const res = await fetch(`${ELEVENLABS_BASE}${path}`, {
    method,
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `ElevenLabs ${method} ${path} failed: ${res.status} ${res.statusText}\n` +
        `Response body (inspect for API-shape drift):\n${text}`,
    );
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function main() {
  const args = parseCli();

  // --dry-run never makes a network call, so it doesn't require a real key —
  // that's what lets this script be exercised (and its payload inspected) in
  // environments that can't reach elevenlabs.io at all.
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey && !args.dryRun) {
    throw new Error('ELEVENLABS_API_KEY is required (set it in .env.local).');
  }

  const existingAgentId = process.env.ELEVENLABS_AGENT_ID;
  const voiceId = process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID;

  if (!args.operatorHost) {
    throw new Error(
      'Missing --operator-host <host>. Pass the operator app host, e.g. --operator-host leadlandlord-operator.vercel.app',
    );
  }
  const operatorHost = args.operatorHost.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const postCallWebhookUrl = `https://${operatorHost}/api/webhooks/elevenlabs/post-call`;

  const payload = buildAgentPayload(voiceId);

  if (existingAgentId) {
    console.log(`Updating existing agent ${existingAgentId} (PATCH /convai/agents/${existingAgentId})...`);
  } else {
    console.log('No ELEVENLABS_AGENT_ID set — creating a new agent (POST /convai/agents/create)...');
  }

  if (args.dryRun) {
    const method = existingAgentId ? 'PATCH' : 'POST';
    const path = existingAgentId ? `/convai/agents/${existingAgentId}` : '/convai/agents/create';
    console.log('\n--dry-run: no request sent. Would call:');
    console.log(`  ${method} ${ELEVENLABS_BASE}${path}`);
    console.log('  Headers: { "xi-api-key": "<redacted>", "Content-Type": "application/json" }');
    console.log('  Body:');
    console.log(JSON.stringify(payload, null, 2));
    console.log(`\nPost-call webhook URL (configure in dashboard): ${postCallWebhookUrl}`);
    return;
  }

  // Reachable only when !args.dryRun, which is exactly the branch that
  // guarantees apiKey was validated above.
  const liveApiKey = apiKey as string;

  let agentId = existingAgentId;
  if (existingAgentId) {
    await callElevenLabs('PATCH', `/convai/agents/${existingAgentId}`, liveApiKey, payload);
  } else {
    const created = (await callElevenLabs('POST', '/convai/agents/create', liveApiKey, payload)) as {
      agent_id?: string;
    };
    agentId = created.agent_id;
    if (!agentId) {
      throw new Error(
        `Agent creation succeeded but response had no agent_id — inspect the raw response:\n${JSON.stringify(created, null, 2)}`,
      );
    }
  }

  console.log('\n✓ Agent configured.');
  console.log(`\nELEVENLABS_AGENT_ID=${agentId}`);
  console.log(`\nPost-call webhook URL to configure in the ElevenLabs dashboard:`);
  console.log(`  ${postCallWebhookUrl}`);
  console.log('\nRemaining MANUAL steps (dashboard — the API can\'t do these):');
  console.log(
    '  1. Enable the workspace "Post-call transcription" webhook, pointing it at the URL above.',
  );
  console.log(
    '  2. Copy that webhook\'s HMAC signing secret into ELEVENLABS_WEBHOOK_SECRET (Vercel env + .env.local).',
  );
  console.log(
    '  3. If using warm transfer, open the agent in the dashboard and verify the transfer_to_number tool appears with the transfer_number dynamic-variable target.',
  );
  console.log(
    `  4. Set ELEVENLABS_AGENT_ID=${agentId} (and ELEVENLABS_API_KEY / ELEVENLABS_VOICE_ID) in Vercel for the operator project, then redeploy.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
