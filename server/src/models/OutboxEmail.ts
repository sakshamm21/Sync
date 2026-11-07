import { Schema, model, type HydratedDocument, type Types } from 'mongoose';

export interface IOutboxEmail {
  /** Set when a drainer claims the row, so two drains never send the same mail. */
  claimedAt: Date | null;
  attempts: number;
  /** Set once delivered. */
  sentAt: Date | null;
  /** Not before this time: failed sends back off (1 min, 5 min, 30 min, 2 h). */
  nextAttemptAt: Date | null;
  /** Set when the email is abandoned: a permanent rejection, or out of attempts. */
  failedAt: Date | null;
  lastError: string | null;
  to: string;
  subject: string;
  html: string;
  text?: string;
  createdAt: Date;
  updatedAt: Date;
}

export type OutboxEmailDocument = HydratedDocument<IOutboxEmail>;

/**
 * Emails waiting to go out. Work is recorded here first and sent afterwards,
 * so a slow mail provider can never make a student's "RSVP" tap hang, and a
 * crash mid-send loses nothing: the next drain picks the row back up.
 */
const outboxEmailSchema = new Schema<IOutboxEmail>(
  {
    claimedAt: { type: Date, default: null, index: true },
    attempts: { type: Number, default: 0 },
    sentAt: { type: Date, default: null },
    nextAttemptAt: { type: Date, default: null },
    failedAt: { type: Date, default: null },
    lastError: { type: String, default: null },
    to: { type: String, required: true, index: true },
    subject: { type: String, required: true, maxlength: 300 },
    html: { type: String, required: true },
    text: { type: String },
  },
  { timestamps: true }
);

// The drainer only ever looks at unsent, unclaimed rows.
outboxEmailSchema.index({ sentAt: 1, failedAt: 1, createdAt: 1 });

export const OutboxEmail = model<IOutboxEmail>('OutboxEmail', outboxEmailSchema);