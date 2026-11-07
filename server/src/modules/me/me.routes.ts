import { Router, type Request } from 'express';
import { authenticate, currentUser } from '../../middleware/auth';
import validate from '../../middleware/validate';
import { z, password, optionalUrl, queryBoolean } from '../../lib/schemas';
import { CATEGORY_VALUES, NOTIFICATION_TYPES, type NotificationType } from '../../constants';
import * as service from './me.service';
import * as account from './account.service';
import { assertNotDemoAccount } from '../../demo/accounts';
import * as events from '../events/events.service';
import * as registrations from '../events/registrations.service';
import { Event, PushSubscription } from '../../models';
import * as eventSchemas from '../events/events.schemas';

const router = Router();
router.use(authenticate);

const profileBody = z
  .object({
    name: z.string().trim().min(2, 'Name must be at least 2 characters').max(80),
    bio: z.string().trim().max(500),
    avatarUrl: optionalUrl,
    interests: z.array(z.enum(CATEGORY_VALUES)).max(CATEGORY_VALUES.length),
    preferences: z
      .object({
        emailNotifications: z.boolean(),
        autoAcceptWaitlist: z.boolean(),
        mutedEmailTypes: z.array(z.enum(Object.values(NOTIFICATION_TYPES) as [NotificationType, ...NotificationType[]])).max(20),
      })
      .partial(),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'Nothing to update');

const passwordBody = z.object({
  currentPassword: z.string().min(1, 'Enter your current password'),
  newPassword: password,
});

router.get('/', async (req, res) => {
  const user = currentUser(req);
  // Lets the app show the organizer console to members who help run an event.
  const isEventStaff = Boolean(await Event.exists({ organizers: user._id, owner: { $ne: user._id } }));
  res.json({ data: { ...user.toJSON(), isEventStaff } });
});

router.patch(
  '/',
  validate({ body: profileBody }, async (req, res) => {
    res.json({ data: await service.updateProfile(currentUser(req), req.body) });
  })
);

router.post(
  '/password',
  validate({ body: passwordBody }, async (req, res) => {
    assertNotDemoAccount(currentUser(req).email);
    res.json({ data: await service.changePassword(currentUser(req), req.body) });
  })
);

/** Signs out every device, this one included, by refusing all tokens issued so far. */
router.post('/sign-out-everywhere', async (req, res) => {
  const user = currentUser(req);
  // A shared demo account would sign out every visitor using it.
  assertNotDemoAccount(user.email);
  user.sessionsRevokedAt = new Date();
  await user.save();
  res.json({ data: { ok: true } });
});

const pushBody = z.object({
  endpoint: z.url({ protocol: /^https$/ }).max(1000),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
});

/** Registers this device for push notifications (idempotent per endpoint). */
router.post(
  '/push-subscriptions',
  validate({ body: pushBody }, async (req, res) => {
    const user = currentUser(req);
    await PushSubscription.updateOne(
      { endpoint: req.body.endpoint },
      { $set: { user: user._id, keys: req.body.keys } },
      { upsert: true }
    );
    res.status(201).json({ data: { ok: true } });
  })
);

/** Stops push to this device. */
router.post(
  '/push-subscriptions/remove',
  validate({ body: z.object({ endpoint: z.string().max(1000) }) }, async (req, res) => {
    await PushSubscription.deleteOne({ endpoint: req.body.endpoint, user: currentUser(req)._id });
    res.json({ data: { ok: true } });
  })
);

/** "Download my data": everything Sync holds about you, as JSON. */
router.get('/export', async (req, res) => {
  const data = await account.exportData(currentUser(req));
  res.set('Content-Disposition', 'attachment; filename="sync-my-data.json"').json(data);
});

/** Deletes the account for good; the password confirms it's really them. */
router.post(
  '/delete',
  validate({ body: z.object({ password: z.string().min(1, 'Enter your password') }) }, async (req, res) => {
    await account.deleteAccount(currentUser(req), req.body.password);
    res.json({ data: { deleted: true } });
  })
);

/** The secret calendar subscription URL ("Subscribe in Google/Apple/Outlook Calendar"). */
const feedUrls = (req: Request, token: string) => {
  const url = `${req.protocol}://${req.get('host')}/api/calendar/${token}.ics`;
  return { url, webcalUrl: url.replace(/^https?:/, 'webcal:') };
};

router.get('/calendar-feed', async (req, res) => {
  res.json({ data: feedUrls(req, await events.calendarTokenFor(currentUser(req))) });
});

/** Replaces the secret, so an old shared link stops working. */
router.post('/calendar-feed/reset', async (req, res) => {
  res.json({ data: feedUrls(req, await events.calendarTokenFor(currentUser(req), { reset: true })) });
});

router.get(
  '/calendar',
  validate({ query: eventSchemas.calendarRange }, async (req, res) => {
    res.json({ data: await events.calendarFor(currentUser(req), req.query) });
  })
);

const registrationsQuery = z.object({ upcoming: queryBoolean.default(true) });

router.get(
  '/registrations',
  validate({ query: registrationsQuery }, async (req, res) => {
    res.json({ data: await registrations.listForUser(currentUser(req), { upcomingOnly: req.query.upcoming }) });
  })
);

export default router;
