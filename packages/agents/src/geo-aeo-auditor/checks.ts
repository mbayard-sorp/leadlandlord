/**
 * GEO / AEO auditor — PURE check functions.
 *
 * No DB, no Sanity, no network imports. Everything here takes already-fetched
 * text (llms.txt body, page HTML) plus a small site-context object and returns
 * deterministic subscores + findings + recommendation candidates. This keeps
 * the unit-test surface free of the integration module graph (Sanity pulls in
 * CSS and breaks vitest's loader — see seo-operator's loadSanity() note).
 *
 * GEO = Generative Engine Optimization, AEO = Answer Engine Optimization: the
 * site's readiness to be cited by LLM answer engines (ChatGPT, Perplexity,
 * Google AI Overviews). We approximate that with deterministic structural
 * checks rather than live answer-engine probing (that's a deferred seam — see
 * geo_seo_audits.liveCitationProbe).
 */

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

/** Minimal site context the checks need. Mirrors the columns the agent loads. */
export interface SiteContext {
  siteId: string;
  domain: string | null;
  niche: string;
  city: string;
  state: string;
  /** Derived display name (e.g. tenant business name, or a niche+city proxy). */
  businessName: string | null;
  /** Call-tracking number — the canonical phone for NAP consistency. */
  trackingNumber: string | null;
}

/** A fetched page: the URL we hit and its body (empty string on fetch failure). */
export interface FetchedPage {
  url: string;
  /** Raw HTML, or '' if the fetch failed. */
  html: string;
  /** Whether this page is a subpage (drives BreadcrumbList expectation). */
  isSubpage: boolean;
}

export interface GeoSubscores {
  llmsTxtCompleteness: number;
  schemaCoverage: number;
  answerExtractability: number;
  entityConsistency: number;
  citationReadiness: number;
  markdownCoverage: number;
}

/** A fetched markdown twin (.md endpoint) of an HTML page. */
export interface FetchedMarkdownPage {
  /** The .md URL we hit, e.g. https://example.com/services.md */
  url: string;
  /** HTTP status, or null when the fetch itself failed. */
  status: number | null;
  /** Content-Type header, or null when unavailable. */
  contentType: string | null;
  /** Response body ('' on failure). */
  body: string;
  /** Whether the HTML counterpart is a faq-kind page (drives the FAQ-section check). */
  expectFaq: boolean;
}

export interface Finding {
  check: string;
  severity: 'info' | 'warn' | 'fail';
  message: string;
  [key: string]: unknown;
}

/**
 * A recommendation candidate. Shaped like NewSeoRecommendation but kept
 * structurally typed so checks.ts takes no @leadlandlord/db dependency. The
 * agent maps these onto NewSeoRecommendation 1:1 (siteId is injected there).
 */
export interface RecommendationCandidate {
  type: 'geo_schema_fix' | 'geo_answer_rewrite' | 'geo_entity_fix' | 'geo_markdown_fix';
  riskLevel: 'low' | 'medium' | 'high';
  targetPage: string | null;
  rationale: string;
  estImpactScore: string;
  actionPayload: Record<string, unknown>;
}

export interface CheckResult {
  subscores: GeoSubscores;
  findings: Finding[];
  candidates: RecommendationCandidate[];
}

// ────────────────────────────────────────────────────────────
// Shared helpers
// ────────────────────────────────────────────────────────────

export function clampedScore(n: number): string {
  return Math.max(0, Math.min(100, Math.round(n))).toFixed(2);
}

