import { Router } from 'express';
import validate from '../../middleware/validate';
import { authLimiter } from '../../middleware/rateLimit';
import * as schemas from './auth.schemas';
import * as service from './auth.service';
import { assertNotDemoAccount } from '../../demo/accounts';

const router = Router();
router.use(authLimiter);

router.post(
  '/register',
  validate({ body: schemas.register }, async (req, res) => {
    res.status(201).json({ data: await service.register(req.body) });
  })
);

router.post(
  '/verify-email',
  validate({ body: schemas.verifyEmail }, async (req, res) => {
    res.json({ data: await service.verifyEmail(req.body) });
  })
);

router.post(
  '/resend-verification',
  validate({ body: schemas.emailOnly }, async (req, res) => {
    res.json({ data: await service.resendVerification(req.body) });
  })
);

router.post(
  '/login',
  validate({ body: schemas.login }, async (req, res) => {
    res.json({ data: await service.login(req.body) });
  })
);

router.post(
  '/forgot-password',
  validate({ body: schemas.emailOnly }, async (req, res) => {
    assertNotDemoAccount(req.body.email);
    res.json({ data: await service.forgotPassword(req.body) });
  })
);

router.post(
  '/reset-password',
  validate({ body: schemas.resetPassword }, async (req, res) => {
    res.json({ data: await service.resetPassword(req.body) });
  })
);

export default router;
