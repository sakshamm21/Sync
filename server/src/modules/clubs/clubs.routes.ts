import { Router } from 'express';
import { authenticate, currentUser, optionalAuth } from '../../middleware/auth';
import validate from '../../middleware/validate';
import { z, idParams } from '../../lib/schemas';
import { CATEGORY_VALUES } from '../../constants';
import * as clubs from './clubs.service';
import * as members from './members.service';

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

// --- The signed-in club's own committee -------------------------------------

const memberRole = z.enum(['core', 'volunteer']);

router.get('/me/webhook', authenticate, async (req, res) => {
  res.json({ data: await clubs.webhookStatus(currentUser(req)) });
});
router.put(
  '/me/webhook',
  authenticate,
  validate({ body: z.object({ url: z.string().trim().max(500) }) }, async (req, res) => {
    res.json({ data: await clubs.setWebhook(currentUser(req), req.body.url) });
  })
);

router.get('/me/members', authenticate, async (req, res) => {
  res.json({ data: await members.list(currentUser(req)) });
});
router.post(
  '/me/members',
  authenticate,
  validate({ body: z.object({ email: z.email().trim().toLowerCase(), role: memberRole }) }, async (req, res) => {
    res.status(201).json({ data: await members.add(currentUser(req), req.body) });
  })
);
router.patch(
  '/me/members/:id',
  authenticate,
  validate({ params: idParams, body: z.object({ role: memberRole }) }, async (req, res) => {
    res.json({ data: await members.setRole(currentUser(req), req.params.id, req.body.role) });
  })
);
router.delete(
  '/me/members/:id',
  authenticate,
  validate({ params: idParams }, async (req, res) => {
    res.json({ data: await members.remove(currentUser(req), req.params.id) });
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
