import crypto from 'node:crypto';
import { Router, type RequestHandler } from 'express';
import env from '../../config/env';
import { conflict, forbidden, notFound } from '../../lib/errors';
import { sendDueReminders } from '../../jobs/eventReminders';
import { drainOutbox } from '../../jobs/outbox';
import { recountAttendees, pruneOldData } from '../../jobs/maintenance';
import { resetDemoData } from '../../demo/seed';

const router = Router();

/** Scheduled jobs are triggered by Vercel Cron, which sends `Authorization: Bearer $CRON_SECRET`. */
const requireCronSecret: RequestHandler = (req, _res, next) => {
  if (!env.cronSecret) throw notFound('Scheduled jobs are not enabled', 'JOBS_DISABLED');
  const expected = Buffer.from(`Bearer ${env.cronSecret}`);
  const actual = Buffer.from(req.get('authorization') || '');
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) throw forbidden();
  next();
};

/** Emails due 24 hours before an event starts. */
router.get('/event-reminders', requireCronSecret, async (_req, res) => {
  res.json({ data: { sent: await sendDueReminders() } });
});

/** Delivers anything queued by the email outbox. */
router.get('/email-outbox', requireCronSecret, async (_req, res) => {
  res.json({ data: { sent: await drainOutbox() } });
});

/** Reconciles attendee counts and prunes rows nothing will read again. */
router.get('/maintenance', requireCronSecret, async (_req, res) => {
  const corrected = await recountAttendees();
  const pruned = await pruneOldData();
  res.json({ data: { corrected, ...pruned } });
});

/**
 * Public demo only (DEMO_MODE): replaces all data with fresh demo data dated
 * from today, so the shared demo always has upcoming events and any vandalism
 * lasts a day at most.
 */
router.get('/demo-reset', requireCronSecret, async (_req, res) => {
  if (!env.demoMode) throw notFound('Demo mode is not enabled', 'DEMO_MODE_OFF');
  const result = await resetDemoData();
  if (!result) throw conflict('A demo reset is already running', 'RESET_IN_PROGRESS');
  res.json({ data: { users: result.users.size, events: result.eventIds.size } });
});

export default router;