import { Schema, model, type HydratedDocument, type Model, type Types } from 'mongoose';
import {
  CATEGORY_VALUES,
  EVENT_VISIBILITY,
  EVENT_STATUS,
  type Category,
  type EventStatus,
  type EventVisibility,
} from '../constants';

export interface Venue {
  name?: string;
  address?: string;
  // Optional coordinates for map pins and directions.
  latitude?: number;
  longitude?: number;
}

export interface EventQuestion {
  _id: Types.ObjectId;
  label: string;
  kind: 'text' | 'choice';
  options: string[];
  required: boolean;
}

export interface IEvent {
  title: string;
  description: string;
  category: Category;
  tags: string[];
  coverImageUrl: string;
  startsAt: Date;
  endsAt: Date;
  venue: Venue;
  onlineUrl: string;
  visibility: EventVisibility;
  status: EventStatus;
  /** The primary contact: who created it, and who to ask. */
  owner: Types.ObjectId;
  /** Everyone who can help run it. Always contains `owner`. */
  organizers: Types.ObjectId[];
  // Registration (public events only). `capacity: null` means unlimited.
  capacity: number | null;
  /** Optional sign-up window. Waitlist promotion still runs outside it. */
  registrationOpensAt: Date | null;
  registrationClosesAt: Date | null;
  /** Hours a freed seat is held for the next person to claim; null = move them in automatically. */
  waitlistClaimHours: number | null;
  /** Extra questions asked when someone RSVPs (roll number, T-shirt size, ...). */
  questions: EventQuestion[];
  /** Each RSVP waits for the organiser to approve it. */
  requiresApproval: boolean;
  attendeeCount: number;
  /** People who bookmarked it as "Interested" (a cache of Interest rows). */
  interestedCount: number;
  /** Sum and number of post-event ratings, kept in step with the Rating collection. */
  ratingSum: number;
  ratingCount: number;
  createdAt: Date;
  updatedAt: Date;
}

interface EventMethods {
  isOwnedBy(userId: unknown): boolean;
  /** True for the creator and for anyone invited to help run the event. */
  isCoOrganizer(userId: unknown): boolean;
  isOpenForRegistration(): boolean;
  /** Why a new RSVP can't be taken right now, or null if it can. */
  registrationWindowProblem(now?: Date): { code: 'REGISTRATION_NOT_OPEN' | 'REGISTRATION_CLOSED'; at: Date } | null;
}

interface EventVirtuals {
  spotsLeft: number | null;
  isPast: boolean;
  /** Average rating out of 5, or null when nobody has rated it. */
  averageRating: number | null;
}

type EventModel = Model<IEvent, {}, EventMethods, EventVirtuals>;
export type EventDocument = HydratedDocument<IEvent, EventMethods & EventVirtuals>;

const venueSchema = new Schema<Venue>(
  {
    name: { type: String, trim: true, maxlength: 160 },
    address: { type: String, trim: true, maxlength: 300 },
    latitude: { type: Number, min: -90, max: 90 },
    longitude: { type: Number, min: -180, max: 180 },
  },
  { _id: false }
);

const eventSchema = new Schema<IEvent, EventModel, EventMethods, {}, EventVirtuals>(
  {
    title: { type: String, required: true, trim: true, maxlength: 140 },
    description: { type: String, trim: true, maxlength: 5000, default: '' },
    category: { type: String, enum: CATEGORY_VALUES, default: 'other' },
    tags: [{ type: String, trim: true, lowercase: true, maxlength: 30 }],
    coverImageUrl: { type: String, trim: true, default: '' },

    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    venue: { type: venueSchema, default: () => ({}) },
    onlineUrl: { type: String, trim: true, default: '' },

    visibility: { type: String, enum: Object.values(EVENT_VISIBILITY), required: true },
    status: { type: String, enum: Object.values(EVENT_STATUS), default: EVENT_STATUS.PUBLISHED },
    owner: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    organizers: [{ type: Schema.Types.ObjectId, ref: 'User', index: true }],

    capacity: { type: Number, min: 1, default: null },
    registrationOpensAt: { type: Date, default: null },
    registrationClosesAt: { type: Date, default: null },
    waitlistClaimHours: { type: Number, min: 1, max: 72, default: null },
    questions: {
      type: [
        new Schema(
          {
            label: { type: String, required: true, trim: true, maxlength: 200 },
            kind: { type: String, enum: ['text', 'choice'], default: 'text' },
            options: { type: [{ type: String, trim: true, maxlength: 80 }], default: [] },
            required: { type: Boolean, default: false },
          },
          { _id: true }
        ),
      ],
      default: [],
    },
    requiresApproval: { type: Boolean, default: false },
    attendeeCount: { type: Number, min: 0, default: 0 },
    interestedCount: { type: Number, min: 0, default: 0 },
    ratingSum: { type: Number, min: 0, default: 0 },
    ratingCount: { type: Number, min: 0, default: 0 },
  },
  { timestamps: true }
);

eventSchema.index({ visibility: 1, status: 1, startsAt: 1 });
// Drives the organiser console and "events I help run".
eventSchema.index({ organizers: 1, startsAt: -1 });
eventSchema.index({ owner: 1, endsAt: 1 }); // organiser track records for recommendations

eventSchema.virtual('spotsLeft').get(function spotsLeft() {
  if (this.capacity == null) return null;
  return Math.max(this.capacity - this.attendeeCount, 0);
});

eventSchema.virtual('isPast').get(function isPast() {
  return this.endsAt < new Date();
});

eventSchema.virtual('averageRating').get(function averageRating() {
  return this.ratingCount > 0 ? Math.round((this.ratingSum / this.ratingCount) * 10) / 10 : null;
});

eventSchema.method('isOwnedBy', function isOwnedBy(userId: unknown) {
  // `owner` is an ObjectId, or a user document once populated.
  const owner = this.owner as Types.ObjectId | { _id: Types.ObjectId };
  const ownerId = '_id' in owner ? owner._id : owner;
  return String(ownerId) === String(userId);
});

/** True for anyone in `organizers`, which always contains the owner. */
eventSchema.method('isCoOrganizer', function isCoOrganizer(userId: unknown) {
  if (!userId) return false;
  // Events created before shared ownership existed have no `organizers`
  // array at all; their creator is still the only organiser.
  if (!Array.isArray(this.organizers) || this.organizers.length === 0) return this.isOwnedBy(userId);
  return this.organizers.some((id) => String(id) === String(userId));
});

eventSchema.method('isOpenForRegistration', function isOpenForRegistration() {
  return this.visibility === EVENT_VISIBILITY.PUBLIC && this.status === EVENT_STATUS.PUBLISHED && this.endsAt > new Date();
});

eventSchema.method('registrationWindowProblem', function registrationWindowProblem(now = new Date()) {
  if (this.registrationOpensAt && now < this.registrationOpensAt)
    return { code: 'REGISTRATION_NOT_OPEN', at: this.registrationOpensAt };
  if (this.registrationClosesAt && now >= this.registrationClosesAt)
    return { code: 'REGISTRATION_CLOSED', at: this.registrationClosesAt };
  return null;
});

export const Event = model<IEvent, EventModel>('Event', eventSchema);
