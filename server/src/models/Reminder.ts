import { Schema, model, type HydratedDocument, type Types } from 'mongoose';

export interface IReminder {
  user: Types.ObjectId;
  event: Types.ObjectId;
  /** When to nudge: the event start minus the chosen lead time. */
  remindAt: Date;
  minutesBefore: number;
  sentAt: Date | null;
}

export type ReminderDocument = HydratedDocument<IReminder>;

/** "Remind me an hour before" (Roadmap "Next" #11): one per person per event. */
const reminderSchema = new Schema<IReminder>({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  event: { type: Schema.Types.ObjectId, ref: 'Event', required: true },
  remindAt: { type: Date, required: true },
  minutesBefore: { type: Number, required: true },
  sentAt: { type: Date, default: null },
});

reminderSchema.index({ user: 1, event: 1 }, { unique: true });
reminderSchema.index({ sentAt: 1, remindAt: 1 });

export const Reminder = model<IReminder>('Reminder', reminderSchema);
