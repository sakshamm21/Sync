import { Schema, model, type HydratedDocument, type Types } from 'mongoose';

export interface IAuditLog {
  /** The admin who acted (null once their account is deleted). */
  actor: Types.ObjectId | null;
  /** What happened, e.g. "user.suspended", "application.approved", "event.taken_down". */
  action: string;
  /** A readable one-liner shown in the admin console. */
  summary: string;
  /** What it was done to. */
  target: { kind: 'user' | 'event' | 'application' | 'report'; id: Types.ObjectId };
  createdAt: Date;
}

export type AuditLogDocument = HydratedDocument<IAuditLog>;

/** Every admin action, so moderation decisions can be looked back on (Roadmap "Next" #9). */
const auditLogSchema = new Schema<IAuditLog>(
  {
    actor: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    action: { type: String, required: true, maxlength: 60 },
    summary: { type: String, required: true, maxlength: 500 },
    target: {
      kind: { type: String, enum: ['user', 'event', 'application', 'report'], required: true },
      id: { type: Schema.Types.ObjectId, required: true },
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

auditLogSchema.index({ createdAt: -1 });

export const AuditLog = model<IAuditLog>('AuditLog', auditLogSchema);
