import pino, { type TransportSingleOptions } from 'pino';
import env from '../config/env';

function prettyTransport(): TransportSingleOptions | undefined {
  if (env.isProduction || env.isTest) return undefined;
  try {
    require.resolve('pino-pretty');
    return { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } };
  } catch {
    return undefined;
  }
}

const logger = pino({
  level: env.logLevel,
  transport: prettyTransport(),
  // Request logs include headers. Hosts add their own credentials there (Vercel
  // sends a protection cookie, an OIDC token and proxy signatures), so those
  // never reach the logs either.
  redact: [
    'req.headers.authorization',
    'req.headers.cookie',
    'req.headers["x-vercel-oidc-token"]',
    'req.headers["x-vercel-proxy-signature"]',
    'req.headers.forwarded',
    '*.password',
    '*.otp',
    '*.token',
  ],
});

export default logger;
