import { Schema, model, type HydratedDocument, type Types } from 'mongoose';

export interface IMessage {
  event: Types.ObjectId;
  sender: Types.ObjectId;
  text: string;
  // Announcements are organiser broadcasts; attendees are also notified.
  isAnnouncement: boolean;
  /** Set when an organiser, the sender or an admin removed it; the text is cleared. */
  removedAt: Date | null;
  /** The message this one answers, if any. */
  replyTo: Types.ObjectId | null;
  /** Emoji reactions: who reacted with what. */
  reactions: { emoji: string; user: Types.ObjectId }[];
  /** Pinned by an organiser to the top of the chat. */
  pinnedAt: Date | null;
  /** People @mentioned in the text, who get a notification. */
  mentions: Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

export type MessageDocument = HydratedDocument<IMessage>;

/** A chat message in an event's discussion channel. */
const messageSchema = new Schema<IMessage>(
  {
    event: { type: Schema.Types.ObjectId, ref: 'Event', required: true },
    sender: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    // Not required: a removed message keeps its place in the thread with no text.
    text: { type: String, trim: true, maxlength: 2000, default: '' },
    isAnnouncement: { type: Boolean, default: false },
    removedAt: { type: Date, default: null },
    replyTo: { type: Schema.Types.ObjectId, ref: 'Message', default: null },
    reactions: { type: [{ emoji: String, user: { type: Schema.Types.ObjectId, ref: 'User' } }], default: [], _id: false },
    pinnedAt: { type: Date, default: null },
    mentions: { type: [{ type: Schema.Types.ObjectId, ref: 'User' }], default: [] },
  },
  { timestamps: true }
);

messageSchema.index({ event: 1, createdAt: -1 });

export const Message = model<IMessage>('Message', messageSchema);
