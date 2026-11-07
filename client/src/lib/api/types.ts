// Shapes returned by the Sync API. Dates arrive as ISO strings.

export type Role = 'member' | 'organizer' | 'admin';
export type UserStatus = 'active' | 'suspended';

export type CategoryValue = 'tech' | 'workshop' | 'cultural' | 'sports' | 'meetup' | 'conference' | 'social' | 'other';

export interface Category {
  value: CategoryValue;
  label: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: UserStatus;
  emailVerified: boolean;
  bio: string;
  avatarUrl: string;
  organization: string;
  interests: CategoryValue[];
  /** `mutedEmailTypes`: kinds of notification kept in the app and never emailed. */
  preferences: { emailNotifications: boolean; mutedEmailTypes?: NotificationType[]; autoAcceptWaitlist?: boolean };
  lastLoginAt?: string;
  /** On the team of an event someone else owns (only on the signed-in user). */
  isEventStaff?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UserSummary {
  id: string;
  name: string;
  avatarUrl: string;
  organization: string;
  role: Role;
}

export interface Session {
  token: string;
  user: User;
}

/** `offered`: a freed seat is being held for you to claim before `viewer.offerExpiresAt`. */
export type RegistrationStatus = 'going' | 'waitlisted' | 'offered' | 'pending';
export type EventVisibility = 'public' | 'private';
export type EventStatus = 'draft' | 'published' | 'cancelled';
/** What a person is allowed to do with an event. */
export type StaffRole = 'owner' | 'manager' | 'checkin';

export interface Venue {
  name?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
}

/** A search result from the place lookup (OpenStreetMap). */
export interface Place {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
}

/** A venue in use by upcoming public events. */
export interface VenueSummary {
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  events: { id: string; title: string; category: CategoryValue; startsAt: string; endsAt: string }[];
}

export interface EventViewer {
  isOwner: boolean;
  /** True for the creator and for anyone invited to help run the event. */
  isOrganizer: boolean;
  canManage: boolean;
  /** Door rights: organisers, managers and check-in staff. */
  canCheckIn: boolean;
  canChat: boolean;
  staffRole: StaffRole | null;
  registration: RegistrationStatus | null;
  /** 1 = next in line; only present on a single event you're waitlisted for. */
  waitlistPosition?: number;
  /** Bookmarked as "Interested". */
  interested?: boolean;
  /** Checked in at the door. */
  checkedIn?: boolean;
  /** For a held seat: claim it before this. */
  offerExpiresAt?: string | null;
}

export interface SyncEvent {
  id: string;
  title: string;
  description: string;
  category: CategoryValue;
  tags: string[];
  coverImageUrl: string;
  startsAt: string;
  endsAt: string;
  venue: Venue;
  onlineUrl: string;
  visibility: EventVisibility;
  status: EventStatus;
  owner: UserSummary;
  capacity: number | null;
  attendeeCount: number;
  /** Optional sign-up window. */
  registrationOpensAt?: string | null;
  registrationClosesAt?: string | null;
  /** Hours a freed seat is held for the next person; null = automatic. */
  waitlistClaimHours?: number | null;
  /** Asked when someone RSVPs. */
  questions?: EventQuestion[];
  /** RSVPs wait for the organiser's approval. */
  requiresApproval?: boolean;
  /** Shared by every date of a repeating event. */
  seriesId?: string | null;
  /** People who bookmarked it as "Interested". */
  interestedCount?: number;
  spotsLeft: number | null;
  isPast: boolean;
  averageRating: number | null;
  createdAt: string;
  updatedAt: string;
  viewer: EventViewer;
}

/** Confirmed events already on the user's calendar that overlap a new RSVP. */
export interface Clash {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
}

/** What RSVPing returns: the event, plus any clash the user should know about. */
export type RegistrationResponse = SyncEvent & { clashes: Clash[] };

export interface EventInput {
  title: string;
  description?: string;
  category?: CategoryValue;
  tags?: string[];
  coverImageUrl?: string;
  startsAt: string;
  endsAt: string;
  venue?: Venue;
  onlineUrl?: string;
  visibility?: EventVisibility;
  status?: 'draft' | 'published';
  capacity?: number | null;
  registrationOpensAt?: string | null;
  registrationClosesAt?: string | null;
  /** Hours a freed seat is held for the next person; null = automatic. */
  waitlistClaimHours?: number | null;
  /** Asked when someone RSVPs. */
  questions?: Omit<EventQuestion, 'id'>[];
  /** RSVPs wait for the organiser's approval. */
  requiresApproval?: boolean;
  /** Only when creating: make it a series. */
  repeat?: { every: 'week' | 'fortnight'; count: number };
}

export interface Attendee {
  id: string;
  status: RegistrationStatus;
  registeredAt: string;
  checkedInAt: string | null;
  /** Answers to the event's questions, labelled. */
  answers?: { question: string; answer: string }[];
  user: { id: string; name: string; email: string; avatarUrl: string } | null;
}

export interface AttendeeList {
  items: Attendee[];
  counts: { going: number; waitlisted: number; offered?: number; pending?: number; checkedIn: number };
}

/** Door staff's view of who is coming: names and check-ins, no email addresses. */
export interface DoorList {
  items: { id: string; checkedInAt: string | null; user: { id: string; name: string; avatarUrl: string } }[];
  counts: { going: number; checkedIn: number };
}

export type NoteTag = 'plan' | 'speaker' | 'logistics' | 'ideas' | 'personal';

export interface Note {
  id: string;
  title: string;
  content: string;
  tag: NoteTag;
  pinned: boolean;
  event: { id: string; title: string; startsAt: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  event: string;
  text: string;
  isAnnouncement: boolean;
  /** Set when the message was removed; `text` is then empty. */
  removedAt?: string | null;
  sender: { id: string; name: string; avatarUrl: string; role: Role };
  createdAt: string;
}

export type NotificationType =
  | 'event_updated'
  | 'event_cancelled'
  | 'event_reminder'
  | 'waitlist_promoted'
  | 'announcement'
  | 'organizer_approved'
  | 'organizer_rejected'
  | 'staff_invited'
  | 'club_new_event'
  | 'waitlist_offer'
  | 'registration_decision';

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  event: string | null;
  readAt: string | null;
  createdAt: string;
}

export type ApplicationStatus = 'pending' | 'approved' | 'rejected';

export interface OrganizerApplication {
  id: string;
  user: string | { id: string; name: string; email: string; avatarUrl: string; role: Role };
  organization: string;
  reason: string;
  status: ApplicationStatus;
  reviewedBy: { id: string; name: string } | null;
  reviewedAt: string | null;
  reviewNote: string;
  createdAt: string;
}

export interface OrganizedEvent extends SyncEvent {
  stats: { going: number; waitlisted: number; checkedIn: number };
}

export interface OrganizerOverview {
  stats: {
    totalEvents: number;
    upcomingEvents: number;
    drafts: number;
    totalRegistrations: number;
    waitlisted: number;
    attendanceRate: number | null;
  };
  events: OrganizedEvent[];
}

export interface PlatformStats {
  users: { total: number; byRole: Record<Role, number>; suspended: number };
  events: { total: number; upcoming: number };
  registrations: number;
  pendingApplications: number;
  openReports: number;
}

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface Page<T> {
  items: T[];
  meta: PageMeta;
}

/** Someone helping an event run, and what they may do. */
export interface StaffMember {
  id: string;
  role: StaffRole;
  user: { id: string; name: string; avatarUrl: string; organization: string } | null;
  invitedBy: string | null;
  createdAt: string;
}

/** The average score for an event, and the viewer's own if they left one. */
export interface EventRating {
  average: number | null;
  count: number;
  mine: number | null;
  /** The viewer's own written feedback. */
  myComment?: string;
  /** Star-by-star breakdown; index 0 is one star. */
  breakdown: number[];
}

export type ReportReason = 'misleading' | 'inappropriate' | 'spam' | 'duplicate' | 'other';
export type ReportStatus = 'open' | 'reviewed' | 'dismissed';

/** A member's report about an event, as an admin sees it. */
export interface EventReport {
  id: string;
  reason: ReportReason;
  details: string;
  status: ReportStatus;
  createdAt: string;
  reviewedAt: string | null;
  event: { id: string; title: string } | null;
  reporter: { name: string } | null;
}

/** The signed code an attendee shows at the door. */
/** What an attendee shows at the door: a short signed code (about 40 characters). */
export interface EventTicket {
  token: string;
}

export interface ScanResult {
  ok: true;
  alreadyCheckedIn: boolean;
  checkedInAt: string | null;
  attendee: { name: string; avatarUrl: string } | null;
}

/** A club's public page: an organiser account and what it runs. */
export interface ClubProfile {
  id: string;
  name: string;
  contactName: string | null;
  bio: string;
  avatarUrl: string;
  followers: number;
  following: boolean;
  averageRating: number | null;
  ratingCount: number;
  upcoming: SyncEvent[];
  past: SyncEvent[];
}

export interface ClubSuggestion {
  id: string;
  name: string;
  avatarUrl: string;
  bio: string;
  upcomingEvents: number;
}

/** A question an organiser asks at RSVP time. */
export interface EventQuestion {
  id: string;
  label: string;
  kind: 'text' | 'choice';
  options: string[];
  required: boolean;
}

/** One admin action, as shown in the audit log. */
export interface AuditEntry {
  id: string;
  action: string;
  summary: string;
  actor: { id: string; name: string; avatarUrl: string } | null;
  target: { kind: 'user' | 'event' | 'application' | 'report'; id: string };
  createdAt: string;
}

/** A reported chat message, as an admin sees it. */
export interface MessageReport {
  id: string;
  reason: ReportReason;
  details: string;
  status: ReportStatus;
  createdAt: string;
  event: { id: string; title: string } | null;
  reporter: { name: string } | null;
  message: { id: string; text: string; removed: boolean; sender: string | null } | null;
}

/** One event's numbers for its organisers. */
export interface EventInsights {
  rsvpsByDay: { day: string; count: number }[];
  going: number;
  waitlisted: number;
  pending: number;
  interested: number;
  checkedIn: number;
  showUpRate: number | null;
  averageRating: number | null;
  ratingCount: number;
}

/** A participation certificate for a checked-in attendee of a finished event. */
export interface Certificate {
  name: string;
  event: { id: string; title: string; startsAt: string; endsAt: string; venue: string };
  host: string;
  checkedInAt: string;
  reference: string;
}
