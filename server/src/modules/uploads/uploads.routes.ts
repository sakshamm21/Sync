/**
 * Photo uploads (Roadmap "Now" #10). The browser uploads straight to Vercel
 * Blob; this route only hands out a short-lived token after checking who is
 * asking and what they may upload. Off unless BLOB_READ_WRITE_TOKEN is set.
 */
import { Router } from 'express';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import env from '../../config/env';
import { authenticate, currentUser } from '../../middleware/auth';
import { badRequest, notFound } from '../../lib/errors';

const router = Router();

/** What can be uploaded where. Covers are cropped to 1200×630 in the browser first. */
const FOLDERS: Record<string, { maxBytes: number }> = {
  covers: { maxBytes: 5 * 1024 * 1024 },
  avatars: { maxBytes: 2 * 1024 * 1024 },
};

router.post('/', authenticate, async (req, res) => {
  if (!env.uploads.enabled) throw notFound('Photo uploads are not set up on this server', 'UPLOADS_DISABLED');
  const user = currentUser(req);
  const body = req.body as HandleUploadBody;
  const result = await handleUpload({
    token: env.uploads.token,
    request: req,
    body,
    onBeforeGenerateToken: async (pathname) => {
      const folder = pathname.split('/')[0];
      const rules = FOLDERS[folder];
      if (!rules || pathname.includes('..')) throw badRequest('Uploads go to covers/ or avatars/', 'BAD_UPLOAD_PATH');
      return {
        allowedContentTypes: ['image/jpeg', 'image/png', 'image/webp'],
        maximumSizeInBytes: rules.maxBytes,
        addRandomSuffix: true,
        tokenPayload: JSON.stringify({ user: user.id }),
      };
    },
  });
  res.json(result);
});

export default router;
