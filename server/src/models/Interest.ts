import { Schema, model, type HydratedDocument, type Types } from 'mongoose';

export interface IInterest {
  event: Types.ObjectId;
  user: Types.ObjectId;
  /** Set once the gentle "starts tomorrow" nudge has gone out. */
  reminderSentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type InterestDocument = HydratedDocument<IInterest>;

/**
 * "Interested": a bookmark, separate from an RSVP. It takes no seat, gets a
 * gentle in-app reminder, and its count is social proof for organisers.
 */
const interestSchema = new Schema<IInterest>(
  {
    event: { type: Schema.Types.ObjectId, ref: 'Event', required: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    reminderSentAt: { type: Date, default: null },
  },
  { timestamps: true }
);

interestSchema.index({ event: 1, user: 1 }, { unique: true });

export const Interest = model<IInterest>('Interest', interestSchema);
