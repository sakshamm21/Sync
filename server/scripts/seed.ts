/**
 * Loads the demo / test dataset from demo-data.ts. Goes through the real
 * services so seat counts, waitlists and notifications are consistent.
 *
 *   npm run seed            # only if the database is empty
 *   npm run seed -- --reset # wipe everything first (also refreshes the dates)
 */
import { parseArgs } from 'node:util';
import mongoose from 'mongoose';
import env from '../src/config/env';
import { connectDatabase, disconnectDatabase } from '../src/config/db';
import * as models from '../src/models';
import * as events from '../src/modules/events/events.service';
import * as registrations from '../src/modules/events/registrations.service';
import * as staff from '../src/modules/events/staff.service';
import * as ratings from '../src/modules/events/ratings.service';
import * as chat from '../src/modules/chat/chat.service';
import * as organizer from '../src/modules/organizer/organizer.service';
import * as admin from '../src/modules/admin/admin.service';
import * as data from './demo-data';

const { DEMO_PASSWORD } = data;

function at({ day, hour, minute = 0 }: data.When): Date {
  const d = new Date();
  d.setDate(d.getDate() + day);
  d.setHours(hour, minute, 0, 0);
  return d;
}

const coverUrl = (id: string) => `https://images.unsplash.com/${id}?w=1200&auto=format&fit=crop&q=80`;

async function seed() {
  const users = new Map<string, models.UserDocument>();
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
    await doc.setPassword(DEMO_PASSWORD);
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

function printSummary() {
  const width = Math.max(...data.users.map((u) => u.email.length)) + 2;
  console.log(`\nDemo data ready. Every account uses the password "${DEMO_PASSWORD}":\n`);
  for (const u of data.users) {
    const role = u.status === 'suspended' ? 'suspended' : u.role;
    console.log(`  ${u.email.padEnd(width)}${role.padEnd(11)}${u.purpose}`);
  }
  console.log('\nSee TEST_ACCOUNTS.md for what to try with each account.\n');
}

async function main() {
  const { values } = parseArgs({ options: { reset: { type: 'boolean', default: false } } });
  if (env.isProduction) {
    console.error('Refusing to seed demo data in production.');
    process.exit(1);
  }

  await connectDatabase(env.dbUri);
  await mongoose.connection.syncIndexes();

  if (values.reset) {
    const collections = await mongoose.connection.db!.collections();
    await Promise.all(collections.map((c) => c.deleteMany({})));
  } else if (await models.User.exists({})) {
    console.log('Database already has data; skipping seed. Use `npm run seed -- --reset` to start over.');
    await disconnectDatabase();
    return;
  }

  await seed();
  printSummary();
  await disconnectDatabase();
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { seed, printSummary, DEMO_PASSWORD };
