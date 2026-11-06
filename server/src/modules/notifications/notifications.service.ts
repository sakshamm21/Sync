import type { Types } from 'mongoose';
import { Notification, User, type UserDocument } from '../../models';
import env from '../../config/env';
import { notFound } from '../../lib/errors';
import { emitToUser } from '../../lib/realtime';
import { queueMail } from '../../jobs/outbox';
import * as emails from '../../lib/emailTemplates';
import { paginationMeta, type Page } from '../../lib/schemas';
import type { NotificationType } from '../../constants';

type Id = Types.ObjectId | string;

export interface NotificationInput {
  type: NotificationType;
  title: string;
  body?: string;
  eventId?: Id | null;
}

/**
 * Creates an in-app notification for each user, pushes it over the socket,
 * and (when `email` is set) queues an email for users who opted in.
 *
 * The email is queued rather than sent, so a burst of notifications — a
 * cancelled event with 200 attendees, say — returns immediately instead of
 * holding the request open for 200 SMTP round trips.
 */
export async function notify(
  userIds: Id[],
  { type, title, body = '', eventId = null }: NotificationInput,
  { email = false }: { email?: boolean } = {}
): Promise<void> {
  const recipients = [...new Set(userIds.map(String))];
  if (!recipients.length) return;

  const docs = await Notification.insertMany(
    recipients.map((user) => ({ user, type, title, body, event: eventId }))
  );
  for (const doc of docs) emitToUser(doc.user, 'notification:new', doc.toJSON());

  if (!email) return;
  // Suspended accounts keep their in-app history but get no more email.
  const users = await User.find({
    _id: { $in: recipients },
    'preferences.emailNotifications': true,
    status: { $ne: 'suspended' },
  }).select('name email');
  const url = eventId ? `${env.clientUrl}/events/${eventId}` : env.clientUrl;
  await queueMail(...users.map((u) => ({ to: u.email, ...emails.notification({ name: u.name, title, body, url }) })));
}

export async function list(user: UserDocument, { unreadOnly, page, limit }: Page & { unreadOnly: boolean }) {
  const filter = { user: user.id, ...(unreadOnly ? { readAt: null } : {}) };
  const [items, total, unread] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    Notification.countDocuments(filter),
    Notification.countDocuments({ user: user.id, readAt: null }),
  ]);
  return { items, meta: { ...paginationMeta({ page, limit }, total), unread } };
}

export async function markRead(user: UserDocument, id: string) {
  const notification = await Notification.findOneAndUpdate(
    { _id: id, user: user.id },
    { $set: { readAt: new Date() } },
    { new: true }
  );
  if (!notification) throw notFound('Notification not found');
  return notification;
}

export async function markAllRead(user: UserDocument) {
  const { modifiedCount } = await Notification.updateMany({ user: user.id, readAt: null }, { $set: { readAt: new Date() } });
  return { updated: modifiedCount };
}
