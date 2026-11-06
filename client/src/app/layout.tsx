import type { Metadata, Viewport } from 'next';
import { Bricolage_Grotesque, Geist, Geist_Mono, Instrument_Serif } from 'next/font/google';
import './globals.css';
import Providers from './providers';

const sans = Geist({ subsets: ['latin'], variable: '--font-geist-sans' });
const mono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono' });
const display = Bricolage_Grotesque({ subsets: ['latin'], variable: '--font-bricolage', axes: ['wdth', 'opsz'] });
const serif = Instrument_Serif({ subsets: ['latin'], weight: '400', style: ['normal', 'italic'], variable: '--font-instrument' });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'),
  title: {
    default: 'Sync: what’s the move?',
    template: '%s · Sync',
  },
  description: 'Campus plans, minus the chaos. Find what’s on, RSVP in a tap, and never miss the good stuff.',
  icons: { icon: '/icon.svg' },
  openGraph: {
    type: 'website',
    siteName: 'Sync',
    title: 'Sync: what’s the move?',
    description: 'Campus plans, minus the chaos. Find what’s on, RSVP in a tap, and never miss the good stuff.',
  },
  twitter: { card: 'summary_large_image' },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f3efe6' },
    { media: '(prefers-color-scheme: dark)', color: '#09090d' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // next-themes sets the theme class before paint, which React would otherwise flag.
    <html
      lang="en"
      className={`${sans.variable} ${mono.variable} ${display.variable} ${serif.variable}`}
      suppressHydrationWarning
    >
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
