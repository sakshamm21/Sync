import { Router } from 'express';
import { authenticate, currentUser } from '../../middleware/auth';
import { assistantLimiter } from '../../middleware/rateLimit';
import validate from '../../middleware/validate';
import { z } from '../../lib/schemas';
import * as service from './assistant.service';

const router = Router();
router.use(authenticate, assistantLimiter);

/** IANA time zones only ("Asia/Kolkata"); anything else falls back to UTC. */
const timeZone = z
  .string()
  .max(64)
  .optional()
  .transform((value) => {
    if (!value) return 'UTC';
    try {
      new Intl.DateTimeFormat('en', { timeZone: value });
      return value;
    } catch {
      return 'UTC';
    }
  });

const chatBody = z.object({
  // The recent conversation, oldest first, ending with the user's new question.
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().trim().min(1, 'Message cannot be empty').max(2000, 'Message is too long'),
      })
    )
    .min(1, 'Ask a question')
    .max(20, 'Conversation is too long. Start a new one.')
    .refine((messages) => messages.at(-1)?.role === 'user', 'The last message must be from the user'),
  timeZone,
});

router.post(
  '/chat',
  validate({ body: chatBody }, async (req, res) => {
    res.json({ data: await service.chat(currentUser(req), req.body) });
  })
);

export default router;
