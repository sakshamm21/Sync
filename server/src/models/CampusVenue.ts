import { Schema, model, type HydratedDocument } from 'mongoose';

export interface ICampusVenue {
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  /** Most people the room holds; organisers are warned if an event asks for more. */
  capacity: number | null;
  /** Step-free access, lifts, hearing loops, ... */
  accessibility: string;
  createdAt: Date;
  updatedAt: Date;
}

export type CampusVenueDocument = HydratedDocument<ICampusVenue>;

/** The campus's rooms, kept by admins (Roadmap "Next" #8). */
const venueSchema = new Schema<ICampusVenue>(
  {
    name: { type: String, required: true, trim: true, maxlength: 160 },
    address: { type: String, trim: true, maxlength: 300, default: '' },
    latitude: { type: Number, required: true, min: -90, max: 90 },
    longitude: { type: Number, required: true, min: -180, max: 180 },
    capacity: { type: Number, min: 1, default: null },
    accessibility: { type: String, trim: true, maxlength: 500, default: '' },
  },
  { timestamps: true }
);

venueSchema.index({ name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });

export const CampusVenue = model<ICampusVenue>('CampusVenue', venueSchema);
