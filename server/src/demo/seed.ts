/**
 * Loads the demo dataset (./data.ts) through the real services, so seat counts,
 * waitlists and notifications are consistent. Used by `npm run seed` and, on a
 * public demo (DEMO_MODE), by the nightly /api/jobs/demo-reset job.
 */
import mongoose from 'mongoose';
import env from '../config/env';
import * as models from '../models';
import * as events from '../modules/events/events.service';
import * as registrations from '../modules/events/registrations.service';
import * as staff from '../modules/events/staff.service';
import * as ratings from '../modules/events/ratings.service';
import * as chat from '../modules/chat/chat.service';
import * as organizer from '../modules/organizer/organizer.service';
import * as admin from '../modules/admin/admin.service';
import * as data from './data';

const { DEMO_PASSWORD } = data;

export interface SeedResult {
  users: Map<string, models.UserDocument>;
  eventIds: Map<string, string>;
}

/** Minutes the time zone is ahead of UTC at `date` (330 for Asia/Kolkata). */
function offsetMinutes(timeZone: string, date: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - date.getTime()) / 60_000);
}

/**
 * `day` days from today at `hour`:`minute` on the campus clock, whatever time
 * zone the server runs in (Vercel and CI run in UTC).
 */
export function at({ day, hour, minute = 0 }: data.When, now = new Date(), timeZone = env.campusTimeZone): Date {
  const today = new Date(now.getTime() + offsetMinutes(timeZone, now) * 60_000);
  const wallClock = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + day, hour, minute);
  // The offset can differ on the target day (daylight saving), so take it there.
  return new Date(wallClock - offsetMinutes(timeZone, new Date(wallClock)) * 60_000);
}

const coverUrl = (id: string) => `https://images.unsplash.com/${id}?w=1200&auto=format&fit=crop&q=80`;

export async function seed(): Promise<SeedResult> {
  const users = new Map<string, models.UserDocument>();
  let passwordHash: string | undefined;
  const user = (key: string) => {
    const found = users.get(key);
    if (!found) throw new Error(`demo-data: unknown user "${key}"`);
    return found;
  };

  for (const { key, purpose: _purpose, ...fields } of data.users) {
    const doc = new models.User({
      ...fields,
      emailVerified: true,
      // Demo addresses can't receive mail; don't try (it would bounce if SMTP is set up).
      preferences: { emailNotifications: false },
    });
    // Hashing is deliberately slow, so hash once and share it: the nightly
    // reset has to finish inside a serverless time limit.
    if (passwordHash) doc.passwordHash = passwordHash;
    else {
      await doc.setPassword(DEMO_PASSWORD);
      passwordHash = doc.passwordHash;
    }
    users.set(key, await doc.save());
  }

  const eventIds = new Map<string, string>();
  const eventId = (key: string) => {
    const found = eventIds.get(key);
    if (!found) throw new Error(`demo-data: unknown event "${key}"`);
    return found;
  };

  for (const spec of data.events) {
    const owner = user(spec.owner);
    const startsAt = at(spec.starts);
    const endsAt = at(spec.ends);
    const created = await events.create(owner, {
      title: spec.title,
      description: spec.description,
      category: spec.category,
      tags: spec.tags ?? [],
      coverImageUrl: spec.cover ? coverUrl(spec.cover) : undefined,
      startsAt,
      endsAt,
      venue: spec.venue,
      onlineUrl: spec.onlineUrl,
      visibility: spec.visibility ?? 'public',
      status: spec.status,
      capacity: spec.capacity ?? null,
    });
    eventIds.set(spec.key, created.id);

    const attendees = (spec.attendees ?? []).map(user);
    if (endsAt < new Date()) {
      // Registration is closed for past events, so write their history directly.
      const checkedIn = new Set(spec.checkedIn ?? []);
      await models.Registration.insertMany(
        (spec.attendees ?? []).map((key) => ({
          event: created.id,
          user: user(key)._id,
          status: 'going',
          checkedInAt: checkedIn.has(key) ? new Date(startsAt.getTime() + 10 * 60 * 1000) : null,
        }))
      );
      await models.Event.updateOne({ _id: created.id }, { attendeeCount: attendees.length });
    } else {
      for (const attendee of attendees) await registrations.register(attendee, created.id);
    }

    for (const key of spec.leaves ?? []) await registrations.unregister(user(key), created.id);

    // The committee that helps run this event alongside its creator.
    for (const member of spec.staff ?? []) {
      await staff.invite(owner, created.id, { email: user(member.user).email, role: member.role });
    }

    for (const message of spec.messages ?? []) {
      await chat.postMessage(user(message.from), created.id, { text: message.text, announcement: Boolean(message.announcement) });
    }

    if (spec.cancelledReason) await events.cancel(owner, created.id, { reason: spec.cancelledReason });

    // Ratings only work once the event is over, so they go last.
    for (const entry of spec.ratings ?? []) {
      await ratings.rate(user(entry.user), created.id, entry.rating);
    }
  }

  await models.Note.insertMany(
    data.notes.map((note) => ({
      owner: user(note.owner)._id,
      title: note.title,
      content: note.content,
      tag: note.tag,
      pinned: Boolean(note.pinned),
      event: note.event ? eventId(note.event) : null,
    }))
  );

  for (const application of data.applications) {
    const created = await organizer.apply(user(application.user), { organization: application.organization, reason: application.reason });
    if (application.review) {
      const { by, approve, note } = application.review;
      await admin.reviewApplication(user(by), created.id, { approve, note });
    }
  }

  return { users, eventIds };
}

/** Deletes every document in every collection. Indexes are kept. */
export async function wipeDatabase(): Promise<void> {
  const db = mongoose.connection.db;
  if (!db) throw new Error('Database is not connected');
  const collections = await db.collections();
  await Promise.all(collections.map((c) => c.deleteMany({})));
}

/** Replaces everything with fresh demo data dated from today. */
export async function resetDemoData(): Promise<SeedResult> {
  await wipeDatabase();
  return seed();
}
