/**
 * Club operations (Roadmap "Later" #6): volunteer shifts, sponsors and an
 * event budget. Small models kept together because they are only ever used
 * by the organiser tools.
 */
import { Schema, model, type HydratedDocument, type Types } from 'mongoose';

export interface IShift {
  event: Types.ObjectId;
  title: string;
  startsAt: Date;
  endsAt: Date;
  /** How many people the shift needs. */
  slots: number;
  volunteers: Types.ObjectId[];
}
export type ShiftDocument = HydratedDocument<IShift>;
const shiftSchema = new Schema<IShift>(
  {
    event: { type: Schema.Types.ObjectId, ref: 'Event', required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 80 },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    slots: { type: Number, required: true, min: 1, max: 100 },
    volunteers: { type: [{ type: Schema.Types.ObjectId, ref: 'User' }], default: [] },
  },
  { timestamps: true }
);
export const Shift = model<IShift>('Shift', shiftSchema);

export interface ISponsor {
  /** The club (organiser account) the sponsor supports. */
  club: Types.ObjectId;
  name: string;
  url: string;
  logoUrl: string;
  tier: 'title' | 'gold' | 'partner';
}
export type SponsorDocument = HydratedDocument<ISponsor>;
const sponsorSchema = new Schema<ISponsor>(
  {
    club: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    url: { type: String, trim: true, default: '' },
    logoUrl: { type: String, trim: true, default: '' },
    tier: { type: String, enum: ['title', 'gold', 'partner'], default: 'partner' },
  },
  { timestamps: true }
);
export const Sponsor = model<ISponsor>('Sponsor', sponsorSchema);

export interface IBudgetLine {
  event: Types.ObjectId;
  label: string;
  /** In whole rupees; positive. `kind` says which way it goes. */
  amount: number;
  kind: 'income' | 'expense';
  addedBy: Types.ObjectId;
}
export type BudgetLineDocument = HydratedDocument<IBudgetLine>;
const budgetLineSchema = new Schema<IBudgetLine>(
  {
    event: { type: Schema.Types.ObjectId, ref: 'Event', required: true, index: true },
    label: { type: String, required: true, trim: true, maxlength: 120 },
    amount: { type: Number, required: true, min: 0, max: 100_000_000 },
    kind: { type: String, enum: ['income', 'expense'], required: true },
    addedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);
export const BudgetLine = model<IBudgetLine>('BudgetLine', budgetLineSchema);