/** ISO-8601 week key, e.g. '2026-W23'. Copy of the seo-operator/local-content-scout helper. */
export function isoWeek(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() === 0 ? 7 : date.getUTCDay();
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** Strip HTML tags to plain visible text (cheap, no DOM). */
export function stripTags(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Normalize a phone number to its digits (last 10) for loose comparison. */
export function phoneDigits(s: string | null | undefined): string {
  if (!s) return '';
  const d = s.replace(/\D+/g, '');
  return d.length > 10 ? d.slice(-10) : d;
}

/**
 * Extract every <script type="application/ld+json"> block and parse it.
 * Returns the parsed objects (arrays are flattened one level — JSON-LD allows
 * an array of graph nodes). Unparseable blocks are skipped.
 */
export function extractJsonLd(html: string): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const re = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const body = (m[1] ?? '').trim();
    if (!body) continue;
    try {
      const parsed = JSON.parse(body) as unknown;
      const push = (v: unknown) => {
        if (v && typeof v === 'object') out.push(v as Record<string, unknown>);
      };
      if (Array.isArray(parsed)) {
        for (const item of parsed) push(item);
      } else if (parsed && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>)['@graph'])) {
        for (const item of (parsed as Record<string, unknown>)['@graph'] as unknown[]) push(item);
      } else {
        push(parsed);
      }
    } catch {
      // ignore malformed JSON-LD
    }
  }
  return out;
}

/** Collect every @type value present in a list of JSON-LD nodes (handles array @type). */
export function jsonLdTypes(nodes: Array<Record<string, unknown>>): Set<string> {
  const types = new Set<string>();
  for (const node of nodes) {
    const t = node['@type'];
    if (typeof t === 'string') types.add(t);
    else if (Array.isArray(t)) for (const x of t) if (typeof x === 'string') types.add(x);
  }
  return types;
}

/** Heading text by level from raw HTML. */
export function extractHeadings(html: string, level: 'h2' | 'h3'): string[] {
  const re = new RegExp(`<${level}\\b[^>]*>([\\s\\S]*?)</${level}>`, 'gi');
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const text = stripTags(m[1] ?? '');
    if (text) out.push(text);
  }
  return out;
}

const PLACEHOLDER_RE = /(lorem ipsum|\bTODO\b|\bFIXME\b|\{\{[^}]+\}\}|\[business name\]|\[city\]|YOUR_BUSINESS|placeholder|xxx-xxx-xxxx)/i;

// ────────────────────────────────────────────────────────────
// llms.txt completeness
// ────────────────────────────────────────────────────────────

/**
 * Score an llms.txt body 0-100 across five equally-weighted facets:
 * presence, business name, services section, service-area cities, contact/phone.
 * Placeholder tokens zero the whole score (a templated stub is worse than nothing).
 */
