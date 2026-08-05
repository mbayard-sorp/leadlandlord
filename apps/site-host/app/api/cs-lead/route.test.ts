import { beforeEach, describe, expect, it, vi } from 'vitest';

// vi.hoisted so the mock factories below (which are themselves hoisted above
// these imports by the vitest transform) can reference these fns without a
// temporal-dead-zone error.
const {
  sendEmailMock,
  fetchCustomSiteByHostMock,
  fetchCustomSiteByKeyMock,
  fetchCustomSiteLeadMagnetAssetMock,
  fetchCustomSiteAssessmentMock,
} = vi.hoisted(() => ({
  sendEmailMock: vi.fn(),
  fetchCustomSiteByHostMock: vi.fn(),
  fetchCustomSiteByKeyMock: vi.fn(),
  fetchCustomSiteLeadMagnetAssetMock: vi.fn(),
  fetchCustomSiteAssessmentMock: vi.fn(),
}));

vi.mock('@leadlandlord/integrations/resend', () => ({
  sendEmail: sendEmailMock,
}));

vi.mock('../../../lib/customsites-sanity', () => ({
  fetchCustomSiteByHost: fetchCustomSiteByHostMock,
  fetchCustomSiteByKey: fetchCustomSiteByKeyMock,
  fetchCustomSiteLeadMagnetAsset: fetchCustomSiteLeadMagnetAssetMock,
  fetchCustomSiteAssessment: fetchCustomSiteAssessmentMock,
}));

import { POST } from './route';

const BASE_PAYLOAD = {
  siteKey: 'constructionadr',
  firstName: 'Jane',
  lastName: 'Doe',
  email: 'jane@example.com',
  phone: '555-1234',
  message: 'Hello, I need help with a construction dispute.',
};

const CS_SITE = {
  _id: 'cs-site-constructionadr',
  siteKey: 'constructionadr',
  name: 'Construction ADR Services',
  leadRecipients: ['owner@constructionadrservices.com', 'admin@constructionadrservices.com'],
};

function makeRequest(
  body: Record<string, unknown>,
  opts: { ip?: string; host?: string } = {},
): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.ip) headers['x-forwarded-for'] = opts.ip;
  if (opts.host) headers['x-site-host'] = opts.host;
  return new Request('https://example.com/api/cs-lead', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  sendEmailMock.mockReset();
  fetchCustomSiteByHostMock.mockReset();
  fetchCustomSiteByKeyMock.mockReset();
  fetchCustomSiteLeadMagnetAssetMock.mockReset();
  fetchCustomSiteAssessmentMock.mockReset();
  process.env.RESEND_FROM_ADDRESS = 'leads@leadslandlord.com';
});

const AA_SITE = {
  _id: 'cs-site-alignedadvisors',
  siteKey: 'alignedadvisors',
  name: 'Aligned Advisors',
  leadRecipients: ['team@alignedadvisors.com'],
};

const ASSESSMENT = {
  _id: 'cs-assessment-alignedadvisors-wealth-journey',
  title: 'Wealth Journey Quiz',
  slug: 'wealth-journey',
  questions: [
    { prompt: 'Q1', options: [{ label: 'A', points: 0 }, { label: 'B', points: 2 }] },
    { prompt: 'Q2', options: [{ label: 'A', points: 0 }, { label: 'B', points: 2 }] },
  ],
  bands: [
    { minScore: 0, maxScore: 2, stage: { _id: 's1', order: 1, title: 'Profitable Practice', slug: 'profitable-practice', summary: 'Stage one.' } },
    { minScore: 3, maxScore: 4, stage: { _id: 's2', order: 2, title: 'Excess Money to Invest', slug: 'excess-money', summary: 'Stage two.' } },
  ],
};

