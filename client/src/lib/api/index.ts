import { saveBlob } from '../download';
import { http } from './client';
import type {
  Certificate,
  EventInsights,
  MessageReport,
  AuditEntry,
  ClubProfile,
  ClubSuggestion,
  NotificationType,
  AppNotification,
  AttendeeList,
  CategoryValue,
  ChatMessage,
  DoorList,
  EventInput,
  EventRating,
  EventReport,
  EventTicket,
  Note,
  NoteTag,
  OrganizerApplication,
  OrganizerOverview,
  Page,
  Place,
  PageMeta,
  PlatformStats,
  RegistrationResponse,
  RegistrationStatus,
  ReportReason,
  ReportStatus,
  Role,
  ScanResult,
  Session,
  StaffMember,
  StaffRole,
  SyncEvent,
  User,
  UserStatus,
  VenueSummary,
} from './types';

export * from './client';
export * from './types';

type Data<T> = { data: T };
type Listed<T> = { data: T[]; meta: PageMeta };

const data = <T>(p: Promise<{ data: Data<T> }>) => p.then((r) => r.data.data);
const page = <T>(p: Promise<{ data: Listed<T> }>): Promise<Page<T>> => p.then((r) => ({ items: r.data.data, meta: r.data.meta }));

// --- Server capabilities ------------------------------------------------------

export interface ServerMeta {
  /** 'socket' on long-running hosts; 'polling' on serverless hosts like Vercel. */
  realtime: 'socket' | 'polling';
  emailDelivery: boolean;
  /** Whether the AI assistant is set up (the server has an AI_API_KEY). */
  assistant: boolean;
  /** A public demo with shared accounts that resets nightly (DEMO_MODE). */
  demo?: boolean;
  /** Only these email domains may sign up; empty means anyone. */
  allowedEmailDomains?: string[];
  /** VAPID public key for Web Push, or null when push isn't set up. */
  pushPublicKey?: string | null;
  /** Whether photo uploads (Vercel Blob) are set up. */
  uploads?: boolean;
}

export const metaApi = {
  get: () => data<ServerMeta>(http.get('/meta')),
};

// --- Auth ---------------------------------------------------------------------

export interface RegisterResult {
  email: string;
  emailDelivered?: boolean;
  /** Only in development when email isn't configured. */
  devCode?: string;
}

export const authApi = {
  register: (body: { name: string; email: string; password: string }) => data<RegisterResult>(http.post('/auth/register', body)),
  verifyEmail: (body: { email: string; code: string }) => data<Session>(http.post('/auth/verify-email', body)),
  resendVerification: (email: string) => data<RegisterResult>(http.post('/auth/resend-verification', { email })),
  login: (body: { email: string; password: string }) => data<Session>(http.post('/auth/login', body)),
  forgotPassword: (email: string) => data<{ devResetUrl?: string }>(http.post('/auth/forgot-password', { email })),
  resetPassword: (body: { token: string; password: string }) => data<Session>(http.post('/auth/reset-password', body)),
};

// --- Current user ---------------------------------------------------------------

export interface ProfileUpdate {
  name?: string;
  bio?: string;
  avatarUrl?: string;
  interests?: CategoryValue[];
  preferences?: { emailNotifications?: boolean; mutedEmailTypes?: NotificationType[]; autoAcceptWaitlist?: boolean };
}

