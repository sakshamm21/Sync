import { z, objectId, pagination, queryBoolean, optionalUrl } from '../../lib/schemas';
import { CATEGORY_VALUES, EVENT_VISIBILITY, EVENT_STATUS } from '../../constants';

const venue = z.object({
  name: z.string().trim().max(160).optional(),
  address: z.string().trim().max(300).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
});

const fields = {
  title: z.string().trim().min(3, 'Title must be at least 3 characters').max(140),
  description: z.string().trim().max(5000),
  category: z.enum(CATEGORY_VALUES),
  tags: z.array(z.string().trim().toLowerCase().min(1).max(30)).max(10),
  coverImageUrl: optionalUrl,
  startsAt: z.coerce.date({ error: 'Enter a valid start date' }),
  endsAt: z.coerce.date({ error: 'Enter a valid end date' }),
  venue,
  onlineUrl: optionalUrl,
  albumUrl: optionalUrl,
  visibility: z.enum(EVENT_VISIBILITY),
  // Cancelling has its own endpoint so attendees are always notified.
  status: z.enum([EVENT_STATUS.DRAFT, EVENT_STATUS.PUBLISHED]),
  capacity: z.number().int().min(1).max(100_000).nullable(),
  // Optional sign-up window; null means "from publishing" / "until the start".
  registrationOpensAt: z.coerce.date().nullable(),
  registrationClosesAt: z.coerce.date().nullable(),
  waitlistClaimHours: z.number().int().min(1).max(72).nullable(),
  questions: z
    .array(
      z
        .object({
          label: z.string().trim().min(1, 'Write the question').max(200),
          kind: z.enum(['text', 'choice']).default('text'),
          options: z.array(z.string().trim().min(1).max(80)).max(8).default([]),
          required: z.boolean().default(false),
        })
        .refine((q) => q.kind === 'text' || q.options.length >= 2, {
          message: 'A choice question needs at least two options',
          path: ['options'],
        })
    )
    .max(5, 'Ask at most five questions'),
  requiresApproval: z.boolean(),
  teamSize: z
    .object({ min: z.number().int().min(1).max(20), max: z.number().int().min(1).max(20) })
    .refine((t) => t.max >= t.min, { message: 'The largest team must be at least the smallest' })
    .nullable(),
};

const windowInOrder = (e: { registrationOpensAt?: Date | null; registrationClosesAt?: Date | null }) =>
  !e.registrationOpensAt || !e.registrationClosesAt || e.registrationClosesAt > e.registrationOpensAt;
const windowMessage = { message: 'Registration must close after it opens', path: ['registrationClosesAt'] };

const endsAfterStart = (e: { startsAt?: Date; endsAt?: Date }) => !e.startsAt || !e.endsAt || e.endsAt > e.startsAt;
const endsAfterStartMessage = { message: 'The event must end after it starts', path: ['endsAt'] };

export const create = z
  .object({
    title: fields.title,
    description: fields.description.default(''),
    category: fields.category.default('other'),
    tags: fields.tags.default([]),
    coverImageUrl: fields.coverImageUrl.optional(),
    startsAt: fields.startsAt,
    endsAt: fields.endsAt,
    venue: fields.venue.optional(),
    onlineUrl: fields.onlineUrl.optional(),
    visibility: fields.visibility.optional(),
    status: fields.status.optional(),
    capacity: fields.capacity.optional(),
    registrationOpensAt: fields.registrationOpensAt.optional(),
    registrationClosesAt: fields.registrationClosesAt.optional(),
    waitlistClaimHours: fields.waitlistClaimHours.optional(),
    questions: fields.questions.optional(),
    requiresApproval: fields.requiresApproval.optional(),
    teamSize: fields.teamSize.optional(),
    /** Create more dates: the same event every week (or two) for `count` dates in all. */
    repeat: z.object({ every: z.enum(['week', 'fortnight']), count: z.number().int().min(2).max(16) }).optional(),
  })
  .refine(endsAfterStart, endsAfterStartMessage)
  .refine(windowInOrder, windowMessage);
export type CreateEventInput = z.output<typeof create>;

export const update = z
  .object(fields)
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'Nothing to update')
  .refine(endsAfterStart, endsAfterStartMessage)
  .refine(windowInOrder, windowMessage);
export type UpdateEventInput = z.output<typeof update>;

export const list = z.object({
  q: z.string().trim().max(100).optional(),
  category: z.enum(CATEGORY_VALUES).optional(),
  organizer: objectId.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  sort: z.enum(['soonest', 'popular', 'newest']).default('soonest'),
  includePast: queryBoolean.default(false),
  /** Only events with a free seat (or no cap). */
  hasSpots: queryBoolean.default(false),
  /** Only events with an online link. */
  online: queryBoolean.default(false),
  /** Only events with this tag, e.g. "free-food". */
  tag: z.string().trim().toLowerCase().max(40).optional(),
  ...pagination,
});
export type ListEventsQuery = z.output<typeof list>;

export const cancel = z.object({
  reason: z.string().trim().max(500).default(''),
});

export const registrationParams = z.object({ id: objectId, userId: objectId });

export const checkIn = z.object({
  checkedIn: z.boolean().default(true),
});

export const calendarRange = z
  .object({
    from: z.coerce.date({ error: 'Enter a valid start date' }),
    to: z.coerce.date({ error: 'Enter a valid end date' }),
  })
  .refine((r) => r.to > r.from, { message: '`to` must be after `from`', path: ['to'] })
  .refine((r) => r.to.getTime() - r.from.getTime() <= 400 * 24 * 60 * 60 * 1000, {
    message: 'Range can be at most about a year',
    path: ['to'],
  });
export type CalendarRange = z.output<typeof calendarRange>;

/** Answers sent with an RSVP, one per question id. */
export const registerBody = z.object({
  answers: z
    .array(z.object({ question: objectId, answer: z.string().trim().max(1000) }))
    .max(5)
    .default([]),
});
export type RegisterBody = z.output<typeof registerBody>;
