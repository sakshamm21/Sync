import { Schema, model, type HydratedDocument, type Types } from 'mongoose';

export interface IChatRead {
  user: Types.ObjectId;
  event: Types.ObjectId;
  /** Messages after this are unread for the user. */
  readAt: Date;
}

export type ChatReadDocument = HydratedDocument<IChatRead>;

/** Where each person is up to in each event chat, for unread badges. */
const chatReadSchema = new Schema<IChatRead>({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  event: { type: Schema.Types.ObjectId, ref: 'Event', required: true },
  readAt: { type: Date, required: true },
});

chatReadSchema.index({ user: 1, event: 1 }, { unique: true });

export const ChatRead = model<IChatRead>('ChatRead', chatReadSchema);
