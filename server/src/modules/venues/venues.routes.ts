/** The campus venue list: anyone signed in can read it; admins keep it up to date. */
import { Router } from 'express';
import { authenticate, currentUser, requireRole } from '../../middleware/auth';
import validate from '../../middleware/validate';
import { z, idParams } from '../../lib/schemas';
import { conflict, notFound } from '../../lib/errors';
import { audit } from '../../lib/audit';
import { CampusVenue } from '../../models';
import { ROLES } from '../../constants';

const router = Router();
router.use(authenticate);

const venueBody = z.object({
  name: z.string().trim().min(2).max(160),
  address: z.string().trim().max(300).default(''),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  capacity: z.number().int().min(1).max(100_000).nullable().default(null),
  accessibility: z.string().trim().max(500).default(''),
});

router.get('/', async (_req, res) => {
  res.json({ data: await CampusVenue.find({}).sort({ name: 1 }).collation({ locale: 'en' }) });
});

const save = async (fn: () => Promise<unknown>) => {
  try {
    return await fn();
  } catch (err) {
    if ((err as { code?: number }).code === 11000) throw conflict('A venue with that name already exists', 'VENUE_EXISTS');
    throw err;
  }
};

router.post(
  '/',
  requireRole(ROLES.ADMIN),
  validate({ body: venueBody }, async (req, res) => {
    const venue = (await save(() => CampusVenue.create(req.body))) as InstanceType<typeof CampusVenue>;
    await audit(currentUser(req), 'venue.added', `Added venue ${venue.name}`, { kind: 'event', id: venue._id });
    res.status(201).json({ data: venue });
  })
);

router.patch(
  '/:id',
  requireRole(ROLES.ADMIN),
  validate({ params: idParams, body: venueBody.partial() }, async (req, res) => {
    const venue = await save(() =>
      CampusVenue.findByIdAndUpdate(req.params.id, { $set: req.body }, { new: true, runValidators: true })
    );
    if (!venue) throw notFound('Venue not found');
    res.json({ data: venue });
  })
);

router.delete(
  '/:id',
  requireRole(ROLES.ADMIN),
  validate({ params: idParams }, async (req, res) => {
    const venue = await CampusVenue.findByIdAndDelete(req.params.id);
    if (!venue) throw notFound('Venue not found');
    await audit(currentUser(req), 'venue.removed', `Removed venue ${venue.name}`, { kind: 'event', id: venue._id });
    res.status(204).end();
  })
);

export default router;
