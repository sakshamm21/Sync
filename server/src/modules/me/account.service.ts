/**
 * "Download my data" and "Delete my account" (Roadmap "Next" #12; India's
 * DPDP Act 2023 expects both).
 */
import {
  Event,
  EventStaff,
  Follow,
  Interest,
  Message,
  Note,
  Notification,
  OrganizerApplication,
  OutboxEmail,
  PushSubscription,
  Rating,
  Registration,
  Report,
  User,
  type UserDocument,
} from '../../models';
import { forbidden, unauthenticated } from '../../lib/errors';
import { assertNotDemoAccount } from '../../demo/accounts';
import { cancelEvent } from '../events/events.service';
import { handOverSeat } from '../events/waitlist.service';
import { syncTotals } from '../events/ratings.service';
import { EVENT_STATUS, EVENT_VISIBILITY, REGISTRATION_STATUS } from '../../constants';

/** Everything Sync holds about the user, as one JSON document. */
export async function exportData(user: UserDocument) {
  const [registrations, ownEvents, notes, messages, ratings, notifications, interests, follows, applications, reports, staff] =
    await Promise.all([
      Registration.find({ user: user._id }).populate('event', 'title startsAt endsAt'),
      Event.find({ owner: user._id }).select('-ratingSum -ratingCount'),
      Note.find({ owner: user._id }),
      Message.find({ sender: user._id }).populate('event', 'title'),
      Rating.find({ user: user._id }).populate('event', 'title'),
      Notification.find({ user: user._id }),
      Interest.find({ user: user._id }).populate('event', 'title'),
      Follow.find({ user: user._id }).populate('club', 'name organization'),
      OrganizerApplication.find({ user: user._id }),
      Report.find({ reporter: user._id }).populate('event', 'title'),
      EventStaff.find({ user: user._id }).populate('event', 'title'),
    ]);
  return {
    exportedAt: new Date().toISOString(),
    profile: user.toJSON(),
    registrations,
    eventsCreated: ownEvents,
    eventTeams: staff,
    notes,
    chatMessages: messages,
    ratings,
    notifications,
    interested: interests,
    following: follows,
    organizerApplications: applications,
    reportsFiled: reports,
  };
}

/**
 * Deletes the account and the personal data attached to it. Upcoming public
 * events it owns are cancelled (attendees are told); its own past events
 * stay, as other people's attendance history, without the owner's details.
 */
export async function deleteAccount(user: UserDocument, password: string) {
  assertNotDemoAccount(user.email);
  const account = await User.findById(user._id).select('+passwordHash');
  if (!account || !(await account.checkPassword(password)))
    throw unauthenticated('That password is not right', 'INVALID_PASSWORD');
  if (user.role === 'admin' && (await User.countDocuments({ role: 'admin', _id: { $ne: user._id } })) === 0) {
    throw forbidden('You are the only admin. Make someone else an admin first.', 'LAST_ADMIN');
  }
  const now = new Date();

  // Events they own.
  const owned = await Event.find({ owner: user._id });
  for (const event of owned) {
    const upcoming = event.startsAt > now;
    if (event.visibility === EVENT_VISIBILITY.PUBLIC && event.status === EVENT_STATUS.PUBLISHED && upcoming) {
      await cancelEvent(event, { reason: '', fallback: 'The organiser has closed their account, so this event is cancelled.' });
    } else if (event.status === EVENT_STATUS.DRAFT || event.visibility === EVENT_VISIBILITY.PRIVATE) {
      await Promise.all([
        Registration.deleteMany({ event: event._id }),
        Note.updateMany({ event: event._id }, { $set: { event: null } }),
      ]);
      await event.deleteOne();
    }
  }

  // Places they hold at other people's upcoming events go to the next person.
  const seats = await Registration.find({
    user: user._id,
    status: { $in: [REGISTRATION_STATUS.GOING, REGISTRATION_STATUS.OFFERED] },
  });
  for (const seat of seats) {
    await seat.deleteOne();
    const event = await Event.findById(seat.event);
    if (event && event.endsAt > now) await handOverSeat(event);
  }

  const interests = await Interest.find({ user: user._id });
  for (const i of interests)
    await Event.updateOne({ _id: i.event, interestedCount: { $gt: 0 } }, { $inc: { interestedCount: -1 } });
  const rated = await Rating.find({ user: user._id }).distinct('event');

  await Promise.all([
    Registration.deleteMany({ user: user._id }),
    Interest.deleteMany({ user: user._id }),
    Follow.deleteMany({ $or: [{ user: user._id }, { club: user._id }] }),
    Note.deleteMany({ owner: user._id }),
    Message.deleteMany({ sender: user._id }),
    Notification.deleteMany({ user: user._id }),
    PushSubscription.deleteMany({ user: user._id }),
    OrganizerApplication.deleteMany({ user: user._id }),
    Report.deleteMany({ reporter: user._id }),
    Rating.deleteMany({ user: user._id }),
    EventStaff.deleteMany({ user: user._id }),
    Event.updateMany({ organizers: user._id }, { $pull: { organizers: user._id } }),
    OutboxEmail.deleteMany({ to: user.email, sentAt: null }),
  ]);
  for (const eventId of rated) await syncTotals(String(eventId));
  await User.deleteOne({ _id: user._id });
}
