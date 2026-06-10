/**
 * Molly — guest-post outreach agent.
 *
 * Catches all four live event wires (prospect, prospect_approved, nudge,
 * deliver) under a single agent name so they stop dead-lettering. Internally
 * dispatches to mode-specific modules.
 *
 * Modes:
 *   prospect        — web_search discovery; emitted by run-actions.ts
 *   prospect_approved — pitch sending; emitted by approveProspect + setProspectContact
 *   nudge           — follow-up nudge; emitted by molly-nudge scheduler
 *   deliver         — draft delivery; emitted by approveDraft (Phase 2)
 *
 * dedupeKeyFn per mode:
 *   prospect:         molly:prospect:<siteId>:<YYYYMMDD>
 *   prospect_approved: molly:pitch:<prospectId>:<contactEmail|nocontact>
 *   nudge:            molly-nudge:<backlinkId>:<expectedNudgeCount>  (matches scheduler key)
 *   deliver:          molly:deliver:<backlinkId>
 *
 * The prospect_approved dedupeKey embeds the contactEmail so a re-emit from
 * setProspectContact (with a real email) carries a DIFFERENT key than the
 * prior contact-missing run (which used 'nocontact'). This is the mechanism
 * that lets the re-pitch path execute despite the prior run's success being
 * cached. See ADR-0006 + plan section "Dedupe-key trap".
 */

import { z } from 'zod';
import { BaseAgent, type AgentContext } from '../base';
import { runProspect, ProspectOutput } from './prospect';
import { runPitch, PitchOutput } from './pitch';
import { runNudge, NudgeOutput } from './nudge';
import { runDeliver, DeliverOutput } from './deliver';

// ── Input schemas per mode ─────────────────────────────────────────────────────

const ProspectInput = z.object({
  mode: z.literal('prospect'),
  siteId: z.string().uuid(),
  /** Accepted from run-actions.ts payload; ignored at runtime. */
  maxApolloEnrichments: z.number().optional(),
  /** Legacy field name also present in some payloads. */
  site_id: z.string().uuid().optional(),
});

const ProspectApprovedInput = z.object({
  mode: z.literal('prospect_approved'),
  siteId: z.string().uuid(),
  prospectId: z.string().uuid(),
  /** Operator-supplied dedupeKey override (see plan "Dedupe-key trap"). */
  dedupeKey: z.string().optional(),
});

const NudgeInput = z.object({
  mode: z.literal('nudge'),
  backlinkId: z.string().uuid(),
  expectedNudgeCount: z.number().int(),
  siteId: z.string().uuid().optional(),
});

const DeliverInput = z.object({
  mode: z.literal('deliver'),
  backlinkId: z.string().uuid(),
  siteId: z.string().uuid().optional(),
});

// ── Discriminated union ───────────────────────────────────────────────────────

const MollyInput = z.discriminatedUnion('mode', [
  ProspectInput,
  ProspectApprovedInput,
  NudgeInput,
  DeliverInput,
]);
type MollyInput = z.infer<typeof MollyInput>;

// ── Output (union of per-mode outputs) ────────────────────────────────────────

const MollyOutput = z.union([ProspectOutput, PitchOutput, NudgeOutput, DeliverOutput]);
type MollyOutput = z.infer<typeof MollyOutput>;

// ── YYYYMMDD helper ───────────────────────────────────────────────────────────

function todayYMD(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

// ── Agent ─────────────────────────────────────────────────────────────────────

export class Molly extends BaseAgent<typeof MollyInput, typeof MollyOutput> {
  constructor() {
    super({
      name: 'molly',
      inputSchema: MollyInput,
      outputSchema: MollyOutput,
      dedupeKeyFn: (input: MollyInput): string | undefined => {
        switch (input.mode) {
          case 'prospect':
            return `molly:prospect:${input.siteId}:${todayYMD()}`;
          case 'prospect_approved': {
            // The dedupeKey for pitch mode embeds the contactEmail so a
            // re-emit after setProspectContact uses a different key than
            // the prior contact-missing run. This is the mechanism that
            // lets the re-pitch execute after the first run cached
            // 'skipped_no_contact'. See ADR-0006 dedupe-key trap.
            //
            // If the emitter passes an explicit dedupeKey in the payload
            // (operator-tick supports payload.dedupeKey as opts.dedupeKey
            // override at lines 114-127), that takes precedence via
            // BaseAgent.run(). Our dedupeKeyFn is the fallback.
            return `molly:pitch:${input.prospectId}:nocontact`;
          }
          case 'nudge':
            // Must match the scheduler's key format exactly:
            // molly-nudge:<backlinkId>:<expectedNudgeCount>
            return `molly-nudge:${input.backlinkId}:${input.expectedNudgeCount}`;
          case 'deliver':
            return `molly:deliver:${input.backlinkId}`;
        }
      },
      defaultDailyCapUsd: 5,
    });
  }

  protected async execute(input: MollyInput, ctx: AgentContext): Promise<MollyOutput> {
    switch (input.mode) {
      case 'prospect':
        return runProspect({ siteId: input.siteId }, ctx);

      case 'prospect_approved':
        return runPitch({ siteId: input.siteId, prospectId: input.prospectId }, ctx);

      case 'nudge':
        return runNudge(
          {
            backlinkId: input.backlinkId,
            expectedNudgeCount: input.expectedNudgeCount,
            siteId: input.siteId,
          },
          ctx,
        );

      case 'deliver':
        return runDeliver({ backlinkId: input.backlinkId, siteId: input.siteId }, ctx);
    }
  }
}
