/**
 * Welcome email sent to a B&S customer when portal access is provisioned.
 *
 * Pure render function: no I/O, no env reads. The caller resolves the portal
 * URL and passes it in, which keeps this testable and previewable.
 *
 * Email-client constraints this template deliberately respects:
 *   - Table layout with inline styles. No flex, grid, or <style> blocks, which
 *     Outlook and several webmail clients strip or ignore.
 *   - No images. Nothing to block, nothing to load, no broken-icon first
 *     impression when remote content is disabled by default (Gmail, Outlook).
 *   - Explicit background AND foreground colours on every container, so dark
 *     mode clients that invert backgrounds can't produce invisible text.
 *   - 600px max width, the safe ceiling for desktop preview panes.
 *   - A "bulletproof" button: a table cell with a background colour and padding
 *     wrapping the <a>, rather than a styled <a> that Outlook renders as bare
 *     blue text.
 *   - Plain-text alternative always sent alongside. Some clients prefer it, and
 *     an HTML-only email scores worse with spam filters.
 */

const COLORS = {
  pageBg: '#f8fafc',
  cardBg: '#ffffff',
  fg: '#0f172a',
  muted: '#64748b',
  accent: '#2563eb',
  border: '#e2e8f0',
  calloutBg: '#f1f5f9',
} as const;

