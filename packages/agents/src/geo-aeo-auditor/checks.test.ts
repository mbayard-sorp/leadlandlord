import { describe, it, expect } from 'vitest';
import {
  llmsTxtCompleteness,
  answerExtractability,
  entityConsistency,
  schemaCoverage,
  runChecks,
  geoScore,
  extractJsonLd,
  isoWeek,
  type SiteContext,
  type FetchedPage,
} from './checks';

const CTX: SiteContext = {
  siteId: '11111111-1111-1111-1111-111111111111',
  domain: 'tucsontreepros.com',
  niche: 'Tree Removal',
  city: 'Tucson',
  state: 'AZ',
  businessName: 'Tucson Tree Pros',
  trackingNumber: '+1 (520) 555-0199',
};

const COMPLETE_LLMS = `# Tucson Tree Pros

Tucson Tree Pros provides tree removal across Tucson, AZ.

## Services
- Tree removal
- Stump grinding
- Emergency tree service

## Service Area
We serve Tucson and surrounding areas.

## Contact
Call us at (520) 555-0199.
`;

describe('isoWeek', () => {
  it('formats as YYYY-Www', () => {
    expect(isoWeek(new Date('2026-06-04T00:00:00Z'))).toMatch(/^\d{4}-W\d{2}$/);
  });
});

describe('llmsTxtCompleteness', () => {
  it('scores a complete llms.txt at 100', () => {
    const { score, findings } = llmsTxtCompleteness(COMPLETE_LLMS, CTX);
    expect(score).toBe(100);
    expect(findings).toHaveLength(0);
  });

  it('scores missing llms.txt at 0 with a fail finding', () => {
    const { score, findings } = llmsTxtCompleteness(null, CTX);
    expect(score).toBe(0);
    expect(findings[0]?.severity).toBe('fail');
  });

  it('zeroes the score when placeholder tokens are present', () => {
    const stub = COMPLETE_LLMS.replace('Tucson Tree Pros', '[business name]');
    const { score, findings } = llmsTxtCompleteness(stub, CTX);
    expect(score).toBe(0);
    expect(findings.some((f) => /placeholder/i.test(f.message))).toBe(true);
  });

  it('penalizes a body missing services + city + contact', () => {
    // Business name that does not embed the city, so name and city facets are
    // independent. presence + name earned; services + city + contact missing.
    const ctx: SiteContext = { ...CTX, businessName: 'Saguaro Arborists' };
    const partial = '# Saguaro Arborists\n\nSaguaro Arborists is a company. We are great at what we do every day for our clients.';
    const { score, findings } = llmsTxtCompleteness(partial, ctx);
    expect(score).toBe(40); // 2/5
    expect(findings.length).toBeGreaterThan(0);
  });
});

describe('entityConsistency', () => {
  const HOME_HTML_GOOD = `<html><head>
    <script type="application/ld+json">
    {"@context":"https://schema.org","@type":"LocalBusiness","name":"Tucson Tree Pros","telephone":"(520) 555-0199","areaServed":"Tucson, AZ"}
    </script>
    </head><body><h1>Tucson Tree Pros</h1></body></html>`;

  it('scores 100 when phone, name, and city all agree across sources', () => {
    const { score, findings, candidates } = entityConsistency(CTX, COMPLETE_LLMS, HOME_HTML_GOOD, 'https://tucsontreepros.com/');
    expect(score).toBe(100);
    expect(candidates).toHaveLength(0);
    expect(findings).toHaveLength(0);
  });

  it('detects a phone divergence in JSON-LD and emits a geo_entity_fix', () => {
    const badHtml = HOME_HTML_GOOD.replace('(520) 555-0199', '(602) 555-7777');
    const { score, candidates, findings } = entityConsistency(CTX, COMPLETE_LLMS, badHtml, 'https://tucsontreepros.com/');
    expect(score).toBeLessThan(100);
    const phoneFix = candidates.find((c) => c.type === 'geo_entity_fix' && c.actionPayload.field === 'phone');
    expect(phoneFix).toBeDefined();
    expect(phoneFix?.riskLevel).toBe('low');
    expect(phoneFix?.actionPayload.source).toBe('json-ld');
    expect(findings.some((f) => f.severity === 'fail' && /phone/.test(f.message))).toBe(true);
  });

  it('flags missing business name and city when absent everywhere', () => {
    const emptyHtml = '<html><body><p>nothing here</p></body></html>';
    const { candidates } = entityConsistency(CTX, 'random unrelated text', emptyHtml, 'https://tucsontreepros.com/');
    // llms.txt present but lacks name/city; json-ld absent (skipped as not-present).
    expect(candidates.some((c) => c.actionPayload.field === 'name')).toBe(true);
    expect(candidates.some((c) => c.actionPayload.field === 'locality')).toBe(true);
  });
});

