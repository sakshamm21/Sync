import { Router } from 'express';
import { authenticate, currentUser } from '../../middleware/auth';
import validate from '../../middleware/validate';
import { z, idParams } from '../../lib/schemas';
import * as service from './organizer.service';

const router = Router();
router.use(authenticate);

const applicationBody = z.object({
  organization: z.string().trim().min(2, 'Tell us which organisation or club you represent').max(120),
  reason: z.string().trim().max(1000).default(''),
});

router.post(
  '/applications',
  validate({ body: applicationBody }, async (req, res) => {
    res.status(201).json({ data: await service.apply(currentUser(req), req.body) });
  })
);

router.get(
  '/events/:id/insights',
  validate({ params: idParams }, async (req, res) => {
    res.json({ data: await service.insights(currentUser(req), req.params.id) });
  })
);

router.get('/applications/latest', async (req, res) => {
  res.json({ data: await service.latestApplication(currentUser(req)) });
});

/**
 * The organiser console. Any signed-in user may ask for it: organisers and
 * admins get their own events, and a member who was invited to help run one
 * event gets just that event. The service decides what each person sees.
 */
router.get('/overview', async (req, res) => {
  res.json({ data: await service.overview(currentUser(req)) });
});

export default router;
