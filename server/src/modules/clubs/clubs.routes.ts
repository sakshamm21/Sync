import { Router } from 'express';
import { authenticate, currentUser, optionalAuth } from '../../middleware/auth';
import validate from '../../middleware/validate';
import { z, idParams } from '../../lib/schemas';
import { CATEGORY_VALUES } from '../../constants';
import * as clubs from './clubs.service';

const router = Router();

const suggestionsQuery = z.object({
  interests: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',') : []))
    .pipe(z.array(z.enum(CATEGORY_VALUES))),
});

router.get(
  '/suggestions',
  authenticate,
  validate({ query: suggestionsQuery }, async (req, res) => {
    const user = currentUser(req);
    res.json({ data: await clubs.suggestions(user, req.query.interests.length ? req.query.interests : user.interests) });
  })
);

router.get(
  '/:id',
  optionalAuth,
  validate({ params: idParams }, async (req, res) => {
    res.json({ data: await clubs.profile(req.user, req.params.id) });
  })
);

router.put(
  '/:id/follow',
  authenticate,
  validate({ params: idParams }, async (req, res) => {
    res.json({ data: await clubs.setFollowing(currentUser(req), req.params.id, true) });
  })
);

router.delete(
  '/:id/follow',
  authenticate,
  validate({ params: idParams }, async (req, res) => {
    res.json({ data: await clubs.setFollowing(currentUser(req), req.params.id, false) });
  })
);

export default router;
