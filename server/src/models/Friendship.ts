import { Schema, model, type HydratedDocument, type Types } from 'mongoose';

export interface IFriendship {
  /** Who asked. */
  from: Types.ObjectId;
  /** Who was asked. */
  to: Types.ObjectId;
  status: 'pending' | 'accepted';
  createdAt: Date;
  updatedAt: Date;
}

export type FriendshipDocument = HydratedDocument<IFriendship>;

/**
 * Opt-in friends (Roadmap "Next" #7). Both people must agree; only then do
 * they see which events the other is going to.
 */
const friendshipSchema = new Schema<IFriendship>(
  {
    from: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    to: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    status: { type: String, enum: ['pending', 'accepted'], default: 'pending' },
  },
  { timestamps: true }
);

friendshipSchema.index({ from: 1, to: 1 }, { unique: true });

export const Friendship = model<IFriendship>('Friendship', friendshipSchema);
