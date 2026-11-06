import { Router } from 'express';
import { authenticate, currentUser } from '../../middleware/auth';
import validate from '../../middleware/validate';
import { z, password, optionalUrl, queryBoolean } from '../../lib/schemas';
import { CATEGORY_VALUES } from '../../constants';
import * as service from './me.service';
import { assertNotDemoAccount } from '../../demo/accounts';
import * as events from '../events/events.service';
import * as registrations from '../events/registrations.service';
import { Event } from '../../models';
import * as eventSchemas from '../events/events.schemas';

const router = Router();
router.use(authenticate);

const profileBody = z
  .object({
    name: z.string().trim().min(2, 'Name must be at least 2 characters').max(80),
    bio: z.string().trim().max(500),
    avatarUrl: optionalUrl,
    interests: z.array(z.enum(CATEGORY_VALUES)).max(CATEGORY_VALUES.length),
    preferences: z.object({ emailNotifications: z.boolean() }).partial(),
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

router.patch('/', validate({ body: profileBody }, async (req, res) => {
  res.json({ data: await service.updateProfile(currentUser(req), req.body) });
}));

router.post('/password', validate({ body: passwordBody }, async (req, res) => {
  assertNotDemoAccount(currentUser(req).email);
  res.json({ data: await service.changePassword(currentUser(req), req.body) });
}));

router.get('/calendar', validate({ query: eventSchemas.calendarRange }, async (req, res) => {
  res.json({ data: await events.calendarFor(currentUser(req), req.query) });
}));

const registrationsQuery = z.object({ upcoming: queryBoolean.default(true) });

router.get('/registrations', validate({ query: registrationsQuery }, async (req, res) => {
  res.json({ data: await registrations.listForUser(currentUser(req), { upcomingOnly: req.query.upcoming }) });
}));

export default router;
