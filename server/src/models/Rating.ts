import { Schema, model, type HydratedDocument, type Types } from 'mongoose';
import { MAX_RATING } from '../constants';

export interface IRating {
  event: Types.ObjectId;
  user: Types.ObjectId;
  rating: number;
  createdAt: Date;
  updatedAt: Date;
}

export type RatingDocument = HydratedDocument<IRating>;

/**
 * A 1-5 star score an attendee leaves after an event. `Event.ratingSum` and
 * `Event.ratingCount` are maintained alongside it so recommendations can
 * sort by quality without an aggregation on every request.
 */
const ratingSchema = new Schema<IRating>(
  {
    event: { type: Schema.Types.ObjectId, ref: 'Event', required: true, index: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    rating: { type: Number, required: true, min: 1, max: MAX_RATING },
  },
  { timestamps: true }
);

// One rating per person per event; changing it overwrites the previous score.
ratingSchema.index({ event: 1, user: 1 }, { unique: true });

export const Rating = model<IRating>('Rating', ratingSchema);