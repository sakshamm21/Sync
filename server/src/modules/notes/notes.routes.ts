import { Router } from 'express';
import { authenticate, currentUser } from '../../middleware/auth';
import validate from '../../middleware/validate';
import { z, objectId, idParams, pagination, queryBoolean } from '../../lib/schemas';
import { NOTE_TAGS } from '../../constants';
import * as service from './notes.service';

const router = Router();
router.use(authenticate);

const fields = {
  title: z.string().trim().min(1, 'Title is required').max(140),
  content: z.string().trim().max(20000),
  tag: z.enum(NOTE_TAGS),
  pinned: z.boolean(),
  event: objectId.nullable(),
};

const createBody = z.object({
  title: fields.title,
  content: fields.content.default(''),
  tag: fields.tag.default('plan'),
  pinned: fields.pinned.default(false),
  event: fields.event.default(null),
});

const updateBody = z
  .object(fields)
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'Nothing to update');

const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  tag: z.enum(NOTE_TAGS).optional(),
  event: objectId.optional(),
  pinned: queryBoolean.optional(),
  ...pagination,
});

router.get(
  '/',
  validate({ query: listQuery }, async (req, res) => {
    const { items, meta } = await service.list(currentUser(req), req.query);
    res.json({ data: items, meta });
  })
);

router.post(
  '/',
  validate({ body: createBody }, async (req, res) => {
    res.status(201).json({ data: await service.create(currentUser(req), req.body) });
  })
);

router.patch(
  '/:id',
  validate({ params: idParams, body: updateBody }, async (req, res) => {
    res.json({ data: await service.update(currentUser(req), req.params.id, req.body) });
  })
);

router.delete(
  '/:id',
  validate({ params: idParams }, async (req, res) => {
    await service.remove(currentUser(req), req.params.id);
    res.status(204).end();
  })
);

export default router;
