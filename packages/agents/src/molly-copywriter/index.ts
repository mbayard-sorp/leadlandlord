import { z } from 'zod';
import { eq } from 'drizzle-orm';
import {
  getDb,
  backlinks,
  backlinkProspects,
  sites,
  tenants,
  type Site,
  type Tenant,
} from '@leadlandlord/db';
import { getAnthropicClient, estimateCostUsd } from '@leadlandlord/integrations/anthropic';
import { scrapeUrlMarkdown } from '@leadlandlord/integrations/firecrawl';
import { BaseAgent, type AgentContext } from '../base';
import { MOLLY_PERSONA } from '../molly/persona';
import { pickAnchor, type AnchorType, type AnchorPick } from '../seo-expert/anchor-policy';

/**
 * MollyCopywriter — drafts a 1,000–1,500 word guest post when a target
 * editor has accepted Molly's pitch. ADR-0006 state machine:
 *
 *   accepted → drafting → draft_pending_review  (this agent)
 *   draft_pending_review → draft_approved        (operator)
 *   draft_approved → delivered → published       (R4.7)
 *
 * Triggered by `guest_post.accepted` events from MollyInbox (and from the
 * operator UI when a row is manually flipped to `accepted`). Event-driven,
 * no scheduler — the cron dispatcher picks it up.
 *
 * Idempotency: per-backlink dedupe key. Re-runs are no-ops via
 * findExistingSuccess. Inside execute() we also short-circuit when the
 * row already has draft_markdown — protects against the cached-run path
 * being bypassed by a force-dedupeKey caller.
 */

const MollyCopywriterInput = z.object({
  backlinkId: z.string().uuid(),
});

const MollyCopywriterOutput = z.object({
  backlinkId: z.string().uuid(),
  status: z.enum(['drafted', 'skipped_wrong_status', 'skipped_already_drafted']),
  anchorType: z.enum(['branded', 'naked', 'generic', 'partial']).nullable(),
  anchorText: z.string().nullable(),
  draftWordCount: z.number().int().nullable(),
  anchorParagraphIndex: z.number().int().nullable(),
  voiceSource: z.enum(['cache', 'firecrawl', 'fallback']).nullable(),
});

type MollyCopywriterInput = z.infer<typeof MollyCopywriterInput>;
type MollyCopywriterOutput = z.infer<typeof MollyCopywriterOutput>;

const COPYWRITER_MODEL = process.env.MOLLY_COPYWRITER_MODEL ?? 'claude-sonnet-4-6';
const VOICE_MODEL = process.env.MOLLY_COPYWRITER_VOICE_MODEL ?? 'claude-haiku-4-5';

/** Per-bucket prompt fragment so Sonnet plants the anchor naturally. */
const ANCHOR_INSTRUCTIONS: Record<AnchorType, (text: string) => string> = {
  branded: (t) => `Plant the anchor "${t}" once, as the visible link text. The brand name should read naturally in the surrounding sentence — do not force it.`,
  naked: (t) => `Plant the URL ${t} once, as the visible link text. Surround it with a complete sentence (no orphan URL on its own line).`,
  generic: (t) => `Plant a short link with the visible text "${t}" once, pointing to a relevant resource. The phrase must fit the sentence; do not bold or quote it.`,
  partial: (t) => `Plant the anchor "${t}" once, as the visible link text. Use it naturally inside a sentence about the service area.`,
};

export class MollyCopywriter extends BaseAgent<
  typeof MollyCopywriterInput,
  typeof MollyCopywriterOutput