export function llmsTxtCompleteness(body: string | null, ctx: SiteContext): {
  score: number;
  findings: Finding[];
} {
  const findings: Finding[] = [];
  if (!body || !body.trim()) {
    findings.push({ check: 'llmsTxtCompleteness', severity: 'fail', message: 'llms.txt missing or empty' });
    return { score: 0, findings };
  }
  if (PLACEHOLDER_RE.test(body)) {
    findings.push({ check: 'llmsTxtCompleteness', severity: 'fail', message: 'llms.txt contains placeholder tokens' });
    return { score: 0, findings };
  }

  const lower = body.toLowerCase();
  let facets = 0;
  const total = 5;

  // 1. presence (non-trivial length)
  if (body.trim().length >= 80) facets += 1;
  else findings.push({ check: 'llmsTxtCompleteness', severity: 'warn', message: 'llms.txt is very short (<80 chars)' });

  // 2. business name
  if (ctx.businessName && lower.includes(ctx.businessName.toLowerCase())) facets += 1;
  else findings.push({ check: 'llmsTxtCompleteness', severity: 'warn', message: 'business name not found in llms.txt' });

  // 3. services section
  if (/\bservices?\b/i.test(body) || /^#+\s*services/im.test(body)) facets += 1;
  else findings.push({ check: 'llmsTxtCompleteness', severity: 'warn', message: 'no services section in llms.txt' });

  // 4. service-area cities (at least the home city)
  if (lower.includes(ctx.city.toLowerCase())) facets += 1;
  else findings.push({ check: 'llmsTxtCompleteness', severity: 'warn', message: 'home city not listed in llms.txt' });

  // 5. contact / phone
  const hasPhone = ctx.trackingNumber
    ? phoneDigits(body).length > 0 && body.replace(/\D+/g, '').includes(phoneDigits(ctx.trackingNumber))
    : /\b\d{3}[\s.\-]?\d{3}[\s.\-]?\d{4}\b/.test(body);
  if (hasPhone || /\bcontact\b/i.test(body)) facets += 1;
  else findings.push({ check: 'llmsTxtCompleteness', severity: 'warn', message: 'no contact/phone in llms.txt' });

  return { score: (facets / total) * 100, findings };
}

// ────────────────────────────────────────────────────────────
// Schema coverage
// ────────────────────────────────────────────────────────────

/**
 * Inspect JSON-LD across fetched pages. Expect LocalBusiness + WebSite on the
 * homepage, BreadcrumbList on subpages, and FAQPage where Q-style headings
 * suggest an FAQ. Each missing required type lowers the score and (for the
 * homepage/site-level ones) yields a low-risk geo_schema_fix candidate.
 */
export function schemaCoverage(pages: FetchedPage[], ctx: SiteContext): {
  score: number;
  findings: Finding[];
  candidates: RecommendationCandidate[];
} {
  const findings: Finding[] = [];
  const candidates: RecommendationCandidate[] = [];
  if (pages.length === 0) {
    return { score: 0, findings: [{ check: 'schemaCoverage', severity: 'fail', message: 'no pages fetched' }], candidates };
  }

  const home = pages.find((p) => !p.isSubpage) ?? pages[0]!;
  const homeTypes = jsonLdTypes(extractJsonLd(home.html));

  let earned = 0;
  let possible = 0;

  // LocalBusiness (homepage) — also satisfied by subtypes via heuristic name match.
  possible += 1;
  const hasLocalBusiness = [...homeTypes].some((t) => /LocalBusiness|Plumber|Electrician|HomeAndConstructionBusiness|ProfessionalService|Dentist|Attorney|LegalService|MedicalBusiness/i.test(t));
  if (hasLocalBusiness) earned += 1;
  else {
    findings.push({ check: 'schemaCoverage', severity: 'fail', message: 'homepage missing LocalBusiness JSON-LD' });
    candidates.push({
      type: 'geo_schema_fix',
      riskLevel: 'low',
      targetPage: home.url,
      rationale: `Homepage has no LocalBusiness structured data — answer engines can't resolve the business entity for ${ctx.niche} in ${ctx.city}.`,
      estImpactScore: clampedScore(60),
      actionPayload: { schemaType: 'LocalBusiness', targetPage: home.url },
    });
  }

  // WebSite (homepage)
  possible += 1;
  if (homeTypes.has('WebSite')) earned += 1;
  else {
    findings.push({ check: 'schemaCoverage', severity: 'warn', message: 'homepage missing WebSite JSON-LD' });
    candidates.push({
      type: 'geo_schema_fix',
      riskLevel: 'low',
      targetPage: home.url,
      rationale: 'Homepage missing WebSite structured data (name + url) — weakens entity grounding for AI answer engines.',
      estImpactScore: clampedScore(30),
      actionPayload: { schemaType: 'WebSite', targetPage: home.url },
    });
  }

  // BreadcrumbList (subpages)
  const subpages = pages.filter((p) => p.isSubpage);
  if (subpages.length > 0) {
    possible += 1;
    const anyBreadcrumb = subpages.some((p) => jsonLdTypes(extractJsonLd(p.html)).has('BreadcrumbList'));
    if (anyBreadcrumb) earned += 1;
    else {
      findings.push({ check: 'schemaCoverage', severity: 'warn', message: 'subpages missing BreadcrumbList JSON-LD' });
      candidates.push({
        type: 'geo_schema_fix',
        riskLevel: 'low',
        targetPage: subpages[0]!.url,
        rationale: 'Subpages lack BreadcrumbList structured data — hurts answer-engine context about page hierarchy.',
        estImpactScore: clampedScore(25),
        actionPayload: { schemaType: 'BreadcrumbList', targetPage: subpages[0]!.url },
      });
    }
  }

  // FAQPage — only expected where Q-style headings appear.
  const faqEligible = pages.find((p) => extractHeadings(p.html, 'h2').concat(extractHeadings(p.html, 'h3')).some(isQuestionHeading));
  if (faqEligible) {
    possible += 1;
    if (jsonLdTypes(extractJsonLd(faqEligible.html)).has('FAQPage')) earned += 1;
    else {
      findings.push({ check: 'schemaCoverage', severity: 'warn', message: 'page has FAQ-style headings but no FAQPage JSON-LD' });
      candidates.push({
        type: 'geo_schema_fix',
        riskLevel: 'low',
        targetPage: faqEligible.url,
        rationale: 'Page has question-style headings but no FAQPage structured data — a missed answer-engine surface.',
        estImpactScore: clampedScore(40),
        actionPayload: { schemaType: 'FAQPage', targetPage: faqEligible.url },
      });
    }
  }

  const score = possible > 0 ? (earned / possible) * 100 : 0;
  return { score, findings, candidates };
}

// ────────────────────────────────────────────────────────────
// Answer extractability
// ────────────────────────────────────────────────────────────

export function isQuestionHeading(h: string): boolean {
  return /\?$/.test(h.trim()) || /^(how|what|why|when|where|who|which|can|do|does|is|are|should)\b/i.test(h.trim());
}

/**
 * Heuristic readiness for being quoted directly by an answer engine, scored on
 * a single representative page (usually the homepage):
 *  - ratio of question-style H2/H3 headings,
 *  - presence of short direct-answer paragraphs (40-300 chars right after a heading),
 *  - presence of lists/tables.
 * Low score yields a medium-risk geo_answer_rewrite candidate (human-reviewed).
 */
export function answerExtractability(html: string, targetPage: string): {
  score: number;
  findings: Finding[];
  candidates: RecommendationCandidate[];
} {
  const findings: Finding[] = [];
  const candidates: RecommendationCandidate[] = [];
  if (!html.trim()) {
    return {
      score: 0,
      findings: [{ check: 'answerExtractability', severity: 'fail', message: 'no HTML to evaluate' }],
      candidates,
    };
  }

  const h2 = extractHeadings(html, 'h2');
  const h3 = extractHeadings(html, 'h3');
  const headings = [...h2, ...h3];
  const questionHeadings = headings.filter(isQuestionHeading);
  const questionRatio = headings.length > 0 ? questionHeadings.length / headings.length : 0;

  // Short direct-answer paragraphs.
  const paras = (html.match(/<p\b[^>]*>([\s\S]*?)<\/p>/gi) ?? []).map((p) => stripTags(p));
  const directAnswers = paras.filter((p) => p.length >= 40 && p.length <= 300);
  const hasDirectAnswers = directAnswers.length >= 2;

  // Lists / tables.
  const hasList = /<ul\b|<ol\b/i.test(html);
  const hasTable = /<table\b/i.test(html);

  // Weighted: questions 40%, direct answers 35%, lists/tables 25%.
  const qComponent = Math.min(1, questionRatio / 0.3) * 40; // 30%+ question headings = full marks
  const aComponent = hasDirectAnswers ? 35 : Math.min(directAnswers.length, 1) * 17.5;
  const lComponent = (hasList ? 15 : 0) + (hasTable ? 10 : 0);
  const score = qComponent + aComponent + lComponent;

  if (questionRatio < 0.15) {
    findings.push({
      check: 'answerExtractability',
      severity: 'warn',
      message: `few question-style headings (${questionHeadings.length}/${headings.length})`,
    });
  }
  if (!hasDirectAnswers) {
    findings.push({
      check: 'answerExtractability',
      severity: 'warn',
      message: 'no short direct-answer paragraphs detected',
    });
  }
  if (!hasList && !hasTable) {
    findings.push({ check: 'answerExtractability', severity: 'info', message: 'no lists or tables for scannable answers' });
  }

  if (score < 55) {
    candidates.push({
      type: 'geo_answer_rewrite',
      riskLevel: 'medium',
      targetPage,
      rationale: `Page is hard for answer engines to quote: ${questionHeadings.length} question headings, ${directAnswers.length} direct-answer paragraphs, lists=${hasList} tables=${hasTable}. Rewrite into Q&A blocks with concise lead answers.`,
      estImpactScore: clampedScore(50),
      actionPayload: {
        targetPage,
        questionHeadings: questionHeadings.length,
        totalHeadings: headings.length,
        directAnswers: directAnswers.length,
        hasList,
        hasTable,
      },
    });
  }

  return { score, findings, candidates };
}

// ────────────────────────────────────────────────────────────
// Entity consistency (NAP)
// ────────────────────────────────────────────────────────────

/**
 * Compare the canonical NAP (name / phone / locality) from the site row against
 * what appears in llms.txt and in homepage JSON-LD text. Divergence is a
 * low-risk-to-apply but high-impact fix (a wrong phone in JSON-LD actively
 * misleads answer engines). Each divergence yields a geo_entity_fix candidate.
 */
export function entityConsistency(
  ctx: SiteContext,
  llmsTxt: string | null,
  homeHtml: string,
  homeUrl: string,
): {
  score: number;
  findings: Finding[];
  candidates: RecommendationCandidate[];
} {
  const findings: Finding[] = [];
  const candidates: RecommendationCandidate[] = [];

  const jsonLd = extractJsonLd(homeHtml);
  const jsonLdText = JSON.stringify(jsonLd).toLowerCase();
  const llmsLower = (llmsTxt ?? '').toLowerCase();

  const sources: Array<{ label: string; text: string; present: boolean }> = [
    { label: 'llms.txt', text: llmsLower, present: !!(llmsTxt && llmsTxt.trim()) },
    { label: 'json-ld', text: jsonLdText, present: jsonLd.length > 0 },
  ];

  let checks = 0;
  let agreements = 0;

  // Phone (the highest-signal NAP field).
  const canonPhone = phoneDigits(ctx.trackingNumber);
  if (canonPhone) {
    for (const src of sources) {
      if (!src.present) continue;
      checks += 1;
      const srcDigits = src.text.replace(/\D+/g, '');
      if (srcDigits.includes(canonPhone)) {
        agreements += 1;
      } else {
        findings.push({
          check: 'entityConsistency',
          severity: 'fail',
          message: `phone in ${src.label} does not match tracking number`,
          field: 'phone',
          source: src.label,
        });
        candidates.push({
          type: 'geo_entity_fix',
          riskLevel: 'low',
          targetPage: homeUrl,
          rationale: `NAP divergence: ${src.label} phone differs from the canonical tracking number ${ctx.trackingNumber}. Answer engines may surface a stale/wrong number.`,
          estImpactScore: clampedScore(70),
          actionPayload: { field: 'phone', source: src.label, expected: ctx.trackingNumber, targetPage: homeUrl },
        });
      }
    }
  }

  // Business name.
  if (ctx.businessName) {
    const name = ctx.businessName.toLowerCase();
    for (const src of sources) {
      if (!src.present) continue;
      checks += 1;
      if (src.text.includes(name)) {
        agreements += 1;
      } else {
        findings.push({
          check: 'entityConsistency',
          severity: 'warn',
          message: `business name not found in ${src.label}`,
          field: 'name',
          source: src.label,
        });
        candidates.push({
          type: 'geo_entity_fix',
          riskLevel: 'low',
          targetPage: homeUrl,
          rationale: `NAP divergence: business name "${ctx.businessName}" absent from ${src.label}. Inconsistent naming fragments the entity for answer engines.`,
          estImpactScore: clampedScore(45),
          actionPayload: { field: 'name', source: src.label, expected: ctx.businessName, targetPage: homeUrl },
        });
      }
    }
  }

  // Locality (city/state).
  const locality = ctx.city.toLowerCase();
  for (const src of sources) {
    if (!src.present) continue;
    checks += 1;
    if (src.text.includes(locality)) {
      agreements += 1;
    } else {
      findings.push({
        check: 'entityConsistency',
        severity: 'warn',
        message: `home city not found in ${src.label}`,
        field: 'locality',
        source: src.label,
      });
      candidates.push({
        type: 'geo_entity_fix',
        riskLevel: 'low',
        targetPage: homeUrl,
        rationale: `NAP divergence: city "${ctx.city}" absent from ${src.label}. Service-area ambiguity weakens local answer-engine grounding.`,
        estImpactScore: clampedScore(40),
        actionPayload: { field: 'locality', source: src.label, expected: `${ctx.city}, ${ctx.state}`, targetPage: homeUrl },
      });
    }
  }

  // No sources present at all -> nothing to compare -> degraded score.
  const score = checks > 0 ? (agreements / checks) * 100 : 0;
  if (checks === 0) {
    findings.push({ check: 'entityConsistency', severity: 'fail', message: 'no NAP sources available to compare' });
  }
  return { score, findings, candidates };
}

// ────────────────────────────────────────────────────────────
// Markdown coverage (.md page twins + llms-full.txt)
// ────────────────────────────────────────────────────────────

/** Thin-content floor for a markdown twin body. */
const MD_MIN_BODY_CHARS = 400;

/**
 * Score the site's per-page markdown twins (each HTML path + '.md', home at
 * /index.md) plus /llms-full.txt. A page passes when it returns HTTP 200 with
 * a text/markdown content type, a body above the thin-content floor, an H1
 * first line, and (for faq-kind pages) an FAQ section. Score is the passing
 * fraction * 100; a missing /llms-full.txt caps the score at 80. Missing/thin
 * twins yield low-risk geo_markdown_fix candidates.
 */
export function markdownCoverage(
  mdPages: FetchedMarkdownPage[],
  llmsFullTxtOk: boolean,
): {
  score: number;
  findings: Finding[];
  candidates: RecommendationCandidate[];
} {
  const findings: Finding[] = [];
  const candidates: RecommendationCandidate[] = [];

  if (mdPages.length === 0) {
    findings.push({
      check: 'markdownCoverage',
      severity: 'fail',
      message: 'no markdown twin pages to evaluate',
    });
    return { score: 0, findings, candidates };
  }

  let passing = 0;
  for (const p of mdPages) {
    const problems: string[] = [];
    if (p.status !== 200) {
      problems.push(p.status === null ? 'fetch failed' : `HTTP ${p.status}`);
    } else {
      if (!(p.contentType ?? '').toLowerCase().includes('text/markdown')) {
        problems.push(`content-type is not text/markdown (${p.contentType ?? 'none'})`);
      }
      if (p.body.trim().length < MD_MIN_BODY_CHARS) {
        problems.push(`thin content (<${MD_MIN_BODY_CHARS} chars)`);
      }
      if (!p.body.trimStart().startsWith('# ')) {
        problems.push('does not start with an H1');
      }
      if (p.expectFaq && !/^#{1,6}\s.*(faq|frequently asked)/im.test(p.body) && !/faq|frequently asked/i.test(p.body)) {
        problems.push('faq page missing FAQ section');
      }
    }

    if (problems.length === 0) {
      passing += 1;
      continue;
    }

    const problem = problems.join('; ');
    findings.push({
      check: 'markdownCoverage',
      severity: p.status !== 200 ? 'fail' : 'warn',
      message: `markdown twin ${problem}`,
      pageUrl: p.url,
      problem,
    });
    // Recommend only for missing or thin twins; format nits stay findings-only.
    if (p.status !== 200 || p.body.trim().length < MD_MIN_BODY_CHARS) {
      candidates.push({
        type: 'geo_markdown_fix',
        riskLevel: 'low',
        targetPage: p.url,
        rationale: `Markdown twin ${p.url} is ${p.status !== 200 ? 'missing' : 'thin'} (${problem}) — LLM crawlers can't ingest this page as markdown.`,
        estImpactScore: clampedScore(35),
        actionPayload: { problem, targetPage: p.url },
      });
    }
  }

  let score = (passing / mdPages.length) * 100;
  if (!llmsFullTxtOk) {
    findings.push({
      check: 'markdownCoverage',
      severity: 'warn',
      message: '/llms-full.txt missing or not markdown',
    });
    score = Math.min(score, 80);
  }
  return { score, findings, candidates };
}

// ────────────────────────────────────────────────────────────
// Top-level aggregation
// ────────────────────────────────────────────────────────────

/** Weights for the composite geoScore. Sum to 1. */
const WEIGHTS = {
  llmsTxtCompleteness: 0.2,
  schemaCoverage: 0.25,
  answerExtractability: 0.2,
  entityConsistency: 0.2,
  citationReadiness: 0.05,
  markdownCoverage: 0.1,
} as const;

/**
 * Run every check against fetched inputs and assemble the full result.
 * `pages[0]` is treated as the homepage representative for answer/entity checks
 * when no non-subpage is present.
 */
export function runChecks(input: {
  ctx: SiteContext;
  llmsTxt: string | null;
  pages: FetchedPage[];
  /** Markdown twin fetch results; absent (e.g. older callers) scores 0. */
  markdown?: { pages: FetchedMarkdownPage[]; llmsFullTxtOk: boolean };
}): CheckResult {
  const { ctx, llmsTxt, pages, markdown } = input;
  const findings: Finding[] = [];
  const candidates: RecommendationCandidate[] = [];

  const home = pages.find((p) => !p.isSubpage) ?? pages[0] ?? { url: ctx.domain ? `https://${ctx.domain}/` : '', html: '', isSubpage: false };

  const llms = llmsTxtCompleteness(llmsTxt, ctx);
  findings.push(...llms.findings);

  const schema = schemaCoverage(pages, ctx);
  findings.push(...schema.findings);
  candidates.push(...schema.candidates);

  const answer = answerExtractability(home.html, home.url);
  findings.push(...answer.findings);
  candidates.push(...answer.candidates);

  const entity = entityConsistency(ctx, llmsTxt, home.html, home.url);
  findings.push(...entity.findings);
  candidates.push(...entity.candidates);

  const md = markdownCoverage(markdown?.pages ?? [], markdown?.llmsFullTxtOk ?? false);
  findings.push(...md.findings);
  candidates.push(...md.candidates);

  // citationReadiness — composite proxy of the other four (no own candidates).
  const citationReadiness =
    llms.score * 0.3 + schema.score * 0.3 + answer.score * 0.25 + entity.score * 0.15;

  const subscores: GeoSubscores = {
    llmsTxtCompleteness: Math.round(llms.score),
    schemaCoverage: Math.round(schema.score),
    answerExtractability: Math.round(answer.score),
    entityConsistency: Math.round(entity.score),
    citationReadiness: Math.round(citationReadiness),
    markdownCoverage: Math.round(md.score),
  };

  return { subscores, findings, candidates };
}

/** Weighted composite 0-100 from subscores. */
export function geoScore(s: GeoSubscores): number {
  const raw =
    s.llmsTxtCompleteness * WEIGHTS.llmsTxtCompleteness +
    s.schemaCoverage * WEIGHTS.schemaCoverage +
    s.answerExtractability * WEIGHTS.answerExtractability +
    s.entityConsistency * WEIGHTS.entityConsistency +
    s.citationReadiness * WEIGHTS.citationReadiness +
    s.markdownCoverage * WEIGHTS.markdownCoverage;
  return Math.max(0, Math.min(100, Math.round(raw)));
}
