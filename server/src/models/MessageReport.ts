import { Schema, model, type HydratedDocument, type Types } from 'mongoose';
import { REPORT_REASONS, REPORT_STATUS, type ReportReason, type ReportStatus } from '../constants';

export interface IMessageReport {
  message: Types.ObjectId;
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

export type MessageReportDocument = HydratedDocument<IMessageReport>;

/** A member flagging a chat message for an admin (Roadmap "Next" #6). */
const messageReportSchema = new Schema<IMessageReport>(
  {
    message: { type: Schema.Types.ObjectId, ref: 'Message', required: true },
    event: { type: Schema.Types.ObjectId, ref: 'Event', required: true },
    reporter: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    reason: { type: String, enum: Object.values(REPORT_REASONS), required: true },
    details: { type: String, trim: true, maxlength: 1000, default: '' },
    status: { type: String, enum: Object.values(REPORT_STATUS), default: REPORT_STATUS.OPEN, index: true },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

messageReportSchema.index({ message: 1, reporter: 1 }, { unique: true });

export const MessageReport = model<IMessageReport>('MessageReport', messageReportSchema);
