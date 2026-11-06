import { Router } from 'express';
import { authenticate, currentUser, optionalAuth } from '../../middleware/auth';
import validate from '../../middleware/validate';
import { z, idParams, objectId } from '../../lib/schemas';
import { REGISTRATION_STATUS, MAX_RATING } from '../../constants';
import * as schemas from './events.schemas';
import * as events from './events.service';
import * as registrations from './registrations.service';
import * as ratings from './ratings.service';
import * as checkin from './checkin.service';
import * as interest from './interest.service';
import * as chat from '../chat/chat.service';

const router = Router();

// --- Discovery -------------------------------------------------------------

router.get(
  '/',
  optionalAuth,
  validate({ query: schemas.list }, async (req, res) => {
    const { items, meta } = await events.listPublic(req.user, req.query);
    res.json({ data: items, meta });
  })
);

router.get('/venues', async (_req, res) => {
  res.json({ data: await events.venueDirectory() });
});

router.get('/recommended', authenticate, async (req, res) => {
  res.json({ data: await events.recommendedFor(currentUser(req)) });
});

router.get(
  '/:id',
  optionalAuth,
  validate({ params: idParams }, async (req, res) => {
    res.json({ data: await events.getForViewer(req.user, req.params.id) });
  })
);

router.get(
  '/:id/calendar.ics',
  optionalAuth,
  validate({ params: idParams }, async (req, res) => {
    const { filename, content } = await events.toCalendarFile(req.user, req.params.id);
    res.type('text/calendar').attachment(filename).send(content);
  })
);

/** Accept a spot held for you off the waitlist. */
router.post(
  '/:id/registration/claim',
  authenticate,
  validate({ params: idParams }, async (req, res) => {
    res.json({ data: await registrations.claim(currentUser(req), req.params.id) });
  })
);

/** Bookmark ("Interested") or un-bookmark an event. */
router.put(
  '/:id/interest',
  authenticate,
  validate({ params: idParams }, async (req, res) => {
    res.json({ data: await interest.markInterested(currentUser(req), req.params.id, true) });
  })
);
router.delete(
  '/:id/interest',
  authenticate,
  validate({ params: idParams }, async (req, res) => {
    res.json({ data: await interest.markInterested(currentUser(req), req.params.id, false) });
  })
);

// --- Management ------------------------------------------------------------

router.post(
  '/',
  authenticate,
  validate({ body: schemas.create }, async (req, res) => {
    res.status(201).json({ data: await events.create(currentUser(req), req.body) });
  })
);

router.patch(
  '/:id',
  authenticate,
  validate({ params: idParams, body: schemas.update }, async (req, res) => {
    res.json({ data: await events.update(currentUser(req), req.params.id, req.body) });
  })
);

router.post(
  '/:id/cancel',
  authenticate,
  validate({ params: idParams, body: schemas.cancel }, async (req, res) => {
    res.json({ data: await events.cancel(currentUser(req), req.params.id, req.body) });
  })
);

router.delete(
  '/:id',
  authenticate,
  validate({ params: idParams }, async (req, res) => {
    await events.remove(currentUser(req), req.params.id);
    res.status(204).end();
  })
);

// --- Registration ----------------------------------------------------------

router.post(
  '/:id/registration',
  authenticate,
  validate({ params: idParams, body: schemas.registerBody }, async (req, res) => {
    res.json({ data: await registrations.register(currentUser(req), req.params.id, req.body) });
  })
);

router.delete(
  '/:id/registration',
  authenticate,
  validate({ params: idParams }, async (req, res) => {
    res.json({ data: await registrations.unregister(currentUser(req), req.params.id) });
  })
);

/** Approve or decline someone's request to join (events that need approval). */
router.put(
  '/:id/attendees/:userId/approval',
  authenticate,
  validate(
    { params: z.object({ id: objectId, userId: objectId }), body: z.object({ approve: z.boolean() }) },
    async (req, res) => {
      res.json({ data: await registrations.decide(currentUser(req), req.params.id, req.params.userId, req.body.approve) });
    }
  )
);

const attendeesQuery = z.object({ status: z.enum(REGISTRATION_STATUS).optional() });

router.get(
  '/:id/attendees',
  authenticate,
  validate({ params: idParams, query: attendeesQuery }, async (req, res) => {
    res.json({ data: await registrations.listForEvent(currentUser(req), req.params.id, req.query) });
  })
);

/** Door staff's list: names and check-in state, no email addresses. */
router.get(
  '/:id/door-list',
  authenticate,
  validate({ params: idParams }, async (req, res) => {
    res.json({ data: await registrations.doorListForEvent(currentUser(req), req.params.id) });
  })
);

router.put(
  '/:id/attendees/:userId/check-in',
  authenticate,
  validate({ params: schemas.registrationParams, body: schemas.checkIn }, async (req, res) => {
    const { id, userId } = req.params;
    res.json({ data: await registrations.setCheckIn(currentUser(req), id, userId, req.body.checkedIn) });
  })
);

// --- Ratings ---------------------------------------------------------------

router.get(
  '/:id/ratings',
  authenticate,
  validate({ params: idParams }, async (req, res) => {
    res.json({ data: await ratings.summaryFor(currentUser(req), req.params.id) });
  })
);

const ratingBody = z.object({ rating: z.number().int().min(1).max(MAX_RATING) });

router.put(
  '/:id/ratings',
  authenticate,
  validate({ params: idParams, body: ratingBody }, async (req, res) => {
    res.json({ data: await ratings.rate(currentUser(req), req.params.id, req.body.rating) });
  })
);

// --- Door check-in by QR ---------------------------------------------------

router.get(
  '/:id/ticket',
  authenticate,
  validate({ params: idParams }, async (req, res) => {
    const ticket = await checkin.ticketFor(currentUser(req), req.params.id);
    res.json({ data: ticket });
  })
);

const scanBody = z.object({ token: z.string().trim().min(1, 'Scan a ticket code') });

router.post(
  '/:id/scan',
  authenticate,
  validate({ params: idParams, body: scanBody }, async (req, res) => {
    res.json({ data: await checkin.checkInByTicket(currentUser(req), req.params.id, req.body.token) });
  })
);

// --- Discussion ------------------------------------------------------------

// A message id, or a timestamp from clients that predate id cursors.
const messageCursor = z.union([objectId, z.coerce.date()]);
const messagesQuery = z.object({
  before: messageCursor.optional(),
  after: messageCursor.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const messageBody = z.object({
  text: z.string().trim().min(1, 'Message cannot be empty').max(2000),
  announcement: z.boolean().default(false),
  /** Who an announcement notifies: everyone registered, only those going, or only the waitlist. */
  audience: z.enum(['all', 'going', 'waitlisted']).default('all'),
});

router.get(
  '/:id/messages',
  authenticate,
  validate({ params: idParams, query: messagesQuery }, async (req, res) => {
    const { items, hasMore } = await chat.listMessages(currentUser(req), req.params.id, req.query);
    res.json({ data: items, meta: { hasMore } });
  })
);

router.post(
  '/:id/messages',
  authenticate,
  validate({ params: idParams, body: messageBody }, async (req, res) => {
    res.status(201).json({ data: await chat.postMessage(currentUser(req), req.params.id, req.body) });
  })
);

export default router;
