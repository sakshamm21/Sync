import type { MetadataRoute } from 'next';

/** Lets Sync install to the home screen and open like an app. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Sync: campus events',
    short_name: 'Sync',
    description: 'Find what’s on, RSVP in a tap, and never miss the good stuff.',
    start_url: '/dashboard',
    scope: '/',
    display: 'standalone',
    background_color: '#09090d',
    theme_color: '#09090d',
    categories: ['education', 'social', 'events'],
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Explore', url: '/explore' },
      { name: 'My schedule', url: '/schedule' },
    ],
  };
}
