import { Schema, model, type HydratedDocument, type Types } from 'mongoose';

export interface IPushSubscription {
  user: Types.ObjectId;
  /** The browser's push endpoint; unique per device and browser. */
  endpoint: string;
  keys: { p256dh: string; auth: string };
  createdAt: Date;
  updatedAt: Date;
}

export type PushSubscriptionDocument = HydratedDocument<IPushSubscription>;

/** One row per device that allowed notifications. Removed when the push service says it's gone. */
const pushSubscriptionSchema = new Schema<IPushSubscription>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    endpoint: { type: String, required: true, unique: true, maxlength: 1000 },
    keys: {
      p256dh: { type: String, required: true, maxlength: 200 },
      auth: { type: String, required: true, maxlength: 100 },
    },
  },
  { timestamps: true }
);

export const PushSubscription = model<IPushSubscription>('PushSubscription', pushSubscriptionSchema);
