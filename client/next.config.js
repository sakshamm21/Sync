const API_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000').replace(/\/$/, '');
const isDev = process.env.NODE_ENV !== 'production';
// Preview deployments load Vercel's comments toolbar from vercel.live.
const toolbar = process.env.VERCEL_ENV === 'preview' ? ' https://vercel.live' : '';

/**
 * Security headers for every page (E7). The API has helmet; these cover the
 * web app. The CSP allows only what the app uses: its own scripts, the API
 * (HTTP and WebSocket), OpenStreetMap embeds, and images from anywhere
 * (organisers paste cover and avatar URLs). Next's inline bootstrap scripts
 * need 'unsafe-inline'; dev mode also needs 'unsafe-eval'.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}${toolbar}`,
  `style-src 'self' 'unsafe-inline'${toolbar}`,
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self' ${API_URL} ${API_URL.replace(/^http/, 'ws')}${isDev ? ' ws://localhost:* http://localhost:*' : ''}${toolbar}${toolbar && ' wss://ws-us3.pusher.com'}`,
  `frame-src https://www.openstreetmap.org${toolbar}`,
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  // The door scanner needs the camera; nothing needs the microphone or location.
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
  ...(isDev ? [] : [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' }]),
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The repo also has root and server lockfiles; build from this folder.
  turbopack: { root: __dirname },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

module.exports = nextConfig;
