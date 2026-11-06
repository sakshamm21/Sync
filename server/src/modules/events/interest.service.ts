/** "Interested" bookmarks (Roadmap: separate from "I'm in"). */
import { Event, Interest, type UserDocument } from '../../models';
import { badRequest } from '../../lib/errors';
import { loadEvent, present } from './events.policy';
import { EVENT_STATUS, EVENT_VISIBILITY } from '../../constants';

export async function markInterested(user: UserDocument, eventId: string, interested: boolean) {
  const { event } = await loadEvent(user, eventId);
  if (event.visibility !== EVENT_VISIBILITY.PUBLIC || event.status !== EVENT_STATUS.PUBLISHED) {
    throw badRequest('Only published public events can be bookmarked', 'NOT_BOOKMARKABLE');
  }
  if (interested) {
    // Upsert so a double tap can't count twice; only a new row bumps the count.
    const result = await Interest.updateOne(
      { event: event._id, user: user._id },
      { $setOnInsert: { event: event._id, user: user._id } },
      { upsert: true }
    );
    if (result.upsertedCount) await Event.updateOne({ _id: event._id }, { $inc: { interestedCount: 1 } });
  } else {
    const removed = await Interest.deleteOne({ event: event._id, user: user._id });
    if (removed.deletedCount) {
      await Event.updateOne({ _id: event._id, interestedCount: { $gt: 0 } }, { $inc: { interestedCount: -1 } });
    }
  }
  const fresh = await loadEvent(user, eventId);
  return present(fresh.event, user);
}