> {
  constructor() {
    super({
      name: 'molly-copywriter',
      inputSchema: MollyCopywriterInput,
      outputSchema: MollyCopywriterOutput,
      dedupeKeyFn: (input) => `molly-copywriter:${input.backlinkId}`,
      defaultDailyCapUsd: 5,
    });
  }

  protected async execute(
    input: MollyCopywriterInput,
    ctx: AgentContext,
  ): Promise<MollyCopywriterOutput> {
    const db = getDb();

    // 1. Load backlink + guards.
    const [row] = await db
      .select()
      .from(backlinks)
      .where(eq(backlinks.id, input.backlinkId))
      .limit(1);
    if (!row) throw new Error(`backlink ${input.backlinkId} not found`);

    if (row.status !== 'accepted') {
      ctx.log.info(
        { backlinkId: row.id, status: row.status },
        'molly-copywriter: status != accepted, skipping',
      );
      return {
        backlinkId: row.id,
        status: 'skipped_wrong_status',
        anchorType: null,
        anchorText: null,
        draftWordCount: null,
        anchorParagraphIndex: null,
        voiceSource: null,
      };
    }
    if (row.draftMarkdown && row.draftMarkdown.trim().length > 0) {
      ctx.log.info({ backlinkId: row.id }, 'molly-copywriter: draft already exists, skipping');
      return {
        backlinkId: row.id,
        status: 'skipped_already_drafted',
        anchorType: (row.anchorType as AnchorType | null) ?? null,
        anchorText: null,
        draftWordCount: null,
        anchorParagraphIndex: null,
        voiceSource: null,
      };
    }

    // 2. Flip to `drafting` so the operator sees activity. If we crash before
    //    the final update, the row sits in `drafting` and the operator can
    //    re-enqueue via the regenerate button (R4.5 scope).
    await db
      .update(backlinks)
      .set({ status: 'drafting' })
      .where(eq(backlinks.id, row.id));

    // 3. Load site + tenant + (optional) prospect for context.
    const [site] = await db.select().from(sites).where(eq(sites.id, row.siteId)).limit(1);
    if (!site) throw new Error(`site ${row.siteId} not found for backlink ${row.id}`);
    const tenant = site.tenantId
      ? (await db.select().from(tenants).where(eq(tenants.id, site.tenantId)).limit(1))[0] ?? null
      : null;

    // Find a prospect row keyed on (siteId, sourceDomain) for cached voice signals.
    const [prospect] = await db
      .select()
      .from(backlinkProspects)
      .where(eq(backlinkProspects.backlinkId, row.id))
      .limit(1);

    // 4. Voice extraction (cached on prospect.metadata.targetVoice when available).
    ctx.progress({ label: 'extracting target voice' });
    const voice = await this.loadVoice({
      ctx,
      prospectId: prospect?.id ?? null,
      prospectMeta: (prospect?.metadata ?? null) as Record<string, unknown> | null,
      domain: row.sourceDomain,
    });

    // 5. Pick anchor deterministically.
    const anchor = await pickAnchor(row.siteId);

    // 6. Draft (Sonnet).
    ctx.progress({ label: 'drafting guest post' });
    const draft = await this.draftPost({
      ctx,
      site,
      tenant,
      anchor,
      voiceNotes: voice.notes,
      sourceDomain: row.sourceDomain,
      pitchTopic:
        typeof (row.metadata as Record<string, unknown> | null)?.pitchTopic === 'string'
          ? ((row.metadata as Record<string, unknown>).pitchTopic as string)
          : null,
    });

    const wordCount = countWords(draft.markdown);
    const anchorIndex = findAnchorParagraphIndex(draft.markdown, anchor.text);

    // 7. Persist draft + transition to draft_pending_review.
    const existingMeta = (row.metadata ?? {}) as Record<string, unknown>;
    await db
      .update(backlinks)
      .set({
        status: 'draft_pending_review',
        draftMarkdown: draft.markdown,
        anchorType: anchor.type,
        metadata: {
          ...existingMeta,
          draftWordCount: wordCount,
          anchorParagraphIndex: anchorIndex,
          anchorText: anchor.text,
          anchorDistribution: anchor.distribution,
          draftedAt: new Date().toISOString(),
          voiceSource: voice.source,
        },
      })
      .where(eq(backlinks.id, row.id));

    ctx.log.info(
      {
        backlinkId: row.id,
        wordCount,
        anchorType: anchor.type,
        anchorIndex,
        voiceSource: voice.source,
      },
      'molly-copywriter: draft persisted',
    );

    return {
      backlinkId: row.id,
      status: 'drafted',
      anchorType: anchor.type,
      anchorText: anchor.text,
      draftWordCount: wordCount,
      anchorParagraphIndex: anchorIndex,
      voiceSource: voice.source,
    };
  }

  /**
   * Voice extraction pre-pass. Returns short style notes that get injected
   * into the Sonnet system prompt so the draft matches the target blog's
   * tone. Uses Haiku — cheap and adequate for "extract a tone summary."
   *
   * Cache strategy: store on `backlink_prospects.metadata.targetVoice` keyed
   * by domain. Subsequent pitches against the same target reuse the cached
   * signals (and we can audit drift later by inspecting that field).
   *
   * Fallback: if Firecrawl scrapes nothing and there's no cached voice,
   * return a neutral default — the persona system prompt already handles
   * 90% of voice without target-specific calibration.
   */
  private async loadVoice(args: {
    ctx: AgentContext;
    prospectId: string | null;
    prospectMeta: Record<string, unknown> | null;
    domain: string;
  }): Promise<{ notes: string; source: 'cache' | 'firecrawl' | 'fallback' }> {
    const cached =
      args.prospectMeta && typeof args.prospectMeta.targetVoice === 'string'
        ? (args.prospectMeta.targetVoice as string)
        : null;
    if (cached && cached.length > 0) {
      args.ctx.log.info({ domain: args.domain }, 'molly-copywriter: voice cache hit');
      return { notes: cached, source: 'cache' };
    }

    // Try to scrape the target's homepage as a voice sample. Cheap and
    // usually enough — a marketing/blog index page carries plenty of tone.
    const url = `https://${args.domain.replace(/^https?:\/\//, '').replace(/\/$/, '')}`;
    const markdown = await scrapeUrlMarkdown(url).catch(() => null);
    if (!markdown || markdown.trim().length < 200) {
      args.ctx.log.info(
        { domain: args.domain },
        'molly-copywriter: no usable voice sample, falling back to neutral',
      );
      return {
        notes:
          'No target-specific voice sample available. Default to a plainspoken, practical tone — short paragraphs, second person, no marketing fluff.',
        source: 'fallback',
      };
    }

    const anthropic = getAnthropicClient();
    const systemPrompt = `You read a blog page and summarize its writing voice in 3–4 short bullet points. Focus on: sentence length, vocabulary register (plain/technical/playful), use of first/second person, and any structural quirks (subheads, lists, anecdotes). Do not summarize the topic. Output bullets only, no preamble.`;
    const userMessage = `Voice sample from ${args.domain}:\n\n${markdown.slice(0, 6000)}`;

    try {
      const response = await anthropic.messages.create({
        model: VOICE_MODEL,
        max_tokens: 400,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      });
      const usage = response.usage;
      args.ctx.recordUsage({
        model: VOICE_MODEL,
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
        cost_usd: estimateCostUsd(VOICE_MODEL, {
          input_tokens: usage.input_tokens,
          output_tokens: usage.output_tokens,
        }),
      });
      const text = response.content.find((b) => b.type === 'text');
      const notes = text && text.type === 'text' ? text.text.trim() : '';
      if (notes.length === 0) {
        return {
          notes:
            'No voice signal extracted. Default to plainspoken, practical, second-person tone.',
          source: 'fallback',
        };
      }

      // Cache on the prospect row for next time.
      if (args.prospectId) {
        const db = getDb();
        const merged = { ...(args.prospectMeta ?? {}), targetVoice: notes };
        await db
          .update(backlinkProspects)
          .set({ metadata: merged })
          .where(eq(backlinkProspects.id, args.prospectId));
      }

      return { notes, source: 'firecrawl' };
    } catch (err) {
      args.ctx.log.warn(
        { domain: args.domain, err: err instanceof Error ? err.message : String(err) },
        'molly-copywriter: voice extraction failed, falling back',
      );
      return {
        notes:
          'Voice extraction failed. Default to plainspoken, practical, second-person tone.',
        source: 'fallback',
      };
    }
  }

  /** Generate the actual draft via Sonnet. */
  private async draftPost(args: {
    ctx: AgentContext;
    site: Site;
    tenant: Tenant | null;
    anchor: AnchorPick;
    voiceNotes: string;
    sourceDomain: string;
    pitchTopic: string | null;
  }): Promise<{ markdown: string }> {
    const { ctx, site, tenant, anchor, voiceNotes, sourceDomain, pitchTopic } = args;

    const businessName = tenant?.businessName ?? 'a local home-services business';
    const topic =
      pitchTopic ?? `practical guide to ${site.niche} for homeowners in ${site.city}`;

    // System: Molly persona + voice calibration + structural rules.
    const systemPrompt = `${MOLLY_PERSONA.voiceSystemPrompt}

You are writing a guest blog post for an outside publication. The post is NOT a sales pitch — it teaches the reader something useful in the topic area, and includes exactly one link back to the business when it is naturally relevant.

Target blog voice (calibrate to this):
${voiceNotes}

Structural rules:
- Length: 1,000–1,500 words. Do not write headers like "Word count" or meta-commentary.
- Format: GitHub-flavored markdown. Use ## for section headings (not # — that's the post title, which the editor sets).
- Open with a concrete anecdote, statistic, or scene — never "In today's world".
- Body: 4–7 short sections with ## headings. Plain paragraphs, no walls of text.
- Use ordered or bulleted lists when listing 3+ items. Otherwise prefer prose.
- Plant the anchor link in the middle of the post — between the 3rd paragraph and the 3rd-from-last paragraph. NEVER in the opening or closing.
- ${ANCHOR_INSTRUCTIONS[anchor.type](anchor.text)}
- End with a practical takeaway or specific next step. No "Conclusion" header. No "I hope this helps".

Hard rules:
- Do not invent statistics, certifications, awards, or client counts.
- Do not name competitors or other businesses except the one you're linking to.
- No marketing buzzwords. No superlatives.
- No first-person plural ("we"). Use "I" for any narrator voice, otherwise second person ("you").
- Do not include a title line, byline, or author bio — the editor adds those.

Output: the markdown body of the post and nothing else. No preamble, no JSON wrapper, no closing remarks.`;

    const userMessage = `Write a guest post for ${sourceDomain}.

Topic: ${topic}.

Business context (use for ONE natural link only — do NOT pitch the business throughout the post):
- Business: ${businessName}
- Service: ${site.niche}
- Service area: ${site.city}, ${site.state}
- Website: ${site.domain ?? '(none)'}

Anchor link target: https://${site.domain ?? `${site.niche.replace(/\s+/g, '-').toLowerCase()}-${site.city.replace(/\s+/g, '-').toLowerCase()}.com`}
Anchor text bucket: ${anchor.type} → "${anchor.text}"

Write the post now.`;

    const anthropic = getAnthropicClient();
    const response = await anthropic.messages.create({
      model: COPYWRITER_MODEL,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });
    const usage = response.usage;
    ctx.recordUsage({
      model: COPYWRITER_MODEL,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      cost_usd: estimateCostUsd(COPYWRITER_MODEL, {
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
      }),
    });
    const block = response.content.find((b) => b.type === 'text');
    const markdown = block && block.type === 'text' ? block.text.trim() : '';
    if (markdown.length === 0) {
      throw new Error('molly-copywriter: Sonnet returned empty draft');
    }
    return { markdown };
  }
}

/** Approximate word count — splits on whitespace, ignores empty tokens. */
function countWords(md: string): number {
  return md.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Find the 1-indexed paragraph (double-newline-separated block) that
 * contains the anchor text. Returns 0 when not found. Used for audit
 * logging only — R4.6 will enforce placement rules.
 */
function findAnchorParagraphIndex(md: string, anchorText: string): number {
  const paragraphs = md.split(/\n{2,}/);
  for (let i = 0; i < paragraphs.length; i++) {
    if (paragraphs[i]!.includes(anchorText)) return i + 1;
  }
  return 0;
}
