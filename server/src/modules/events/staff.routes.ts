import { Router } from 'express';
import { authenticate, currentUser } from '../../middleware/auth';
import validate from '../../middleware/validate';
import { z, idParams } from '../../lib/schemas';
import { STAFF_ROLES } from '../../constants';
import { forbidden } from '../../lib/errors';
import { loadEvent } from './events.policy';
import * as staff from './staff.service';

const router = Router();

const staffParams = z.object({ id: idParams.shape.id, staffId: idParams.shape.id });

const inviteBody = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email({ error: 'Enter a valid email address' })),
  role: z.enum([STAFF_ROLES.MANAGER, STAFF_ROLES.CHECKIN]),
});

const roleBody = z.object({ role: z.enum(STAFF_ROLES) });

/** Everyone who can help run an event. */
router.get('/:id/staff', authenticate, validate({ params: idParams }, async (req, res) => {
  const { event, access } = await loadEvent(currentUser(req), req.params.id);
  if (!access.canManage && !access.canCheckIn) throw forbidden('Only the organiser can see the team');
  res.json({ data: await staff.listStaff(event.id) });
}));

/** Adds someone to the team and tells them. */
router.post('/:id/staff', authenticate, validate({ params: idParams, body: inviteBody }, async (req, res) => {
  res.status(201).json({ data: await staff.invite(currentUser(req), req.params.id, req.body) });
}));

router.patch(
  '/:id/staff/:staffId',
  authenticate,
  validate({ params: staffParams, body: roleBody }, async (req, res) => {
    const { id, staffId } = req.params;
    res.json({ data: await staff.setStaffRole(currentUser(req), id, staffId, req.body.role) });
  })
);

router.delete('/:id/staff/:staffId', authenticate, validate({ params: staffParams }, async (req, res) => {
  const { id, staffId } = req.params;
  res.json({ data: await staff.removeStaff(currentUser(req), id, staffId) });
}));

export default router;