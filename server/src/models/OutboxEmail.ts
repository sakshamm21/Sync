import { Schema, model, type HydratedDocument, type Types } from 'mongoose';

export interface IOutboxEmail {
  /** Set when a drainer claims the row, so two drains never send the same mail. */
  claimedAt: Date | null;
  attempts: number;
  /** Null once sent or permanently abandoned. */
  sentAt: Date | null;
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
    to: { type: String, required: true, index: true },
    subject: { type: String, required: true, maxlength: 300 },
    html: { type: String, required: true },
    text: { type: String },
  },
  { timestamps: true }
);

// The drainer only ever looks at unsent, unclaimed rows.
outboxEmailSchema.index({ sentAt: 1, claimedAt: 1, createdAt: 1 });

export const OutboxEmail = model<IOutboxEmail>('OutboxEmail', outboxEmailSchema);