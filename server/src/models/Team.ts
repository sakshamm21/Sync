import { Schema, model, type HydratedDocument, type Types } from 'mongoose';

export interface ITeam {
  event: Types.ObjectId;
  name: string;
  /** Six characters the captain shares so teammates can join. */
  code: string;
  captain: Types.ObjectId;
  members: Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

export type TeamDocument = HydratedDocument<ITeam>;

/** A team at a team event, such as a hackathon or quiz (Roadmap "Next" #2). */
const teamSchema = new Schema<ITeam>(
  {
    event: { type: Schema.Types.ObjectId, ref: 'Event', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    code: { type: String, required: true },
    captain: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    members: { type: [{ type: Schema.Types.ObjectId, ref: 'User' }], default: [] },
  },
  { timestamps: true }
);

teamSchema.index({ event: 1, code: 1 }, { unique: true });
teamSchema.index({ event: 1, name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });
teamSchema.index({ event: 1, members: 1 });

export const Team = model<ITeam>('Team', teamSchema);