describe('POST /api/cs-lead', () => {
  it('drops honeypot submissions silently (200 ok, nothing sent)', async () => {
    const req = makeRequest(
      { ...BASE_PAYLOAD, siteKey: 'honeypot-test', company: 'Bot Co' },
      { ip: '10.0.0.1' },
    );
    const res = await POST(req);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(fetchCustomSiteByHostMock).not.toHaveBeenCalled();
    expect(fetchCustomSiteByKeyMock).not.toHaveBeenCalled();
  });

  it('rejects an invalid payload with 400', async () => {
    const req = makeRequest({ siteKey: 'invalid-test' }, { ip: '10.0.0.2' });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('invalid_payload');
  });

  it('returns 404 when no csSite resolves (or it has no leadRecipients)', async () => {
    fetchCustomSiteByHostMock.mockResolvedValue(null);
    fetchCustomSiteByKeyMock.mockResolvedValue(null);
    const req = makeRequest({ ...BASE_PAYLOAD, siteKey: 'missing-site' }, { ip: '10.0.0.3' });
    const res = await POST(req);
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe('site_not_found');
  });

  it('sends via Resend to both recipients on the happy path', async () => {
    // Host header present but doesn't resolve — falls back to siteKey.
    fetchCustomSiteByHostMock.mockResolvedValue(null);
    fetchCustomSiteByKeyMock.mockResolvedValue(CS_SITE);
    sendEmailMock.mockResolvedValue({ messageId: 'abc123' });

    const req = makeRequest(BASE_PAYLOAD, {
      ip: '10.0.0.4',
      host: 'constructionadrservices.com',
    });
    const res = await POST(req);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(fetchCustomSiteByHostMock).toHaveBeenCalledWith('constructionadrservices.com');
    expect(fetchCustomSiteByKeyMock).toHaveBeenCalledWith(BASE_PAYLOAD.siteKey);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);

    const call = sendEmailMock.mock.calls[0]![0];
    expect(call.to).toEqual(CS_SITE.leadRecipients);
    expect(call.replyTo).toBe(BASE_PAYLOAD.email);
    expect(call.from).toBe('leads@leadslandlord.com');
    expect(call.subject).toBe(`New inquiry from Jane Doe - ${CS_SITE.name}`);
    expect(call.text).toContain(BASE_PAYLOAD.message);
  });

  it('returns 502 when the Resend send fails', async () => {
    fetchCustomSiteByHostMock.mockResolvedValue(null);
    fetchCustomSiteByKeyMock.mockResolvedValue(CS_SITE);
    sendEmailMock.mockRejectedValue(new Error('resend down'));

    const req = makeRequest(
      { ...BASE_PAYLOAD, siteKey: 'delivery-fail-test' },
      { ip: '10.0.0.5' },
    );
    const res = await POST(req);

    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.error).toBe('delivery_failed');
  });

  it('consultation kind: message optional, call types labeled in the email', async () => {
    fetchCustomSiteByHostMock.mockResolvedValue(null);
    fetchCustomSiteByKeyMock.mockResolvedValue(AA_SITE);
    sendEmailMock.mockResolvedValue({ messageId: 'abc123' });

    const req = makeRequest(
      {
        kind: 'consultation',
        siteKey: 'alignedadvisors',
        firstName: 'Pat',
        lastName: 'Molar',
        email: 'pat@example.com',
        callTypes: ['goal', 'tax'],
      },
      { ip: '10.0.2.1' },
    );
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    const call = sendEmailMock.mock.calls[0]![0];
    expect(call.subject).toBe(`New consultation request from Pat Molar - ${AA_SITE.name}`);
    expect(call.text).toContain('Goal Strategy Call');
    expect(call.text).toContain('Tax Strategy Call');
  });

  it('magnet kind: verifies the asset against the site, emails firm + visitor, returns the URL', async () => {
    fetchCustomSiteByHostMock.mockResolvedValue(null);
    fetchCustomSiteByKeyMock.mockResolvedValue(AA_SITE);
    fetchCustomSiteLeadMagnetAssetMock.mockResolvedValue({
      title: 'Dental Practice Benchmark Report',
      gated: true,
      url: 'https://cdn.sanity.io/files/x/production/report.pdf',
    });
    sendEmailMock.mockResolvedValue({ messageId: 'abc123' });

    const req = makeRequest(
      {
        kind: 'magnet',
        siteKey: 'alignedadvisors',
        firstName: 'Pat',
        lastName: 'Molar',
        email: 'pat@example.com',
        assetId: 'file-abc-pdf',
      },
      { ip: '10.0.2.2' },
    );
    const res = await POST(req);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      url: 'https://cdn.sanity.io/files/x/production/report.pdf',
    });
    expect(fetchCustomSiteLeadMagnetAssetMock).toHaveBeenCalledWith('alignedadvisors', 'file-abc-pdf');
    // Two sends: firm lead + visitor link.
    expect(sendEmailMock).toHaveBeenCalledTimes(2);
    const visitorCall = sendEmailMock.mock.calls[1]![0];
    expect(visitorCall.to).toEqual(['pat@example.com']);
    expect(visitorCall.text).toContain('report.pdf');
  });

  it('magnet kind: 404s when the asset id does not belong to the site', async () => {
    fetchCustomSiteByHostMock.mockResolvedValue(null);
    fetchCustomSiteByKeyMock.mockResolvedValue(AA_SITE);
    fetchCustomSiteLeadMagnetAssetMock.mockResolvedValue(null);

    const req = makeRequest(
      {
        kind: 'magnet',
        siteKey: 'alignedadvisors',
        firstName: 'Pat',
        lastName: 'Molar',
        email: 'pat@example.com',
        assetId: 'file-not-ours-pdf',
      },
      { ip: '10.0.2.3' },
    );
    const res = await POST(req);
    expect(res.status).toBe(404);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('assessment kind: re-scores server-side and includes stage + answers in the email', async () => {
    fetchCustomSiteByHostMock.mockResolvedValue(null);
    fetchCustomSiteByKeyMock.mockResolvedValue(AA_SITE);
    fetchCustomSiteAssessmentMock.mockResolvedValue(ASSESSMENT);
    sendEmailMock.mockResolvedValue({ messageId: 'abc123' });

    const req = makeRequest(
      {
        kind: 'assessment',
        siteKey: 'alignedadvisors',
        firstName: 'Pat',
        lastName: 'Molar',
        email: 'pat@example.com',
        assessmentSlug: 'wealth-journey',
        answers: [1, 1], // 2 + 2 = 4 → band 2
      },
      { ip: '10.0.2.4' },
    );
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    const call = sendEmailMock.mock.calls[0]![0];
    expect(call.text).toContain('Score: 4');
    expect(call.text).toContain('Stage: Excess Money to Invest');
    expect(call.text).toContain('Q1');
  });

  it('rate-limits after 10 requests from the same IP within the window', async () => {
    fetchCustomSiteByHostMock.mockResolvedValue(null);
    fetchCustomSiteByKeyMock.mockResolvedValue(CS_SITE);
    sendEmailMock.mockResolvedValue({ messageId: 'abc123' });

    const ip = '10.0.0.250';
    let lastStatus = 0;
    for (let i = 0; i < 11; i++) {
      const req = makeRequest(
        { ...BASE_PAYLOAD, siteKey: `rate-limit-ip-${i}` },
        { ip },
      );
      const res = await POST(req);
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });

  it('rate-limits after 20 requests for the same siteKey within the window', async () => {
    fetchCustomSiteByHostMock.mockResolvedValue(null);
    fetchCustomSiteByKeyMock.mockResolvedValue(CS_SITE);
    sendEmailMock.mockResolvedValue({ messageId: 'abc123' });

    const siteKey = 'rate-limit-site-shared';
    let lastStatus = 0;
    for (let i = 0; i < 21; i++) {
      const req = makeRequest(
        { ...BASE_PAYLOAD, siteKey },
        { ip: `10.0.1.${i}` }, // distinct IP each time so only the site bucket trips
      );
      const res = await POST(req);
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });
});
