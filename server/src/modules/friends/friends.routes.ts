import { Router } from 'express';
import { authenticate, currentUser } from '../../middleware/auth';
import validate from '../../middleware/validate';
import { z, idParams } from '../../lib/schemas';
import * as friends from './friends.service';

const router = Router();
router.use(authenticate);

router.get('/', async (req, res) => {
  res.json({ data: await friends.list(currentUser(req)) });
});

router.post(
  '/requests',
  validate({ body: z.object({ email: z.email().trim().toLowerCase() }) }, async (req, res) => {
    res.status(201).json({ data: await friends.request(currentUser(req), req.body.email) });
  })
);

router.put(
  '/requests/:id',
  validate({ params: idParams, body: z.object({ accept: z.boolean() }) }, async (req, res) => {
    res.json({ data: await friends.respond(currentUser(req), req.params.id, req.body.accept) });
  })
);

router.delete(
  '/:id',
  validate({ params: idParams }, async (req, res) => {
    res.json({ data: await friends.remove(currentUser(req), req.params.id) });
  })
);

export default router;