export const meApi = {
  get: () => data<User>(http.get('/me')),
  update: (body: ProfileUpdate) => data<User>(http.patch('/me', body)),
  changePassword: (body: { currentPassword: string; newPassword: string }) => data<Session>(http.post('/me/password', body)),
  /** The secret calendar subscription URL; `reset` replaces it. */
  calendarFeed: (reset = false) =>
    data<{ url: string; webcalUrl: string }>(reset ? http.post('/me/calendar-feed/reset') : http.get('/me/calendar-feed')),
  /** Registers / removes this browser for push notifications. */
  addPushSubscription: (subscription: PushSubscriptionJSON) =>
    data<{ ok: true }>(http.post('/me/push-subscriptions', subscription)),
  removePushSubscription: (endpoint: string) => data<{ ok: true }>(http.post('/me/push-subscriptions/remove', { endpoint })),
  /** Everything Sync holds about you, as a JSON file. */
  async downloadData() {
    const response = await http.get<Blob>('/me/export', { responseType: 'blob' });
    saveBlob(response.data, 'sync-my-data.json');
  },
  /** Deletes the account for good. */
  deleteAccount: (password: string) => data<{ deleted: true }>(http.post('/me/delete', { password })),
  /** Ends every session for this account, this device included. */
  signOutEverywhere: () => data<{ ok: true }>(http.post('/me/sign-out-everywhere')),
  calendar: (range: { from: string; to: string }) => data<SyncEvent[]>(http.get('/me/calendar', { params: range })),
  registrations: (upcoming = true) => data<SyncEvent[]>(http.get('/me/registrations', { params: { upcoming } })),
};

// --- Events ---------------------------------------------------------------------

export interface EventQuery {
  q?: string;
  category?: CategoryValue;
  organizer?: string;
  from?: string;
  to?: string;
  sort?: 'soonest' | 'popular' | 'newest';
  includePast?: boolean;
  hasSpots?: boolean;
  online?: boolean;
  tag?: string;
  page?: number;
  limit?: number;
}

export const eventsApi = {
  list: (query: EventQuery = {}) => page<SyncEvent>(http.get('/events', { params: query })),
  recommended: () => data<SyncEvent[]>(http.get('/events/recommended')),
  venues: () => data<VenueSummary[]>(http.get('/events/venues')),
  get: (id: string) => data<SyncEvent>(http.get(`/events/${id}`)),
  create: (body: EventInput) => data<SyncEvent>(http.post('/events', body)),
  update: (id: string, body: Partial<EventInput>) => data<SyncEvent>(http.patch(`/events/${id}`, body)),
  cancel: (id: string, reason = '') => data<SyncEvent>(http.post(`/events/${id}/cancel`, { reason })),
  remove: (id: string) => http.delete(`/events/${id}`).then(() => undefined),
  register: (id: string, answers: { question: string; answer: string }[] = []) =>
    data<RegistrationResponse>(http.post(`/events/${id}/registration`, { answers })),
  /** Approve or decline a request to join (events that need approval). */
  decide: (id: string, userId: string, approve: boolean) =>
    data<AttendeeList>(http.put(`/events/${id}/attendees/${userId}/approval`, { approve })),
  /** The other upcoming dates of a repeating event. */
  series: (id: string) => data<SyncEvent[]>(http.get(`/events/${id}/series`)),
  /** RSVPs to every upcoming date of a repeating event. */
  registerSeries: (id: string) =>
    data<{ id: string; status: RegistrationStatus | null; error?: string }[]>(http.post(`/events/${id}/registration/series`)),
  /** Accepts a seat held for you off the waitlist. */
  claim: (id: string) => data<RegistrationResponse>(http.post(`/events/${id}/registration/claim`)),
  /** Bookmark ("Interested") or un-bookmark; takes no seat. */
  setInterested: (id: string, interested: boolean) =>
    data<SyncEvent>(interested ? http.put(`/events/${id}/interest`) : http.delete(`/events/${id}/interest`)),
  unregister: (id: string) => data<SyncEvent>(http.delete(`/events/${id}/registration`)),
  attendees: (id: string, status?: RegistrationStatus) =>
    data<AttendeeList>(http.get(`/events/${id}/attendees`, { params: { status } })),
  /** Names and check-ins for door staff (no emails). */
  doorList: (id: string) => data<DoorList>(http.get(`/events/${id}/door-list`)),
  setCheckIn: (id: string, userId: string, checkedIn: boolean) =>
    data<{ checkedInAt: string | null }>(http.put(`/events/${id}/attendees/${userId}/check-in`, { checkedIn })),
  /** The signed code this user shows at the door. Null when not attending. */
  ticket: (id: string) => data<EventTicket | null>(http.get(`/events/${id}/ticket`)),
  /** Checks a scanned ticket in. Throws with a friendly message if it is not valid. */
  scan: (id: string, token: string) => data<ScanResult>(http.post(`/events/${id}/scan`, { token })),
  ratings: (id: string) => data<EventRating>(http.get(`/events/${id}/ratings`)),
  rate: (id: string, rating: number, comment?: string) =>
    data<EventRating>(http.put(`/events/${id}/ratings`, { rating, ...(comment !== undefined ? { comment } : {}) })),
  /** Written feedback for organisers (no names). */
  feedback: (id: string) => data<{ rating: number; comment: string; at: string }[]>(http.get(`/events/${id}/feedback`)),
  /** What the printable participation certificate needs. */
  certificate: (id: string) => data<Certificate>(http.get(`/events/${id}/certificate`)),
  report: (id: string, body: { reason: ReportReason; details?: string }) =>
    data<{ id: string; status: ReportStatus }>(http.post(`/reports/${id}/report`, body)),
  messages: (id: string, params: { before?: string; after?: string; limit?: number } = {}) =>
    http
      .get<{ data: ChatMessage[]; meta: { hasMore: boolean } }>(`/events/${id}/messages`, { params })
      .then((r) => ({ items: r.data.data, hasMore: r.data.meta.hasMore })),
  /** Removes a chat message (the sender, an organiser or an admin). */
  removeMessage: (id: string, messageId: string) => data<{ id: string }>(http.delete(`/events/${id}/messages/${messageId}`)),
  reportMessage: (id: string, messageId: string, reason: ReportReason = 'inappropriate') =>
    data<{ reported: true }>(http.post(`/events/${id}/messages/${messageId}/report`, { reason })),
  /** RSVPs per day, show-up rate and ratings, for the event's organisers. */
  insights: (id: string) => data<EventInsights>(http.get(`/organizer/events/${id}/insights`)),
  sendMessage: (id: string, body: { text: string; announcement?: boolean; audience?: 'all' | 'going' | 'waitlisted' }) =>
    data<ChatMessage>(http.post(`/events/${id}/messages`, body)),

  /** Downloads the event as an .ics file ("Add to calendar"). */
  async downloadCalendarFile(event: Pick<SyncEvent, 'id' | 'title'>) {
    const response = await http.get<Blob>(`/events/${event.id}/calendar.ics`, { responseType: 'blob' });
    saveBlob(response.data, `${event.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'event'}.ics`);
  },
};

