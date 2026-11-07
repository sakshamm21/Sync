/** Union of an `as const` object's values, e.g. ValueOf<typeof ROLES> = 'member' | 'organizer' | 'admin'. */
export type ValueOf<T> = T[keyof T];

export const ROLES = Object.freeze({
  MEMBER: 'member',
  ORGANIZER: 'organizer',
  ADMIN: 'admin',
} as const);
export type Role = ValueOf<typeof ROLES>;

export const USER_STATUS = Object.freeze({
  ACTIVE: 'active',
  SUSPENDED: 'suspended',
} as const);
export type UserStatus = ValueOf<typeof USER_STATUS>;

// Display labels live in the web app (client/src/lib/format.ts).
export const CATEGORY_VALUES = Object.freeze([
  'tech',
  'workshop',
  'cultural',
  'sports',
  'meetup',
  'conference',
  'social',
  'other',
] as const);
export type Category = (typeof CATEGORY_VALUES)[number];

export const EVENT_VISIBILITY = Object.freeze({
  PUBLIC: 'public', // listed in discovery, open for registration
  PRIVATE: 'private', // personal calendar entry, visible to the owner only
} as const);
export type EventVisibility = ValueOf<typeof EVENT_VISIBILITY>;

export const EVENT_STATUS = Object.freeze({
  DRAFT: 'draft',
  PUBLISHED: 'published',
  CANCELLED: 'cancelled',
} as const);
export type EventStatus = ValueOf<typeof EVENT_STATUS>;

export const REGISTRATION_STATUS = Object.freeze({
  GOING: 'going',
  WAITLISTED: 'waitlisted',
  /** Offered a freed seat that must be claimed before `offerExpiresAt` (events with a claim window). */
  OFFERED: 'offered',
  /** Asked to join an event that needs the organiser's approval; holds no seat yet. */
  PENDING: 'pending',
} as const);
export type RegistrationStatus = ValueOf<typeof REGISTRATION_STATUS>;

/**
 * What a co-organiser may do with an event. `owner` is the primary contact
 * who created it; `manager` can do everything; `checkin` can only work the door.
 */
export const STAFF_ROLES = Object.freeze({
  OWNER: 'owner',
  MANAGER: 'manager',
  CHECKIN: 'checkin',
} as const);
export type StaffRole = ValueOf<typeof STAFF_ROLES>;

export const NOTE_TAGS = Object.freeze(['plan', 'speaker', 'logistics', 'ideas', 'personal'] as const);
export type NoteTag = (typeof NOTE_TAGS)[number];

export const ORGANIZER_APPLICATION_STATUS = Object.freeze({
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
} as const);
export type OrganizerApplicationStatus = ValueOf<typeof ORGANIZER_APPLICATION_STATUS>;

export const NOTIFICATION_TYPES = Object.freeze({
  EVENT_UPDATED: 'event_updated',
  EVENT_CANCELLED: 'event_cancelled',
  EVENT_REMINDER: 'event_reminder',
  WAITLIST_PROMOTED: 'waitlist_promoted',
  ANNOUNCEMENT: 'announcement',
  ORGANIZER_APPROVED: 'organizer_approved',
  ORGANIZER_REJECTED: 'organizer_rejected',
  STAFF_INVITED: 'staff_invited',
  /** A club you follow published a new event. */
  CLUB_NEW_EVENT: 'club_new_event',
  /** A spot opened up and is being held for you to claim. */
  WAITLIST_OFFER: 'waitlist_offer',
  /** The organiser approved or declined your request to join. */
  REGISTRATION_DECISION: 'registration_decision',
} as const);
export type NotificationType = ValueOf<typeof NOTIFICATION_TYPES>;

/** Why someone reported an event. Drives what the admin reviews first. */
export const REPORT_REASONS = Object.freeze({
  MISLEADING: 'misleading',
  INAPPROPRIATE: 'inappropriate',
  SPAM: 'spam',
  DUPLICATE: 'duplicate',
  OTHER: 'other',
} as const);
export type ReportReason = ValueOf<typeof REPORT_REASONS>;

export const REPORT_STATUS = Object.freeze({
  OPEN: 'open',
  REVIEWED: 'reviewed',
  DISMISSED: 'dismissed',
} as const);
export type ReportStatus = ValueOf<typeof REPORT_STATUS>;

/** The 1-5 star rating a checked-in attendee leaves after an event. */
export const MAX_RATING = 5;
