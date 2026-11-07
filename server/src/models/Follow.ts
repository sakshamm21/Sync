import { Schema, model, type HydratedDocument, type Types } from 'mongoose';

export interface IFollow {
  /** The follower. */
  user: Types.ObjectId;
  /** The club (an organiser account) being followed. */
  club: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export type FollowDocument = HydratedDocument<IFollow>;

/** "Follow" a club: its new events show up as notifications. */
const followSchema = new Schema<IFollow>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    club: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  },
  { timestamps: true }
);

followSchema.index({ user: 1, club: 1 }, { unique: true });

export const Follow = model<IFollow>('Follow', followSchema);