// --- Places -------------------------------------------------------------------

export const placesApi = {
  search: (q: string) => data<Place[]>(http.get('/places/search', { params: { q } })),
};

// --- Notes ----------------------------------------------------------------------

export interface NoteInput {
  title: string;
  content?: string;
  tag?: NoteTag;
  pinned?: boolean;
  event?: string | null;
}

export const notesApi = {
  list: (query: { q?: string; tag?: NoteTag; event?: string; page?: number; limit?: number } = {}) =>
    page<Note>(http.get('/notes', { params: query })),
  create: (body: NoteInput) => data<Note>(http.post('/notes', body)),
  update: (id: string, body: Partial<NoteInput>) => data<Note>(http.patch(`/notes/${id}`, body)),
  remove: (id: string) => http.delete(`/notes/${id}`).then(() => undefined),
};

// --- Notifications --------------------------------------------------------------

export const clubsApi = {
  get: (id: string) => data<ClubProfile>(http.get(`/clubs/${id}`)),
  setFollowing: (id: string, follow: boolean) =>
    data<{ following: boolean; followers: number }>(
      follow ? http.put(`/clubs/${id}/follow`) : http.delete(`/clubs/${id}/follow`)
    ),
  suggestions: (interests: CategoryValue[] = []) =>
    data<ClubSuggestion[]>(
      http.get('/clubs/suggestions', { params: interests.length ? { interests: interests.join(',') } : {} })
    ),
};

