import { Schema, model, type HydratedDocument, type Types } from 'mongoose';

export type ClubRole = 'core' | 'volunteer';

export interface IClubMember {
  /** The club: an organiser account. */
  club: Types.ObjectId;
  user: Types.ObjectId;
  /** Core team co-organise every club event; volunteers work the door. */
  role: ClubRole;
  createdAt: Date;
  updatedAt: Date;
}

export type ClubMemberDocument = HydratedDocument<IClubMember>;

/**
 * A club's committee (Roadmap "Next" #10). Membership is mirrored onto each
 * of the club's events as an ordinary team row, so every existing permission
 * check keeps working unchanged.
 */
const clubMemberSchema = new Schema<IClubMember>(
  {
    club: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    role: { type: String, enum: ['core', 'volunteer'], required: true },
  },
  { timestamps: true }
);

clubMemberSchema.index({ club: 1, user: 1 }, { unique: true });

export const ClubMember = model<IClubMember>('ClubMember', clubMemberSchema);
