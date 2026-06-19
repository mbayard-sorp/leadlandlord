export type NavLinkItem = {
  href: string;
  label: string;
  disabled?: boolean;
};

export const navLinks: ReadonlyArray<NavLinkItem> = [
  { href: '/operator', label: 'Overview' },
  { href: '/operator/portfolio', label: 'Portfolio' },
  { href: '/operator/build', label: 'Build site' },
  { href: '/operator/buildsell', label: 'Build & Sell' },
  { href: '/operator/calls', label: 'Calls' },
  { href: '/operator/agents', label: 'Agents' },
  { href: '/operator/seo', label: 'SEO' },
  { href: '/operator/links', label: 'Link building' },
  { href: '/operator/email-sends', label: 'Email Sends' },
  { href: '/operator/maintenance', label: 'Maintenance' },
  { href: '/operator/control', label: 'Control' },
  { href: '/operator/orchestrator', label: 'Orchestrator' },
  { href: '/operator/pipeline', label: 'Pipeline', disabled: true },
  { href: '/operator/tenants', label: 'Tenants', disabled: true },
  { href: '/operator/niches', label: 'Niches' },
  { href: '/operator/networks', label: 'Networks' },
  { href: '/operator/waves', label: 'Waves' },
  { href: '/operator/content', label: 'Content' },
  { href: '/operator/approvals/content', label: 'Content queue' },
  { href: '/operator/pnl', label: 'P&L', disabled: true },
];
