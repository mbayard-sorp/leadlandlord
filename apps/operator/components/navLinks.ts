export type NavLinkItem = {
  href: string;
  label: string;
  disabled?: boolean;
};

export const navLinks: ReadonlyArray<NavLinkItem> = [
  { href: '/operator', label: 'Overview' },
  { href: '/operator/portfolio', label: 'Portfolio' },
  { href: '/operator/build', label: 'Build site' },
  { href: '/operator/calls', label: 'Calls' },
  { href: '/operator/agents', label: 'Agents' },
  { href: '/operator/seo', label: 'SEO' },
  { href: '/operator/backlinks', label: 'Backlinks' },
  { href: '/operator/backlinks/prospects', label: '↳ Prospects' },
  { href: '/operator/molly', label: '↳ Molly' },
  { href: '/operator/email-sends', label: 'Email Sends' },
  { href: '/operator/maintenance', label: 'Maintenance' },
  { href: '/operator/control', label: 'Control' },
  { href: '/operator/prospects', label: 'Prospects' },
  { href: '/operator/tenants', label: 'Tenants' },
  { href: '/operator/trials', label: 'Trials' },
  { href: '/operator/niches', label: 'Niches' },
  { href: '/operator/networks', label: 'Networks' },
  { href: '/operator/waves', label: 'Waves' },
  { href: '/operator/approvals', label: 'Approvals' },
  { href: '/operator/approvals/niches', label: '↳ Niche queue' },
  { href: '/operator/approvals/rules', label: '↳ Auto-approve' },
  { href: '/operator/pnl', label: 'P&L', disabled: true },
];
