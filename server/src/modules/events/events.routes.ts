import { Router } from 'express';
import { authenticate, currentUser, optionalAuth } from '../../middleware/auth';
import validate from '../../middleware/validate';
import { z, idParams, objectId } from '../../lib/schemas';
import { REGISTRATION_STATUS, MAX_RATING, REPORT_REASONS } from '../../constants';
import * as schemas from './events.schemas';
import * as events from './events.service';
import * as registrations from './registrations.service';
import * as ratings from './ratings.service';
import * as checkin from './checkin.service';
import * as interest from './interest.service';
import * as social from './social.service';
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

/** Tell friends about an event. */
router.post(
  '/:id/invite',
  authenticate,
  validate({ params: idParams, body: z.object({ friends: z.array(objectId).min(1).max(20) }) }, async (req, res) => {
    res.json({ data: await social.inviteFriends(currentUser(req), req.params.id, req.body.friends) });
  })
);

/** Your own reminder for an event ("remind me an hour before"). */
router.get(
  '/:id/reminder',
  authenticate,
  validate({ params: idParams }, async (req, res) => {
    res.json({ data: await social.reminderFor(currentUser(req), req.params.id) });
  })
);
router.put(
  '/:id/reminder',
  authenticate,
  validate(
    {
      params: idParams,
      body: z.object({ minutesBefore: z.union([z.literal(15), z.literal(60), z.literal(180), z.literal(1440)]) }),
    },
    async (req, res) => {
      res.json({ data: await social.setReminder(currentUser(req), req.params.id, req.body.minutesBefore) });
    }
  )
);
router.delete(
  '/:id/reminder',
  authenticate,
  validate({ params: idParams }, async (req, res) => {
    res.json({ data: await social.clearReminder(currentUser(req), req.params.id) });
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

/** RSVP to every upcoming date of a repeating event. */
router.post(
  '/:id/registration/series',
  authenticate,
  validate({ params: idParams }, async (req, res) => {
    res.json({ data: await registrations.registerSeries(currentUser(req), req.params.id) });
  })
);

/** The other upcoming dates of a repeating event. */
router.get(
  '/:id/series',
  optionalAuth,
  validate({ params: idParams }, async (req, res) => {
    res.json({ data: await events.seriesFor(req.user, req.params.id) });
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

const ratingBody = z.object({
  rating: z.number().int().min(1).max(MAX_RATING),
  comment: z.string().trim().max(1000).optional(),
});

router.put(
  '/:id/ratings',
  authenticate,
  validate({ params: idParams, body: ratingBody }, async (req, res) => {
    res.json({ data: await ratings.rate(currentUser(req), req.params.id, req.body.rating, req.body.comment) });
  })
);

router.get(
  '/:id/feedback',
  authenticate,
  validate({ params: idParams }, async (req, res) => {
    res.json({ data: await ratings.feedbackFor(currentUser(req), req.params.id) });
  })
);

router.get(
  '/:id/certificate',
  authenticate,
  validate({ params: idParams }, async (req, res) => {
    res.json({ data: await ratings.certificate(currentUser(req), req.params.id) });
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
  /** Replying to another message in this chat. */
  replyTo: objectId.optional(),
});

router.get(
  '/:id/messages',
  authenticate,
  validate({ params: idParams, query: messagesQuery }, async (req, res) => {
    const { items, hasMore } = await chat.listMessages(currentUser(req), req.params.id, req.query);
    res.json({ data: items, meta: { hasMore } });
  })
);

const messageParams = z.object({ id: objectId, messageId: objectId });

router.delete(
  '/:id/messages/:messageId',
  authenticate,
  validate({ params: messageParams }, async (req, res) => {
    res.json({ data: await chat.removeMessage(currentUser(req), req.params.id, req.params.messageId) });
  })
);

router.put(
  '/:id/messages/:messageId/reactions',
  authenticate,
  validate({ params: messageParams, body: z.object({ emoji: z.enum(chat.REACTIONS) }) }, async (req, res) => {
    res.json({ data: await chat.toggleReaction(currentUser(req), req.params.id, req.params.messageId, req.body.emoji) });
  })
);

router.get(
  '/:id/messages/pinned',
  authenticate,
  validate({ params: idParams }, async (req, res) => {
    res.json({ data: await chat.pinned(currentUser(req), req.params.id) });
  })
);

router.put(
  '/:id/messages/:messageId/pin',
  authenticate,
  validate({ params: messageParams, body: z.object({ pinned: z.boolean() }) }, async (req, res) => {
    res.json({ data: await chat.setPinned(currentUser(req), req.params.id, req.params.messageId, req.body.pinned) });
  })
);

/** "I've read this chat": clears its unread badge. */
router.post(
  '/:id/messages/read',
  authenticate,
  validate({ params: idParams }, async (req, res) => {
    const event = await chat.findChatEvent(currentUser(req), req.params.id);
    await chat.markRead(currentUser(req), event._id);
    res.json({ data: { ok: true } });
  })
);

router.post(
  '/:id/messages/:messageId/report',
  authenticate,
  validate(
    {
      params: messageParams,
      body: z.object({ reason: z.enum(REPORT_REASONS), details: z.string().trim().max(1000).default('') }),
    },
    async (req, res) => {
      res.status(201).json({ data: await chat.reportMessage(currentUser(req), req.params.id, req.params.messageId, req.body) });
    }
  )
);

router.post(
  '/:id/messages',
  authenticate,
  validate({ params: idParams, body: messageBody }, async (req, res) => {
    res.status(201).json({ data: await chat.postMessage(currentUser(req), req.params.id, req.body) });
  })
);

export default router;
