import { ChatRead, Message, MessageReport, Registration, type UserDocument } from '../../models';
import { audit } from '../../lib/audit';
import { badRequest, forbidden, notFound } from '../../lib/errors';
import { emitToEvent } from '../../lib/realtime';
import * as notifications from '../notifications/notifications.service';
import { findViewableEvent, canChat, accessFor, staffRoleFor } from '../events/events.policy';
import { NOTIFICATION_TYPES, REPORT_STATUS, type ReportReason, type ReportStatus } from '../../constants';

const SENDER_FIELDS = 'name avatarUrl role';
/** The quoted message shown above a reply. */
const REPLY_POPULATE = { path: 'replyTo', select: 'text sender removedAt', populate: { path: 'sender', select: 'name' } };

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
      .populate('sender', SENDER_FIELDS)
      .populate(REPLY_POPULATE);
    return { items: newer.slice(0, limit), hasMore: newer.length > limit };
  }

  const messages = await Message.find({ event: event._id, ...(before ? cursorFilter(before, '$lt') : {}) })
    .sort({ _id: -1 })
    .limit(limit)
    .populate('sender', SENDER_FIELDS)
    .populate(REPLY_POPULATE);
  return { items: messages.reverse(), hasMore: messages.length === limit };
}

export type AnnouncementAudience = 'all' | 'going' | 'waitlisted';

