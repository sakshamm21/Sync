import { Router } from 'express';
import { authenticate, currentUser } from '../../middleware/auth';
import validate from '../../middleware/validate';
import { z, idParams } from '../../lib/schemas';
import { REPORT_REASONS, REPORT_STATUS } from '../../constants';
import * as reports from './reports.service';

const router = Router();

const fileBody = z.object({
  reason: z.enum(REPORT_REASONS),
  details: z.string().trim().max(1000).default(''),
});

router.post('/:id/report', authenticate, validate({ params: idParams, body: fileBody }, async (req, res) => {
  const report = await reports.file(currentUser(req), req.params.id, req.body);
  res.status(201).json({ data: { id: report.id, status: report.status } });
}));

export default router;