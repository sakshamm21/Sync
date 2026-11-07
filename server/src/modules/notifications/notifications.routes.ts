import { Router } from 'express';
import { authenticate, currentUser } from '../../middleware/auth';
import validate from '../../middleware/validate';
import { z, idParams, pagination, queryBoolean } from '../../lib/schemas';
import * as service from './notifications.service';

const router = Router();
router.use(authenticate);

const listQuery = z.object({ ...pagination, unreadOnly: queryBoolean.default(false) });

router.get(
  '/',
  validate({ query: listQuery }, async (req, res) => {
    const { items, meta } = await service.list(currentUser(req), req.query);
    res.json({ data: items, meta });
  })
);

router.post('/read-all', async (req, res) => {
  res.json({ data: await service.markAllRead(currentUser(req)) });
});

router.post(
  '/:id/read',
  validate({ params: idParams }, async (req, res) => {
    res.json({ data: await service.markRead(currentUser(req), req.params.id) });
  })
);

export default router;