export async function postMessage(
  user: UserDocument,
  eventId: string,
  {
    text,
    announcement,
    audience = 'all',
    replyTo,
  }: { text: string; announcement: boolean; audience?: AnnouncementAudience; replyTo?: string }
) {
  const event = await findChatEvent(user, eventId);
  // Announcements notify and email everyone, so door staff may not send them.
  if (announcement && !accessFor(user, event, await staffRoleFor(user, event)).canManage) {
    throw forbidden('Only the organiser can post announcements');
  }

  // A reply must point at a message in the same chat.
  const parent = replyTo ? await Message.findOne({ _id: replyTo, event: event._id }).select('_id') : null;
  if (replyTo && !parent) throw badRequest('That message is not in this chat');
  const message = await Message.create({
    event: event._id,
    sender: user._id,
    text,
    isAnnouncement: announcement,
    replyTo: parent?._id ?? null,
  });
  await message.populate('sender', SENDER_FIELDS);
  await message.populate(REPLY_POPULATE);
  await markRead(user, event._id);
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

/**
 * Removes a message: the sender can remove their own, organisers (managers)
 * anything in their event's chat, admins anything. The message keeps its
 * place in the thread as "Message removed" so replies still make sense.
 */
export async function removeMessage(user: UserDocument, eventId: string, messageId: string) {
  const event = await findViewableEvent(user, eventId);
  const message = await Message.findOne({ _id: messageId, event: event._id });
  if (!message) throw notFound('Message not found');
  const isSender = String(message.sender) === String(user._id);
  const canModerate = user.role === 'admin' || accessFor(user, event, await staffRoleFor(user, event)).canManage;
  if (!isSender && !canModerate) throw forbidden('Only the organiser or the sender can remove this message');
  if (!message.removedAt) {
    message.text = '';
    message.removedAt = new Date();
    await message.save();
    if (!isSender && user.role === 'admin') {
      await audit(user, 'message.removed', `Removed a chat message in "${event.title}"`, { kind: 'event', id: event._id });
    }
  }
  emitToEvent(event._id, 'message:removed', { id: message.id, event: String(event._id) });
  return { id: message.id as string, removedAt: message.removedAt };
}

/** A member reports a message to the admins. One report per person per message. */
export async function reportMessage(
  user: UserDocument,
  eventId: string,
  messageId: string,
  { reason, details }: { reason: ReportReason; details: string }
) {
  const event = await findChatEvent(user, eventId);
  const message = await Message.findOne({ _id: messageId, event: event._id, removedAt: null });
  if (!message) throw notFound('Message not found');
  if (String(message.sender) === String(user._id)) throw badRequest("You can't report your own message");
  await MessageReport.updateOne(
    { message: message._id, reporter: user._id },
    { $set: { event: event._id, reason, details, status: REPORT_STATUS.OPEN, reviewedBy: null, reviewedAt: null } },
    { upsert: true }
  );
  return { reported: true };
}

/** The admin queue of reported messages. */
export async function listMessageReports({ status }: { status?: ReportStatus }) {
  const reports = await MessageReport.find(status ? { status } : {})
    .sort({ status: 1, createdAt: -1 })
    .limit(100)
    .populate<{ message: { id: string; text: string; removedAt: Date | null; sender: unknown } | null }>({
      path: 'message',
      select: 'text removedAt sender',
      populate: { path: 'sender', select: 'name' },
    })
    .populate<{ event: { id: string; title: string } | null }>('event', 'title')
    .populate<{ reporter: { name: string } | null }>('reporter', 'name');
  return reports.map((r) => ({
    id: r.id as string,
    reason: r.reason,
    details: r.details,
    status: r.status,
    createdAt: r.createdAt,
    event: r.event ? { id: r.event.id, title: r.event.title } : null,
    reporter: r.reporter ? { name: r.reporter.name } : null,
    message: r.message
      ? {
          id: r.message.id,
          text: r.message.text,
          removed: Boolean(r.message.removedAt),
          sender: (r.message.sender as { name?: string } | null)?.name ?? null,
        }
      : null,
  }));
}

/** `reviewed` removes the message; `dismissed` leaves it. */
export async function resolveMessageReport(admin: UserDocument, id: string, status: ReportStatus) {
  const report = await MessageReport.findById(id);
  if (!report) throw notFound('Report not found');
  report.status = status;
  report.reviewedBy = admin._id;
  report.reviewedAt = new Date();
  await report.save();
  if (status === REPORT_STATUS.REVIEWED) {
    const message = await Message.findById(report.message);
    if (message && !message.removedAt) {
      message.text = '';
      message.removedAt = new Date();
      await message.save();
      emitToEvent(message.event, 'message:removed', { id: message.id, event: String(message.event) });
    }
    await audit(admin, 'message.removed', 'Removed a reported chat message', { kind: 'report', id: report._id });
  } else {
    await audit(admin, 'report.dismissed', 'Dismissed a chat message report', { kind: 'report', id: report._id });
  }
  return { id: report.id as string, status: report.status };
}

/** The emoji people can react with: a small set keeps it light and readable. */
export const REACTIONS = ['👍', '❤️', '😂', '🎉', '😮', '🙏'] as const;

/** Adds the user's reaction, or takes it away if it's already there. */
export async function toggleReaction(user: UserDocument, eventId: string, messageId: string, emoji: string) {
  const event = await findChatEvent(user, eventId);
  const message = await Message.findOne({ _id: messageId, event: event._id, removedAt: null });
  if (!message) throw notFound('Message not found');
  const mine = message.reactions.findIndex((r) => r.emoji === emoji && String(r.user) === String(user._id));
  if (mine >= 0) message.reactions.splice(mine, 1);
  else message.reactions.push({ emoji, user: user._id });
  await message.save();
  const payload = { id: message.id as string, event: String(event._id), reactions: message.reactions };
  emitToEvent(event._id, 'message:reactions', payload);
  return payload;
}

/** Marks everything in the chat up to now as read for the user. */
export async function markRead(user: UserDocument, eventId: unknown) {
  await ChatRead.updateOne({ user: user._id, event: eventId }, { $set: { readAt: new Date() } }, { upsert: true });
}

/** Unread message counts per chat the user is in (announcements included, their own excluded). */
export async function unreadCounts(user: UserDocument, eventIds: string[]) {
  if (!eventIds.length) return {};
  const reads = await ChatRead.find({ user: user._id, event: { $in: eventIds } });
  const readAt = new Map(reads.map((r) => [String(r.event), r.readAt]));
  const counts = await Promise.all(
    eventIds.map(async (id) => {
      const since = readAt.get(id);
      const n = await Message.countDocuments({
        event: id,
        sender: { $ne: user._id },
        removedAt: null,
        ...(since ? { createdAt: { $gt: since } } : {}),
      });
      return [id, n] as const;
    })
  );
  return Object.fromEntries(counts);
}
