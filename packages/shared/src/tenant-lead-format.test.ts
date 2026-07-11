import { describe, expect, it } from 'vitest';
import { callerLabel, formatTenantLeadEmail, formatTenantLeadSms } from './tenant-lead-format';

const site = { businessName: 'Ace Plumbing' };

describe('callerLabel', () => {
  it('prefers callerName over callerNumber', () => {
    expect(callerLabel({ callerName: 'Jane Doe', callerNumber: '+15205551234' })).toBe('Jane Doe');
  });

  it('falls back to callerNumber when no name', () => {
    expect(callerLabel({ callerNumber: '+15205551234' })).toBe('+15205551234');
  });

  it('falls back to a generic label when neither is present', () => {
    expect(callerLabel({})).toBe('Unknown caller');
  });
});

describe('formatTenantLeadSms', () => {
  it('includes business name, caller, job type, urgency, score, and address', () => {
    const sms = formatTenantLeadSms(
      site,
      {
        callerName: 'Jane Doe',
        callerNumber: '+15205551234',
        qualificationJobType: 'water heater replacement',
        qualificationUrgency: 'emergency',
        qualificationScore: 87,
        qualificationAddress: '123 Main St, Tucson AZ',
      },
      true,
    );

    expect(sms).toContain('Ace Plumbing');
    expect(sms).toContain('Jane Doe (+15205551234)');
    expect(sms).toContain('water heater replacement');
    expect(sms).toContain('emergency');
    expect(sms).toContain('87/100');
    expect(sms).toContain('123 Main St, Tucson AZ');
    expect(sms).toContain('Recording + full details emailed.');
  });

  it('omits fields that are absent without throwing', () => {
    const sms = formatTenantLeadSms(site, { callerNumber: '+15205551234' });
    expect(sms).toContain('Ace Plumbing');
    expect(sms).toContain('+15205551234');
    expect(sms).not.toContain('undefined');
    expect(sms).not.toContain('null');
  });

  it('does not duplicate the number when callerName equals callerNumber', () => {
    const sms = formatTenantLeadSms(site, { callerName: '+15205551234', callerNumber: '+15205551234' });
    expect(sms.match(/\+15205551234/g)?.length).toBe(1);
  });

  it('omits the "emailed" line by default (emailExpected not passed)', () => {
    const sms = formatTenantLeadSms(site, { callerNumber: '+15205551234' });
    expect(sms).not.toContain('Recording + full details emailed.');
  });

  it('omits the "emailed" line when emailExpected is false', () => {
    const sms = formatTenantLeadSms(site, { callerNumber: '+15205551234' }, false);
    expect(sms).not.toContain('Recording + full details emailed.');
  });

  it('includes the "emailed" line when emailExpected is true', () => {
    const sms = formatTenantLeadSms(site, { callerNumber: '+15205551234' }, true);
    expect(sms).toContain('Recording + full details emailed.');
  });
});

describe('formatTenantLeadEmail', () => {
  it('builds a subject with job type and caller', () => {
    const email = formatTenantLeadEmail(site, {
      callerName: 'Jane Doe',
      qualificationJobType: 'drain cleaning',
    });
    expect(email.subject).toBe('Qualified lead: drain cleaning — Jane Doe');
  });

  it('falls back to "New lead" in the subject when job type is missing', () => {
    const email = formatTenantLeadEmail(site, { callerNumber: '+15205551234' });
    expect(email.subject).toBe('Qualified lead: New lead — +15205551234');
  });

  it('includes a truncated transcript excerpt capped at ~1500 chars', () => {
    const longTranscript = 'A'.repeat(3000);
    const email = formatTenantLeadEmail(site, { transcript: longTranscript });
    expect(email.text).toContain('Transcript excerpt:');
    const excerptLine = email.text.split('Transcript excerpt:\n')[1] ?? '';
    expect(excerptLine.length).toBeLessThanOrEqual(1500);
  });

  it('includes a warm-transfer note when warmTransfer is true', () => {
    const email = formatTenantLeadEmail(site, { warmTransfer: true });
    expect(email.text).toContain('warm-transferred');
    expect(email.html).toContain('warm-transferred');
  });

  it('omits the warm-transfer note when warmTransfer is falsy', () => {
    const email = formatTenantLeadEmail(site, {});
    expect(email.text).not.toContain('warm-transferred');
  });

  it('includes a recording link when recordingUrl is provided', () => {
    const email = formatTenantLeadEmail(site, {}, { recordingUrl: 'https://example.com/rec.mp3?t=abc' });
    expect(email.text).toContain('https://example.com/rec.mp3?t=abc');
    expect(email.html).toContain('https://example.com/rec.mp3?t=abc');
  });

  it('omits the recording link when not provided', () => {
    const email = formatTenantLeadEmail(site, {});
    expect(email.text).not.toContain('Recording:');
  });

  it('escapes HTML-sensitive characters in the business name', () => {
    const email = formatTenantLeadEmail(
      { businessName: 'Ace <Plumbing> & "Sons"' },
      { callerNumber: '+15205551234' },
    );
    expect(email.html).not.toContain('<Plumbing>');
    expect(email.html).toContain('&lt;Plumbing&gt;');
  });

  it('lists all present qualification fields', () => {
    const email = formatTenantLeadEmail(site, {
      callerNumber: '+15205551234',
      qualificationJobType: 'roof repair',
      qualificationUrgency: 'this_week',
      qualificationScore: 60,
      qualificationBudgetBand: '$500-$1000',
      qualificationAddress: '456 Oak Ave',
      qualificationIntent: 'wants a quote',
    });
    expect(email.text).toContain('Job type: roof repair');
    expect(email.text).toContain('Urgency: this week');
    expect(email.text).toContain('Qualification score: 60/100');
    expect(email.text).toContain('Budget: $500-$1000');
    expect(email.text).toContain('Address: 456 Oak Ave');
    expect(email.text).toContain('Intent: wants a quote');
  });
});