const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/** Escapes text interpolated into the HTML body. */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface CustomerWelcomeEmailArgs {
  /** Business name, used in the subject and greeting. */
  businessName: string;
  /** Absolute origin of the customer portal, e.g. https://edit.leadslandlord.com */
  portalUrl: string;
  /** The customer's live site host, e.g. karkens.com. Optional. */
  siteDomain?: string | null;
  /** The address they sign in with, shown so there's no guesswork. */
  ownerEmail: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/** What the editor actually gets them. Shared by both renderings. */
const BENEFITS: readonly string[] = [
  'Change any wording on the page: your headline, services, about section and FAQs',
  'Swap photos, your logo, and before-and-after shots',
  'Update your hours, phone number and service area',
  'Change your prices and run a special whenever you want one',
  'See every enquiry your contact form brings in, in one place',
];

const STEPS: readonly [string, string][] = [
  ['Open the editor', 'Use the button above.'],
  [
    'Choose "Forgot password"',
    'Enter this email address and we will send you a link. There is no password yet, so that link is how you create one.',
  ],
  ['Sign in', 'You will land straight on your site, ready to edit.'],
];

export function renderCustomerWelcomeEmail({
  businessName,
  portalUrl,
  siteDomain,
  ownerEmail,
}: CustomerWelcomeEmailArgs): RenderedEmail {
  const name = businessName?.trim();
  const domain = siteDomain?.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const subject = name
    ? `Your website editor is ready (${name})`
    : 'Your website editor is ready';

  // `siteLabel` reads mid-sentence, so it stays lowercase when there's no
  // domain. The headline needs its own wording, or the fallback opens with a
  // lowercase "your website".
  const siteLabel = domain ? domain : 'your website';
  const headline = domain ? `${domain} is yours to update` : 'Your website is ready to update';
  const preheader = `Update your text, photos and prices yourself, any time. Setting it up takes about a minute.`;

  const benefitRows = BENEFITS.map(
    (b) => `
              <tr>
                <td valign="top" style="padding:0 10px 10px 0;font-family:${FONT};font-size:15px;line-height:22px;color:${COLORS.accent};">&#10003;</td>
                <td valign="top" style="padding:0 0 10px 0;font-family:${FONT};font-size:15px;line-height:22px;color:${COLORS.fg};">${esc(b)}</td>
              </tr>`,
  ).join('');

  const stepRows = STEPS.map(
    ([title, detail], i) => `
              <tr>
                <td valign="top" width="28" style="padding:0 12px 14px 0;font-family:${FONT};font-size:15px;line-height:22px;font-weight:700;color:${COLORS.accent};">${i + 1}.</td>
                <td valign="top" style="padding:0 0 14px 0;font-family:${FONT};font-size:15px;line-height:22px;color:${COLORS.fg};">
                  <strong style="color:${COLORS.fg};">${esc(title)}</strong><br />
                  <span style="color:${COLORS.muted};">${esc(detail)}</span>
                </td>
              </tr>`,
  ).join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="x-apple-disable-message-reformatting" />
<meta name="color-scheme" content="light" />
<meta name="supported-color-schemes" content="light" />
<title>${esc(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:${COLORS.pageBg};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${esc(preheader)}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:${COLORS.pageBg};">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:100%;max-width:600px;background-color:${COLORS.cardBg};border:1px solid ${COLORS.border};border-radius:12px;">

        <tr>
          <td style="padding:32px 32px 0 32px;font-family:${FONT};">
            <p style="margin:0 0 8px 0;font-size:13px;line-height:18px;letter-spacing:0.06em;text-transform:uppercase;color:${COLORS.muted};">Your website</p>
            <h1 style="margin:0 0 16px 0;font-size:26px;line-height:33px;font-weight:700;color:${COLORS.fg};">${esc(headline)}</h1>
            <p style="margin:0 0 8px 0;font-size:16px;line-height:24px;color:${COLORS.fg};">Hi${name ? ` ${esc(name)}` : ''},</p>
            <p style="margin:0 0 24px 0;font-size:16px;line-height:24px;color:${COLORS.fg};">
              Your site is live, and you now have your own editor for it. That means you can keep it current yourself, the day things change, without waiting on anybody.
            </p>
          </td>
        </tr>

        <tr>
          <td style="padding:0 32px;font-family:${FONT};">
            <p style="margin:0 0 14px 0;font-size:16px;line-height:24px;font-weight:700;color:${COLORS.fg};">What you can change</p>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${benefitRows}
            </table>
          </td>
        </tr>

        <tr>
          <td style="padding:22px 32px 4px 32px;font-family:${FONT};">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:${COLORS.calloutBg};border-radius:8px;">
              <tr>
                <td style="padding:14px 16px;font-family:${FONT};font-size:14px;line-height:21px;color:${COLORS.fg};">
                  Nothing you type appears on your website until you press <strong>Publish</strong>, so feel free to look around and try things.
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <tr>
          <td align="center" style="padding:26px 32px 6px 32px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td align="center" bgcolor="${COLORS.accent}" style="background-color:${COLORS.accent};border-radius:8px;">
                  <a href="${esc(portalUrl)}" target="_blank" rel="noopener" style="display:inline-block;padding:14px 30px;font-family:${FONT};font-size:16px;line-height:20px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:8px;">Open my website editor</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <tr>
          <td align="center" style="padding:0 32px 22px 32px;font-family:${FONT};">
            <p style="margin:0;font-size:13px;line-height:20px;color:${COLORS.muted};">or go to ${esc(portalUrl.replace(/^https?:\/\//, ''))}</p>
          </td>
        </tr>

        <tr>
          <td style="padding:0 32px;font-family:${FONT};">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-top:1px solid ${COLORS.border};">
              <tr><td style="height:22px;line-height:22px;font-size:0;">&nbsp;</td></tr>
            </table>
            <p style="margin:0 0 14px 0;font-size:16px;line-height:24px;font-weight:700;color:${COLORS.fg};">Setting up takes about a minute</p>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${stepRows}
            </table>
            <p style="margin:6px 0 0 0;font-size:14px;line-height:21px;color:${COLORS.muted};">You sign in with <strong style="color:${COLORS.fg};">${esc(ownerEmail)}</strong></p>
          </td>
        </tr>

        <tr>
          <td style="padding:26px 32px 32px 32px;font-family:${FONT};">
            <p style="margin:0;font-size:15px;line-height:23px;color:${COLORS.fg};">
              Questions, or want something changed that you cannot find in the editor? Just reply to this email.
            </p>
          </td>
        </tr>

      </table>

      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:100%;max-width:600px;">
        <tr>
          <td align="center" style="padding:18px 16px 0 16px;font-family:${FONT};">
            <p style="margin:0;font-size:12px;line-height:18px;color:${COLORS.muted};">You are receiving this because ${esc(ownerEmail)} was set up to manage ${esc(siteLabel)}.</p>
          </td>
        </tr>
      </table>

    </td>
  </tr>
</table>
</body>
</html>`;

  const text = [
    `Hi${name ? ` ${name}` : ''},`,
    '',
    `Your site is live, and you now have your own editor for it. That means you can keep ${siteLabel} current yourself, the day things change, without waiting on anybody.`,
    '',
    'What you can change:',
    ...BENEFITS.map((b) => `  - ${b}`),
    '',
    'Nothing you type appears on your website until you press Publish, so feel free to look around and try things.',
    '',
    `Open your editor: ${portalUrl}`,
    '',
    'Setting up takes about a minute:',
    ...STEPS.map(([title, detail], i) => `  ${i + 1}. ${title}. ${detail}`),
    '',
    `You sign in with ${ownerEmail}`,
    '',
    'Questions, or want something changed that you cannot find in the editor? Just reply to this email.',
  ].join('\n');

  return { subject, html, text };
}