describe('answerExtractability', () => {
  const QA_HTML = `<html><body>
    <h2>How much does tree removal cost in Tucson?</h2>
    <p>Tree removal in Tucson typically costs between $400 and $1,200 depending on the tree size and access. We provide free on-site estimates.</p>
    <h2>What is stump grinding?</h2>
    <p>Stump grinding shaves the remaining stump below ground level so you can replant or pave over the area cleanly.</p>
    <ul><li>Tree removal</li><li>Stump grinding</li></ul>
    <table><tr><td>Service</td><td>Price</td></tr></table>
  </body></html>`;

  it('scores a Q&A-structured page highly with no rewrite candidate', () => {
    const { score, candidates } = answerExtractability(QA_HTML, 'https://x/');
    expect(score).toBeGreaterThanOrEqual(55);
    expect(candidates).toHaveLength(0);
  });

  it('scores a wall-of-text page low and emits a medium-risk geo_answer_rewrite', () => {
    const flat = `<html><body>
      <h2>About Our Company</h2>
      <p>We are a company that does things and provides excellent service to all of our customers.</p>
      <h2>Our History</h2>
    </body></html>`;
    const { score, candidates } = answerExtractability(flat, 'https://x/');
    expect(score).toBeLessThan(55);
    const rewrite = candidates.find((c) => c.type === 'geo_answer_rewrite');
    expect(rewrite).toBeDefined();
    expect(rewrite?.riskLevel).toBe('medium');
    expect(rewrite?.targetPage).toBe('https://x/');
  });

  it('returns 0 with a fail finding on empty HTML', () => {
    const { score, findings } = answerExtractability('', 'https://x/');
    expect(score).toBe(0);
    expect(findings[0]?.severity).toBe('fail');
  });
});

describe('extractJsonLd', () => {
  it('parses multiple blocks and flattens @graph', () => {
    const html = `
      <script type="application/ld+json">{"@type":"WebSite","name":"x"}</script>
      <script type="application/ld+json">{"@graph":[{"@type":"LocalBusiness"},{"@type":"BreadcrumbList"}]}</script>
      <script type="application/ld+json">not json</script>`;
    const nodes = extractJsonLd(html);
    const types = nodes.flatMap((n) => (typeof n['@type'] === 'string' ? [n['@type']] : []));
    expect(types).toContain('WebSite');
    expect(types).toContain('LocalBusiness');
    expect(types).toContain('BreadcrumbList');
  });
});

describe('schemaCoverage', () => {
  it('emits a geo_schema_fix when homepage lacks LocalBusiness', () => {
    const pages: FetchedPage[] = [
      { url: 'https://x/', html: '<html><body><h1>Home</h1></body></html>', isSubpage: false },
    ];
    const { score, candidates } = schemaCoverage(pages, CTX);
    expect(score).toBeLessThan(100);
    expect(candidates.some((c) => c.type === 'geo_schema_fix' && c.actionPayload.schemaType === 'LocalBusiness')).toBe(true);
  });

  it('scores higher when LocalBusiness + WebSite present', () => {
    const html = `<html><head>
      <script type="application/ld+json">{"@type":"LocalBusiness","name":"x"}</script>
      <script type="application/ld+json">{"@type":"WebSite","name":"x"}</script>
      </head><body></body></html>`;
    const pages: FetchedPage[] = [{ url: 'https://x/', html, isSubpage: false }];
    const { score } = schemaCoverage(pages, CTX);
    expect(score).toBe(100);
  });
});

describe('runChecks + geoScore', () => {
  it('produces all five subscores and a clamped 0-100 composite', () => {
    const pages: FetchedPage[] = [
      {
        url: 'https://tucsontreepros.com/',
        html: `<html><head>
          <script type="application/ld+json">{"@type":"LocalBusiness","name":"Tucson Tree Pros","telephone":"(520) 555-0199"}</script>
          <script type="application/ld+json">{"@type":"WebSite","name":"Tucson Tree Pros"}</script>
          </head><body>
          <h1>Tucson Tree Pros</h1>
          <h2>How much does tree removal cost in Tucson?</h2>
          <p>Tree removal in Tucson typically costs $400 to $1,200 based on size and access.</p>
          <p>We serve all of Tucson, AZ with same-day estimates and licensed crews.</p>
          <ul><li>Removal</li></ul>
          </body></html>`,
        isSubpage: false,
      },
    ];
    const result = runChecks({ ctx: CTX, llmsTxt: COMPLETE_LLMS, pages });
    expect(Object.keys(result.subscores)).toEqual([
      'llmsTxtCompleteness',
      'schemaCoverage',
      'answerExtractability',
      'entityConsistency',
      'citationReadiness',
      'markdownCoverage',
    ]);
    const composite = geoScore(result.subscores);
    expect(composite).toBeGreaterThanOrEqual(0);
    expect(composite).toBeLessThanOrEqual(100);
    expect(composite).toBeGreaterThan(50);
  });

  it('degrades gracefully (no throw) when nothing was fetched', () => {
    const result = runChecks({ ctx: CTX, llmsTxt: null, pages: [] });
    expect(geoScore(result.subscores)).toBeGreaterThanOrEqual(0);
    expect(result.findings.length).toBeGreaterThan(0);
  });
});
