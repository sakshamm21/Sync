import { Router } from 'express';
import { authenticate, currentUser, requireRole } from '../../middleware/auth';
import validate from '../../middleware/validate';
import { z, idParams, pagination } from '../../lib/schemas';
import { ROLES, USER_STATUS, ORGANIZER_APPLICATION_STATUS, REPORT_STATUS } from '../../constants';
import * as service from './admin.service';
import * as reports from '../reports/reports.service';
import * as chat from '../chat/chat.service';

const router = Router();
router.use(authenticate, requireRole(ROLES.ADMIN));

const usersQuery = z.object({
  q: z.string().trim().max(100).optional(),
  role: z.enum(ROLES).optional(),
  status: z.enum(USER_STATUS).optional(),
  ...pagination,
});

const userUpdateBody = z
  .object({
    /** Shown to the person when they try to sign in. */
    reason: z.string().trim().max(500).optional(),
    role: z.enum(ROLES).optional(),
    status: z.enum(USER_STATUS).optional(),
  })
  .refine((body) => body.role || body.status, 'Provide a role or status');

const applicationsQuery = z.object({
  status: z.enum(ORGANIZER_APPLICATION_STATUS).optional(),
  ...pagination,
});

const reviewBody = z.object({ note: z.string().trim().max(500).default('') });

const reportsQuery = z.object({
  status: z.enum(REPORT_STATUS).optional(),
  ...pagination,
});

const resolveBody = z.object({
  status: z.enum([REPORT_STATUS.REVIEWED, REPORT_STATUS.DISMISSED]),
  // Sent to attendees and the organiser when a reviewed report cancels the event.
  reason: z.string().trim().max(500).default(''),
});

router.get(
  '/message-reports',
  validate({ query: z.object({ status: z.enum(REPORT_STATUS).optional() }) }, async (req, res) => {
    res.json({ data: await chat.listMessageReports(req.query) });
  })
);

router.patch(
  '/message-reports/:id',
  validate(
    { params: idParams, body: z.object({ status: z.enum([REPORT_STATUS.REVIEWED, REPORT_STATUS.DISMISSED]) }) },
    async (req, res) => {
      res.json({ data: await chat.resolveMessageReport(currentUser(req), req.params.id, req.body.status) });
    }
  )
);

router.get(
  '/audit-log',
  validate({ query: z.object({ ...pagination }) }, async (req, res) => {
    const { items, meta } = await service.auditLog(req.query);
    res.json({ data: items, meta });
  })
);

router.get('/stats', async (_req, res) => {
  res.json({ data: await service.stats() });
});

router.get(
  '/reports',
  validate({ query: reportsQuery }, async (req, res) => {
    const { items, meta } = await reports.listReports(req.query);
    res.json({ data: items, meta });
  })
);

router.patch(
  '/reports/:id',
  validate({ params: idParams, body: resolveBody }, async (req, res) => {
    res.json({ data: await reports.resolve(currentUser(req), req.params.id, req.body) });
  })
);

router.get(
  '/users',
  validate({ query: usersQuery }, async (req, res) => {
    const { items, meta } = await service.listUsers(req.query);
    res.json({ data: items, meta });
  })
);

router.patch(
  '/users/:id',
  validate({ params: idParams, body: userUpdateBody }, async (req, res) => {
    res.json({ data: await service.updateUser(currentUser(req), req.params.id, req.body) });
  })
);

router.get(
  '/organizer-applications',
  validate({ query: applicationsQuery }, async (req, res) => {
    const { items, meta } = await service.listApplications(req.query);
    res.json({ data: items, meta });
  })
);

router.post(
  '/organizer-applications/:id/approve',
  validate({ params: idParams, body: reviewBody }, async (req, res) => {
    res.json({ data: await service.reviewApplication(currentUser(req), req.params.id, { approve: true, note: req.body.note }) });
  })
);

router.post(
  '/organizer-applications/:id/reject',
  validate({ params: idParams, body: reviewBody }, async (req, res) => {
    res.json({ data: await service.reviewApplication(currentUser(req), req.params.id, { approve: false, note: req.body.note }) });
  })
);

export default router;
