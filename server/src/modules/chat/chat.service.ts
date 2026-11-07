import { Message, Registration, type UserDocument } from '../../models';
import { forbidden } from '../../lib/errors';
import { emitToEvent } from '../../lib/realtime';
import * as notifications from '../notifications/notifications.service';
import { findViewableEvent, canChat, accessFor, staffRoleFor } from '../events/events.policy';
import { NOTIFICATION_TYPES } from '../../constants';

const SENDER_FIELDS = 'name avatarUrl role';

export async function findChatEvent(user: UserDocument, eventId: string) {
  const event = await findViewableEvent(user, eventId);
  const registration = await Registration.findOne({ event: event._id, user: user.id }).select('status');
  if (!canChat(user, event, registration?.status)) {
    throw forbidden('Register for this event to join its discussion', 'CHAT_FORBIDDEN');
  }
  return event;
}

/** A page cursor: a message id (exact) or, from older clients, a time. */
export type MessageCursor = string | Date;

/** ObjectIds grow with time, so paging by `_id` keeps order without skipping messages sent in the same millisecond. */
const cursorFilter = (cursor: MessageCursor, op: '$gt' | '$lt') =>
  cursor instanceof Date ? { createdAt: { [op]: cursor } } : { _id: { [op]: cursor } };

/**
 * Messages for display, oldest-first.
 * - `before`: the newest `limit` messages older than the cursor (scrolling back).
 * - `after`: messages newer than the cursor (polling for new ones).
 */
export async function listMessages(
  user: UserDocument,
  eventId: string,
  { before, after, limit }: { before?: MessageCursor; after?: MessageCursor; limit: number }
) {
  const event = await findChatEvent(user, eventId);

  if (after) {
    const newer = await Message.find({ event: event._id, ...cursorFilter(after, '$gt') })
      .sort({ _id: 1 })
      .limit(limit + 1)
      .populate('sender', SENDER_FIELDS);
    return { items: newer.slice(0, limit), hasMore: newer.length > limit };
  }

  const messages = await Message.find({ event: event._id, ...(before ? cursorFilter(before, '$lt') : {}) })
    .sort({ _id: -1 })
    .limit(limit)
    .populate('sender', SENDER_FIELDS);
  return { items: messages.reverse(), hasMore: messages.length === limit };
}

export type AnnouncementAudience = 'all' | 'going' | 'waitlisted';

export async function postMessage(
  user: UserDocument,
  eventId: string,
  { text, announcement, audience = 'all' }: { text: string; announcement: boolean; audience?: AnnouncementAudience }
) {
  const event = await findChatEvent(user, eventId);
  // Announcements notify and email everyone, so door staff may not send them.
  if (announcement && !accessFor(user, event, await staffRoleFor(user, event)).canManage) {
    throw forbidden('Only the organiser can post announcements');
  }

  const message = await Message.create({ event: event._id, sender: user._id, text, isAnnouncement: announcement });
  await message.populate('sender', SENDER_FIELDS);
  const json = message.toJSON();
  emitToEvent(event._id, 'message:new', json);

  if (announcement) {
    // "Going only" for door times, "waitlist only" for "a few spots may open".
    const status = audience === 'all' ? {} : { status: audience };
    const attendees = await Registration.find({ event: event._id, user: { $ne: user._id }, ...status }).distinct('user');
    await notifications.notify(
      attendees,
      { type: NOTIFICATION_TYPES.ANNOUNCEMENT, title: `${event.title}: announcement`, body: text, eventId: event._id },
      { email: true }
    );
  }
  return json;
}
