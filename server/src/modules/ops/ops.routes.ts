import { Router } from 'express';
import { authenticate, currentUser } from '../../middleware/auth';
import validate from '../../middleware/validate';
import { z, idParams, objectId, optionalUrl } from '../../lib/schemas';
import * as ops from './ops.service';

const router = Router();
router.use(authenticate);

const eventAnd = (key: string) => z.object({ id: objectId, [key]: objectId });

router.get(
  '/events/:id/shifts',
  validate({ params: idParams }, async (req, res) => {
    res.json({ data: await ops.listShifts(currentUser(req), req.params.id) });
  })
);
router.post(
  '/events/:id/shifts',
  validate(
    {
      params: idParams,
      body: z.object({
        title: z.string().trim().min(2).max(80),
        startsAt: z.coerce.date(),
        endsAt: z.coerce.date(),
        slots: z.number().int().min(1).max(100),
      }),
    },
    async (req, res) => {
      res.status(201).json({ data: await ops.addShift(currentUser(req), req.params.id, req.body) });
    }
  )
);
router.delete(
  '/events/:id/shifts/:shiftId',
  validate({ params: eventAnd('shiftId') }, async (req, res) => {
    res.json({ data: await ops.removeShift(currentUser(req), req.params.id, req.params.shiftId) });
  })
);
router.put(
  '/events/:id/shifts/:shiftId/volunteer',
  validate({ params: eventAnd('shiftId'), body: z.object({ join: z.boolean() }) }, async (req, res) => {
    res.json({ data: await ops.setVolunteering(currentUser(req), req.params.id, req.params.shiftId, req.body.join) });
  })
);

router.get(
  '/events/:id/budget',
  validate({ params: idParams }, async (req, res) => {
    res.json({ data: await ops.budget(currentUser(req), req.params.id) });
  })
);
router.post(
  '/events/:id/budget',
  validate(
    {
      params: idParams,
      body: z.object({
        label: z.string().trim().min(1).max(120),
        amount: z.number().min(0).max(100_000_000),
        kind: z.enum(['income', 'expense']),
      }),
    },
    async (req, res) => {
      res.status(201).json({ data: await ops.addBudgetLine(currentUser(req), req.params.id, req.body) });
    }
  )
);
router.delete(
  '/events/:id/budget/:lineId',
  validate({ params: eventAnd('lineId') }, async (req, res) => {
    res.json({ data: await ops.removeBudgetLine(currentUser(req), req.params.id, req.params.lineId) });
  })
);

router.post(
  '/sponsors',
  validate(
    {
      body: z.object({
        name: z.string().trim().min(1).max(80),
        url: optionalUrl.default(''),
        logoUrl: optionalUrl.default(''),
        tier: z.enum(['title', 'gold', 'partner']).default('partner'),
      }),
    },
    async (req, res) => {
      res.status(201).json({ data: await ops.addSponsor(currentUser(req), req.body) });
    }
  )
);
router.get('/sponsors/mine', async (req, res) => {
  res.json({ data: await ops.listSponsors(currentUser(req).id) });
});
router.delete(
  '/sponsors/:id',
  validate({ params: idParams }, async (req, res) => {
    res.json({ data: await ops.removeSponsor(currentUser(req), req.params.id) });
  })
);

export default router;
