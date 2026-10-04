import { Schema, model, type HydratedDocument, type Types } from 'mongoose';
import { STAFF_ROLES, type StaffRole } from '../constants';

export interface IEventStaff {
  event: Types.ObjectId;
  user: Types.ObjectId;
  role: StaffRole;
  invitedBy: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

export type EventStaffDocument = HydratedDocument<IEventStaff>;

/**
 * Someone a user invited to help run an event. The creator of the event is
 * also stored here as `owner`, so "who can manage this" is one lookup.
 */
const eventStaffSchema = new Schema<IEventStaff>(
  {
    event: { type: Schema.Types.ObjectId, ref: 'Event', required: true, index: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    role: { type: String, enum: Object.values(STAFF_ROLES), required: true },
    invitedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

// One person holds one role per event.
eventStaffSchema.index({ event: 1, user: 1 }, { unique: true });

export const EventStaff = model<IEventStaff>('EventStaff', eventStaffSchema);