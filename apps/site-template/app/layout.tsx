import type { Metadata } from 'next';
import { allFontVars } from '../lib/fonts';
import { loadBundle } from '../lib/content';
import './globals.css';

export const metadata: Metadata = {
  title: 'LeadLandlord Site',
  description: 'Local lead-gen site',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const bundle = loadBundle();
  return (
    <html lang="en" className={allFontVars} data-theme={bundle.variant}>
      <body>{children}</body>
    </html>
  );
}
