import { Router } from 'express';
import { authenticate, currentUser } from '../../middleware/auth';
import validate from '../../middleware/validate';
import { z, idParams, objectId } from '../../lib/schemas';
import * as teams from './teams.service';

/** Mounted at /api/events/:id/teams. */
const router = Router({ mergeParams: true });
router.use(authenticate);

router.get(
  '/',
  validate({ params: idParams }, async (req, res) => {
    res.json({ data: await teams.list(currentUser(req), req.params.id) });
  })
);
router.get(
  '/mine',
  validate({ params: idParams }, async (req, res) => {
    res.json({ data: await teams.mine(currentUser(req), req.params.id) });
  })
);
router.post(
  '/',
  validate(
    { params: idParams, body: z.object({ name: z.string().trim().min(2, 'Give your team a name').max(60) }) },
    async (req, res) => {
      res.status(201).json({ data: await teams.create(currentUser(req), req.params.id, req.body.name) });
    }
  )
);
router.post(
  '/join',
  validate({ params: idParams, body: z.object({ code: z.string().trim().min(4).max(10) }) }, async (req, res) => {
    res.json({ data: await teams.join(currentUser(req), req.params.id, req.body.code) });
  })
);
router.delete(
  '/mine',
  validate({ params: idParams }, async (req, res) => {
    res.json({ data: await teams.leave(currentUser(req), req.params.id) });
  })
);
router.put(
  '/:teamId/check-in',
  validate({ params: z.object({ id: objectId, teamId: objectId }) }, async (req, res) => {
    res.json({ data: await teams.checkInTeam(currentUser(req), req.params.id, req.params.teamId) });
  })
);

export default router;
