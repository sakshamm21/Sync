import { Schema, model, type HydratedDocument, type Types } from 'mongoose';
import { REPORT_REASONS, REPORT_STATUS, type ReportReason, type ReportStatus } from '../constants';

export interface IReport {
  event: Types.ObjectId;
  reporter: Types.ObjectId;
  reason: ReportReason;
  details: string;
  status: ReportStatus;
  reviewedBy: Types.ObjectId | null;
  reviewedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type ReportDocument = HydratedDocument<IReport>;

/** A member flagging an event for an admin to look at. */
const reportSchema = new Schema<IReport>(
  {
    event: { type: Schema.Types.ObjectId, ref: 'Event', required: true, index: true },
    reporter: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    reason: { type: String, enum: Object.values(REPORT_REASONS), required: true },
    details: { type: String, trim: true, maxlength: 1000, default: '' },
    status: { type: String, enum: Object.values(REPORT_STATUS), default: REPORT_STATUS.OPEN, index: true },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// One report per person per event; an admin re-submitting updates the old one.
reportSchema.index({ event: 1, reporter: 1 }, { unique: true });

export const Report = model<IReport>('Report', reportSchema);
