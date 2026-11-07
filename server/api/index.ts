/**
 * Vercel serverless entry point. All routes are rewritten here (see vercel.json),
 * and Vercel compiles this TypeScript file and everything it imports.
 * Long-running hosts (local, Docker, Render) use src/server.ts instead, which
 * also runs Socket.io and the reminder timer.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import env from '../src/config/env';
import logger from '../src/lib/logger';
import { connectDatabase } from '../src/config/db';
import { createApp } from '../src/app';

const app = createApp();

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    await connectDatabase(env.dbUri);
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'Database unavailable');
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        error: { code: 'DATABASE_UNAVAILABLE', message: 'Service temporarily unavailable. Please try again shortly.' },
      })
    );
    return;
  }
  return app(req, res);
}
