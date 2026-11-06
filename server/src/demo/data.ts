/**
 * The demo / test dataset, as plain data. `npm run seed` (and, with DEMO_MODE,
 * the nightly /api/jobs/demo-reset job) loads it through the real services, so
 * seat counts, waitlists and notifications stay consistent. TEST_ACCOUNTS.md
 * at the repo root describes it for people trying the app.
 *
 * Dates are relative to the day you seed (`day: 3` = three days from today, in
 * CAMPUS_TIMEZONE), so re-seeding refreshes them. Every account uses DEMO_PASSWORD.
 */
import type { Category, NoteTag, Role, UserStatus } from '../constants';

export const DEMO_PASSWORD = 'syncronify123';

export interface DemoUser {
  key: string;
  name: string;
  email: string;
  role: Role;
  status?: UserStatus;
  organization?: string;
  bio?: string;
  interests?: Category[];
  /** What this account is for; shown by the seed script and in TEST_ACCOUNTS.md. */
  purpose: string;
}

/** A moment relative to the seed date: `day` from today at `hour`:`minute`, campus time. */
export interface When {
  day: number;
  hour: number;
  minute?: number;
}

export interface DemoEvent {
  key: string;
  owner: string;
  title: string;
  description: string;
  category: Category;
  tags?: string[];
  /** Unsplash photo id; without one the event shows its category's gradient. */
  cover?: string;
  starts: When;
  ends: When;
  venue?: { name: string; address?: string; latitude?: number; longitude?: number };
  onlineUrl?: string;
  /** Omit for unlimited. */
  capacity?: number;
  /** Personal calendar entries are private; everything else is public. */
  visibility?: 'public' | 'private';
  status?: 'draft' | 'published';
  /** Registered in this order; anyone past the capacity lands on the waitlist. */
  attendees?: string[];
  /** Unregister after everyone has signed up (frees a seat and promotes the waitlist). */
  leaves?: string[];
  /** Past events only: attendees who were checked in at the door. */
  checkedIn?: string[];
  /** People invited to help run this event, as `key` + their staff role. */
  staff?: { user: string; role: 'manager' | 'checkin' }[];
  /** Past events only: 1-5 stars from the people who attended. */
  ratings?: { user: string; rating: number }[];
  messages?: { from: string; text: string; announcement?: boolean }[];
  /** Cancel after registrations, with this message to attendees. */
  cancelledReason?: string;
}

export interface DemoNote {
  owner: string;
  title: string;
  content: string;
  tag: NoteTag;
  pinned?: boolean;
  event?: string;
}

