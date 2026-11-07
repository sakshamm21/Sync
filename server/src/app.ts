import crypto from 'node:crypto';
import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import env from './config/env';
import logger from './lib/logger';
import { isDatabaseConnected } from './config/db';
import { apiLimiter } from './middleware/rateLimit';
import { notFoundHandler, errorHandler } from './middleware/errorHandler';
import jobsRoutes from './modules/jobs/jobs.routes';
import authRoutes from './modules/auth/auth.routes';
import meRoutes from './modules/me/me.routes';
import eventsRoutes from './modules/events/events.routes';
import notesRoutes from './modules/notes/notes.routes';
import placesRoutes from './modules/places/places.routes';
import notificationsRoutes from './modules/notifications/notifications.routes';
import organizerRoutes from './modules/organizer/organizer.routes';
import adminRoutes from './modules/admin/admin.routes';
import assistantRoutes from './modules/assistant/assistant.routes';
import staffRoutes from './modules/events/staff.routes';
import reportsRoutes from './modules/reports/reports.routes';
import clubsRoutes from './modules/clubs/clubs.routes';
import uploadsRoutes from './modules/uploads/uploads.routes';
import { calendarFeed } from './modules/events/events.service';

export function createApp(): Express {
  const app = express();

  app.set('trust proxy', env.trustProxy);
  app.use(helmet());
  app.use(cors({ origin: env.clientOrigins.includes('*') ? true : env.clientOrigins }));
  app.use(
    pinoHttp({
      logger,
      // Reuse Vercel's request id when there is one, and hand the id back in
      // X-Request-Id so a user's bug report can be matched to the log line.
      genReqId: (req, res) => {
        const id = (req.headers['x-vercel-id'] as string | undefined) || crypto.randomUUID();
        res.setHeader('X-Request-Id', id);
        return id;
      },
      autoLogging: { ignore: (req) => req.url === '/api/health' },
      customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
    })
  );
  app.use(express.json({ limit: '100kb' }));

  app.get('/api/health', (_req, res) => {
    const database = isDatabaseConnected() ? 'up' : 'down';
    res.status(database === 'up' ? 200 : 503).json({
      data: { status: database === 'up' ? 'ok' : 'degraded', database, uptime: Math.round(process.uptime()) },
    });
  });

  // Lets the web app adapt to the host: live sockets or polling, and whether the assistant is on.
  app.get('/api/meta', (_req, res) => {
    res.json({
      data: {
        realtime: env.realtime,
        emailDelivery: env.mail.enabled,
        assistant: env.ai.enabled,
        demo: env.demoMode,
        allowedEmailDomains: env.allowedEmailDomains,
        // The browser needs this to subscribe; null when push isn't set up.
        pushPublicKey: env.push.enabled ? env.push.publicKey : null,
        uploads: env.uploads.enabled,
      },
    });
  });

  app.use('/api/jobs', jobsRoutes);
  app.use('/api', apiLimiter);
  app.use('/api/auth', authRoutes);
  app.use('/api/me', meRoutes);
  // Calendar apps fetch the subscription with only the secret in the URL.
  app.get('/api/calendar/:file', async (req, res) => {
    const token = req.params.file.replace(/\.ics$/, '');
    const content = /^[\w-]{20,64}$/.test(token) ? await calendarFeed(token) : null;
    if (!content) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'This calendar link is no longer valid.' } });
      return;
    }
    res.set('Cache-Control', 'private, max-age=300').type('text/calendar').send(content);
  });
  app.use('/api/events', eventsRoutes);
  app.use('/api/clubs', clubsRoutes);
  app.use('/api/uploads', uploadsRoutes);
  app.use('/api/event-staff', staffRoutes);
  app.use('/api/reports', reportsRoutes);
  app.use('/api/notes', notesRoutes);
  app.use('/api/places', placesRoutes);
  app.use('/api/notifications', notificationsRoutes);
  app.use('/api/organizer', organizerRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/assistant', assistantRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
