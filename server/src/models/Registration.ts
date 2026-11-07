import { Schema, model, type HydratedDocument, type Types } from 'mongoose';
import { REGISTRATION_STATUS, type RegistrationStatus } from '../constants';

export interface IRegistration {
  event: Types.ObjectId;
  user: Types.ObjectId;
  status: RegistrationStatus;
  checkedInAt: Date | null;
  reminderSentAt: Date | null;
  /** For `offered`: the seat goes to the next person after this. */
  offerExpiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type RegistrationDocument = HydratedDocument<IRegistration>;

const registrationSchema = new Schema<IRegistration>(
  {
    event: { type: Schema.Types.ObjectId, ref: 'Event', required: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    status: { type: String, enum: Object.values(REGISTRATION_STATUS), required: true },
    checkedInAt: { type: Date, default: null },
    reminderSentAt: { type: Date, default: null },
    offerExpiresAt: { type: Date, default: null },
  },
  { timestamps: true }
);

registrationSchema.index({ event: 1, user: 1 }, { unique: true });
// Waitlist is served first-come, first-served.
registrationSchema.index({ event: 1, status: 1, createdAt: 1 });
registrationSchema.index({ user: 1, status: 1 });
registrationSchema.index({ status: 1, offerExpiresAt: 1 }); // expiring offers // "my tickets", clash checks

export const Registration = model<IRegistration>('Registration', registrationSchema);
