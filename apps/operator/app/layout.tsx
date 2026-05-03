import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'LeadLandlord — Operator',
  description: 'Multi-agent rank-and-rent portfolio operator',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