export const notificationsApi = {
  list: (query: { unreadOnly?: boolean; type?: NotificationType; page?: number; limit?: number } = {}) =>
    http
      .get<{ data: AppNotification[]; meta: PageMeta & { unread: number } }>('/notifications', { params: query })
      .then((r) => ({ items: r.data.data, meta: r.data.meta })),
  markRead: (id: string) => data<AppNotification>(http.post(`/notifications/${id}/read`)),
  markAllRead: () => data<{ updated: number }>(http.post('/notifications/read-all')),
};

// --- Organisers -----------------------------------------------------------------

export const organizerApi = {
  apply: (body: { organization: string; reason?: string }) =>
    data<OrganizerApplication>(http.post('/organizer/applications', body)),
  latestApplication: () => data<OrganizerApplication | null>(http.get('/organizer/applications/latest')),
  overview: () => data<OrganizerOverview>(http.get('/organizer/overview')),
};

// --- Event team (co-organisers) ---------------------------------------------------

export const staffApi = {
  list: (eventId: string) => data<StaffMember[]>(http.get(`/event-staff/${eventId}/staff`)),
  invite: (eventId: string, body: { email: string; role: Exclude<StaffRole, 'owner'> }) =>
    data<StaffMember[]>(http.post(`/event-staff/${eventId}/staff`, body)),
  setRole: (eventId: string, staffId: string, role: StaffRole) =>
    data<StaffMember[]>(http.patch(`/event-staff/${eventId}/staff/${staffId}`, { role })),
  remove: (eventId: string, staffId: string) => data<StaffMember[]>(http.delete(`/event-staff/${eventId}/staff/${staffId}`)),
};

// --- Platform admin -------------------------------------------------------------

export const adminApi = {
  stats: () => data<PlatformStats>(http.get('/admin/stats')),
  messageReports: (status?: ReportStatus) => data<MessageReport[]>(http.get('/admin/message-reports', { params: { status } })),
  resolveMessageReport: (id: string, status: 'reviewed' | 'dismissed') =>
    data<{ id: string }>(http.patch(`/admin/message-reports/${id}`, { status })),
  auditLog: (query: { page?: number; limit?: number } = {}) => page<AuditEntry>(http.get('/admin/audit-log', { params: query })),
  users: (query: { q?: string; role?: Role; status?: UserStatus; page?: number; limit?: number } = {}) =>
    page<User>(http.get('/admin/users', { params: query })),
  updateUser: (id: string, body: { role?: Role; status?: UserStatus }) => data<User>(http.patch(`/admin/users/${id}`, body)),
  applications: (query: { status?: OrganizerApplication['status']; page?: number; limit?: number } = {}) =>
    page<OrganizerApplication>(http.get('/admin/organizer-applications', { params: query })),
  approve: (id: string, note = '') =>
    data<OrganizerApplication>(http.post(`/admin/organizer-applications/${id}/approve`, { note })),
  reject: (id: string, note = '') =>
    data<OrganizerApplication>(http.post(`/admin/organizer-applications/${id}/reject`, { note })),
  reports: (query: { status?: ReportStatus; page?: number; limit?: number } = {}) =>
    page<EventReport>(http.get('/admin/reports', { params: query })),
  /** Marking a report `reviewed` also cancels the event it was about; `reason` goes to attendees and the organiser. */
  resolveReport: (id: string, status: Exclude<ReportStatus, 'open'>, reason = '') =>
    data<EventReport>(http.patch(`/admin/reports/${id}`, { status, reason })),
};

// --- AI assistant -----------------------------------------------------------------

export interface AssistantMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AssistantReply {
  /** Markdown-ish text; events are linked as [Title](/events/<id>). */
  reply: string;
  /** The events the reply links to, for showing as cards. */
  events: SyncEvent[];
}

export const assistantApi = {
  /** Sends the recent conversation (ending with the user's question) and gets the next reply. */
  chat: (messages: AssistantMessage[], timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone) =>
    data<AssistantReply>(http.post('/assistant/chat', { messages, timeZone }, { timeout: 60_000 })),
};