export interface DemoApplication {
  user: string;
  organization: string;
  reason: string;
  /** Leave out for a pending application. */
  review?: { by: string; approve: boolean; note: string };
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export const users: DemoUser[] = [
  {
    key: 'admin',
    name: 'Riya Kapoor',
    email: 'admin@syncronify.dev',
    role: 'admin',
    purpose: 'Platform admin: user directory, organizer approvals, moderation.',
  },
  {
    key: 'tech',
    name: 'Arjun Mehta',
    email: 'organizer@syncronify.dev',
    role: 'organizer',
    organization: 'Tech & Computing Society',
    bio: 'We run hackathons, talks and build nights.',
    interests: ['tech', 'workshop'],
    purpose:
      'Organizer with the most events: a full hackathon with a waitlist, a draft, a cancelled event, a past event with check-ins.',
  },
  {
    key: 'cultural',
    name: 'Meera Iyer',
    email: 'cultural@syncronify.dev',
    role: 'organizer',
    organization: 'Cultural Affairs Council',
    bio: 'Music, art, theatre and everything in between.',
    interests: ['cultural', 'social'],
    purpose: 'Second organizer: cultural and social events.',
  },
  {
    key: 'sports',
    name: 'Vikram Nair',
    email: 'sports@syncronify.dev',
    role: 'organizer',
    organization: 'Sports Council',
    interests: ['sports'],
    purpose: 'Third organizer: sports events.',
  },
  {
    key: 'member',
    name: 'Kabir Singh',
    email: 'member@syncronify.dev',
    role: 'member',
    bio: 'Second-year CSE. Always up for a hackathon.',
    interests: ['tech', 'workshop'],
    purpose: 'The main student account: tickets, private plans, notes, chats and notifications already set up.',
  },
  {
    key: 'asha',
    name: 'Asha Rao',
    email: 'asha@syncronify.dev',
    role: 'member',
    interests: ['cultural', 'social'],
    purpose: 'Member with a pending organizer application (approve or reject it as admin).',
  },
  {
    key: 'rahul',
    name: 'Rahul Verma',
    email: 'rahul@syncronify.dev',
    role: 'member',
    interests: ['sports'],
    purpose: 'Member whose organizer application was rejected; gave up his hackathon seat.',
  },
  {
    key: 'priya',
    name: 'Priya Sharma',
    email: 'priya@syncronify.dev',
    role: 'member',
    interests: ['tech', 'conference'],
    purpose: 'Member who was moved off the hackathon waitlist (has a "You\'re in" notification).',
  },
  {
    key: 'ishaan',
    name: 'Ishaan Gupta',
    email: 'ishaan@syncronify.dev',
    role: 'member',
    interests: ['tech', 'sports'],
    purpose: 'Member still on the hackathon waitlist.',
  },
  {
    key: 'suspended',
    name: 'Sam Thomas',
    email: 'suspended@syncronify.dev',
    role: 'member',
    status: 'suspended',
    purpose: 'Suspended account: signing in shows the suspension message.',
  },
  // Clean accounts with no activity, so several people can try the app at once
  // or walk through it as a brand-new user.
  ...[1, 2, 3, 4, 5].map((n): DemoUser => ({
    key: `tester${n}`,
    name: `Test User ${n}`,
    email: `tester${n}@syncronify.dev`,
    role: 'member',
    purpose: 'Fresh member account with no activity.',
  })),
];

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

const IITK = 'IIT Kanpur, Kalyanpur, Uttar Pradesh';

export const events: DemoEvent[] = [
  // --- Tech & Computing Society --------------------------------------------
  {
    key: 'rust',
    owner: 'tech',
    title: 'Intro to Rust Workshop',
    description: 'Hands-on session covering ownership, borrowing and building a small CLI. Bring a laptop with Rust installed.',
    category: 'workshop',
    tags: ['rust', 'beginner'],
    starts: { day: 1, hour: 17 },
    ends: { day: 1, hour: 19 },
    venue: { name: 'Computer Centre Lab 2', address: IITK, latitude: 26.511, longitude: 80.2341 },
    capacity: 40,
    attendees: ['member', 'priya'],
  },
  {
    key: 'summit',
    owner: 'tech',
    title: 'Tech Summit 2026',
    description:
      'Keynotes on agentic AI, distributed systems and the future of the web, followed by live demos from student teams.',
    category: 'conference',
    tags: ['ai', 'talks'],
    cover: 'photo-1540575467063-178a50c2df87',
    starts: { day: 3, hour: 10 },
    ends: { day: 3, hour: 16 },
    venue: { name: 'Main Auditorium', address: `Academic Area, ${IITK}`, latitude: 26.5123, longitude: 80.2329 },
    capacity: 300,
    attendees: ['member', 'asha', 'rahul', 'priya', 'ishaan'],
    messages: [
      { from: 'member', text: 'Is there parking near the auditorium?' },
      { from: 'tech', text: 'Yes, Lot B opposite the Innovation Lab is open all day.' },
      { from: 'priya', text: 'Will the keynotes be recorded?' },
      { from: 'tech', text: 'Doors open at 9:30. Bring your student ID for entry. Talks will be recorded.', announcement: true },
    ],
  },
  {
    key: 'ai-reading',
    owner: 'tech',
    title: 'AI Reading Group: Building Agents',
    description:
      'We discuss one paper or blog post on AI agents each week. This week: tool use and planning. Join from anywhere.',
    category: 'meetup',
    tags: ['ai', 'online'],
    cover: 'photo-1517245386807-bb43f82c33c4',
    starts: { day: 4, hour: 19 },
    ends: { day: 4, hour: 20, minute: 30 },
    onlineUrl: 'https://meet.google.com/syn-demo-ai',
    attendees: ['member', 'priya'],
  },
  {
    key: 'hackathon',
    owner: 'tech',
    title: '24h Design & Build Hackathon',
    description: 'Form a team, build something delightful in 24 hours. Mentors, food and prizes for the top three teams.',
    category: 'tech',
    tags: ['hackathon', 'design'],
    cover: 'photo-1515187029135-18ee286d815b',
    starts: { day: 7, hour: 9 },
    ends: { day: 8, hour: 9 },
    venue: { name: 'Innovation Lab', address: IITK, latitude: 26.5149, longitude: 80.2335 },
    // Tiny on purpose: it fills up, Rahul leaves, Priya moves up, Ishaan waits.
    capacity: 3,
    attendees: ['rahul', 'member', 'asha', 'priya', 'ishaan'],
    leaves: ['rahul'],
    messages: [
      { from: 'asha', text: 'Looking for a designer for our team!' },
      { from: 'member', text: "I'm in. Let's sketch ideas on Friday." },
    ],
  },
  {
    key: 'devops',
    owner: 'tech',
    title: 'Cloud & DevOps Bootcamp',
    description: 'Two hours on containers, CI pipelines and deploying a web app for free. Small group, lots of hands-on time.',
    category: 'workshop',
    tags: ['cloud', 'devops'],
    cover: 'photo-1526628953301-3e589a6a8b74',
    starts: { day: 20, hour: 15 },
    ends: { day: 20, hour: 17 },
    venue: { name: 'Computer Centre Lab 1', address: IITK, latitude: 26.5112, longitude: 80.2338 },
    // Shows the "3 left" sticker.
    capacity: 6,
    attendees: ['asha', 'priya', 'ishaan'],
  },
  {
    key: 'pitch',
    owner: 'tech',
    title: 'Startup Pitch Night',
    description: 'Student founders pitch to alumni investors. Still confirming the judging panel.',
    category: 'meetup',
    tags: ['startups'],
    cover: 'photo-1559223607-a43c990c692c',
    status: 'draft',
    starts: { day: 21, hour: 18 },
    ends: { day: 21, hour: 21 },
    venue: { name: 'Lecture Hall Complex, L-7', address: IITK, latitude: 26.5103, longitude: 80.2346 },
  },
  {
    key: 'robotics',
    owner: 'tech',
    title: 'Robotics Demo Day',
    description: 'Teams show off line-followers, drones and a robotic arm.',
    category: 'tech',
    tags: ['robotics'],
    starts: { day: 9, hour: 14 },
    ends: { day: 9, hour: 17 },
    venue: { name: 'Robotics Lab', address: IITK, latitude: 26.5139, longitude: 80.2319 },
    attendees: ['member', 'rahul'],
    cancelledReason: 'The robotics lab is closed for maintenance. We will announce a new date soon.',
  },
  {
    key: 'oss-meetup',
    owner: 'tech',
    title: 'Open Source Contributors Meetup',
    description: 'Monthly meetup for open source contributors on campus. Lightning talks and pairing on first issues.',
    category: 'meetup',
    tags: ['open-source'],
    cover: 'photo-1551434678-e076c223a692',
    starts: { day: -6, hour: 18 },
    ends: { day: -6, hour: 20 },
    venue: { name: 'Library Seminar Hall', address: IITK, latitude: 26.5117, longitude: 80.2307 },
    attendees: ['member', 'rahul', 'priya'],
    checkedIn: ['member', 'priya'],
    // A committee of three, not one person: Asha can edit, Rahul works the door.
    staff: [
      { user: 'asha', role: 'manager' },
      { user: 'rahul', role: 'checkin' },
    ],
    ratings: [
      { user: 'member', rating: 5 },
      { user: 'priya', rating: 4 },
    ],
  },

  // --- Cultural Affairs Council --------------------------------------------
  {
    key: 'band-night',
    owner: 'cultural',
    title: 'Annual Cultural Fest: Live Band Night',
    description: 'An evening of music, art installations and food pop-ups under the stars.',
    category: 'cultural',
    tags: ['music', 'festival'],
    cover: 'photo-1492684223066-81342ee5ff30',
    starts: { day: 10, hour: 18 },
    ends: { day: 10, hour: 23 },
    venue: { name: 'Open Air Theatre', address: IITK, latitude: 26.5091, longitude: 80.2297 },
    attendees: ['asha', 'member', 'ishaan'],
    staff: [{ user: 'priya', role: 'manager' }],
  },
  {
    key: 'movie-night',
    owner: 'cultural',
    title: 'Open-Air Movie Night',
    description: 'A classic on the big screen. Bring a blanket; popcorn is on us.',
    category: 'social',
    tags: ['movies'],
    cover: 'photo-1478720568477-152d9b164e26',
    starts: { day: 6, hour: 20 },
    ends: { day: 6, hour: 23 },
    venue: { name: 'Open Air Theatre', address: IITK, latitude: 26.5091, longitude: 80.2297 },
    capacity: 150,
    attendees: ['asha', 'rahul'],
  },
  {
    key: 'open-mic',
    owner: 'cultural',
    title: 'Open Mic & Poetry Evening',
    description: 'Share a poem, a story or a song. Sign-ups at the door.',
    category: 'social',
    tags: ['poetry', 'music'],
    starts: { day: 14, hour: 19 },
    ends: { day: 14, hour: 21 },
    venue: { name: 'Student Activity Centre', address: IITK, latitude: 26.5058, longitude: 80.2312 },
    capacity: 60,
    attendees: ['asha'],
  },
  {
    key: 'watercolour',
    owner: 'cultural',
    title: 'Watercolour & Sketching Workshop',
    description: 'Learn washes, layering and quick sketching outdoors. All materials provided.',
    category: 'workshop',
    tags: ['art'],
    cover: 'photo-1513364776144-60967b0f800f',
    starts: { day: 17, hour: 16 },
    ends: { day: 17, hour: 18 },
    venue: { name: 'Fine Arts Studio', address: IITK, latitude: 26.5084, longitude: 80.2321 },
    capacity: 25,
    attendees: ['asha'],
  },
  {
    key: 'photo-walk',
    owner: 'cultural',
    title: 'Photo Walk: Campus at Dusk',
    description: 'A slow walk around campus at golden hour, with tips on composition and low-light shots.',
    category: 'cultural',
    tags: ['photography'],
    starts: { day: -12, hour: 17 },
    ends: { day: -12, hour: 19 },
    venue: { name: 'Main Gate', address: IITK, latitude: 26.5076, longitude: 80.2284 },
    attendees: ['asha', 'priya'],
    checkedIn: ['asha'],
  },

  // --- Sports Council --------------------------------------------------------
  {
    key: 'football',
    owner: 'sports',
    title: 'Inter-Hall Football Finals',
    description: 'Cheer for your hall in the season finale. Free entry.',
    category: 'sports',
    tags: ['football'],
    cover: 'photo-1431324155629-1a6deb1dec8d',
    starts: { day: 5, hour: 16 },
    ends: { day: 5, hour: 18 },
    venue: { name: 'Sports Complex Ground', address: IITK, latitude: 26.5072, longitude: 80.2268 },
    attendees: ['rahul', 'member', 'ishaan'],
    messages: [{ from: 'sports', text: 'Kick-off moved to 16:15. Hall captains, report by 15:45.', announcement: true }],
  },
  {
    key: 'yoga',
    owner: 'sports',
    title: 'Sunrise Yoga',
    description: 'A gentle 45-minute flow to start the day. Mats provided; beginners welcome.',
    category: 'sports',
    tags: ['yoga', 'wellness'],
    cover: 'photo-1544367567-0f2fcb009e0b',
    starts: { day: 2, hour: 6 },
    ends: { day: 2, hour: 7 },
    venue: { name: 'Hall 12 Lawn', address: IITK, latitude: 26.5041, longitude: 80.2335 },
    capacity: 30,
    attendees: ['priya'],
  },
  {
    key: 'fun-run',
    owner: 'sports',
    title: 'Campus 5K Fun Run',
    description: 'A friendly 5K loop around campus. Water stations, medals for everyone who finishes.',
    category: 'sports',
    tags: ['running'],
    cover: 'photo-1452626038306-9aae5e071dd3',
    starts: { day: 12, hour: 6, minute: 30 },
    ends: { day: 12, hour: 8, minute: 30 },
    venue: { name: 'Sports Complex', address: IITK, latitude: 26.5068, longitude: 80.2275 },
    capacity: 200,
    attendees: ['rahul', 'priya', 'ishaan'],
  },
  {
    key: 'badminton',
    owner: 'sports',
    title: 'Badminton Doubles League',
    description: 'Register as a pair; matches run over the weekend.',
    category: 'sports',
    tags: ['badminton'],
    starts: { day: 25, hour: 9 },
    ends: { day: 26, hour: 18 },
    venue: { name: 'Indoor Sports Hall', address: IITK, latitude: 26.507, longitude: 80.2262 },
    capacity: 32,
  },

  // --- Kabir's personal plans (private: only he can see them) ---------------
  {
    key: 'os-study',
    owner: 'member',
    title: 'Study group: Operating Systems',
    description: 'Revise scheduling and memory management before the quiz.',
    category: 'other',
    visibility: 'private',
    starts: { day: 2, hour: 20 },
    ends: { day: 2, hour: 22 },
    venue: { name: 'Hall 5 reading room' },
  },
  {
    key: 'gym',
    owner: 'member',
    title: 'Gym session',
    description: 'Leg day.',
    category: 'sports',
    visibility: 'private',
    starts: { day: 1, hour: 7 },
    ends: { day: 1, hour: 8 },
    venue: { name: 'Campus gym' },
  },
];

// ---------------------------------------------------------------------------
// Notes and organizer applications
// ---------------------------------------------------------------------------

export const notes: DemoNote[] = [
  {
    owner: 'member',
    title: 'Hackathon team ideas',
    content: 'Campus lost & found app\nShared ride planner\nMess menu ratings',
    tag: 'ideas',
    pinned: true,
    event: 'hackathon',
  },
  {
    owner: 'member',
    title: 'Summit talks to catch',
    content: 'Agentic AI keynote at 11:00\nDistributed systems panel after lunch',
    tag: 'plan',
    event: 'summit',
  },
  {
    owner: 'member',
    title: 'Rust setup checklist',
    content: 'Install rustup\ncargo new hello\nRead chapter 4 (ownership)',
    tag: 'plan',
    event: 'rust',
  },
  {
    owner: 'member',
    title: 'Things to try this semester',
    content: 'Learn to swim\nJoin the photography club\nRun a 5K',
    tag: 'personal',
  },
  {
    owner: 'tech',
    title: 'Summit logistics checklist',
    content: 'Projector test\nPrint QR codes\nConfirm catering for 300',
    tag: 'logistics',
    pinned: true,
    event: 'summit',
  },
  {
    owner: 'tech',
    title: 'Keynote speaker shortlist',
    content: 'Alumni from the 2019 batch\nLocal startup CTO',
    tag: 'speaker',
    event: 'summit',
  },
  {
    owner: 'cultural',
    title: 'Band night run sheet',
    content: '18:00 doors\n18:30 opening act\n21:00 headliner',
    tag: 'logistics',
    event: 'band-night',
  },
];

export const applications: DemoApplication[] = [
  {
    user: 'asha',
    organization: 'Photography Club',
    reason: 'We host monthly photo walks and want to open them to everyone on campus.',
  },
  {
    user: 'rahul',
    organization: 'Gaming Society',
    reason: 'Weekly gaming nights and an inter-hall esports cup.',
    review: { by: 'admin', approve: false, note: 'Please re-apply with a faculty advisor named.' },
  },
];
