/**
 * Friends (Roadmap "Next" #7). Requests go by exact email, so nobody can
 * browse the user list; both sides must agree before either sees the
 * other's plans.
 */
import type { Types } from 'mongoose';
import { Friendship, User, type UserDocument } from '../../models';
import { badRequest, notFound } from '../../lib/errors';
import * as notifications from '../notifications/notifications.service';
import { NOTIFICATION_TYPES, USER_STATUS } from '../../constants';

/** Ids of everyone the user is friends with (accepted, either direction). */
export async function friendIdsOf(userId: Types.ObjectId | string): Promise<Types.ObjectId[]> {
  const rows = await Friendship.find({ status: 'accepted', $or: [{ from: userId }, { to: userId }] }).select('from to');
  return rows.map((r) => (String(r.from) === String(userId) ? r.to : r.from));
}

export async function request(user: UserDocument, email: string) {
  const other = await User.findOne({ email: email.toLowerCase(), status: { $ne: USER_STATUS.SUSPENDED } });
  // The same answer whether or not the address exists, so this can't be used to probe for accounts.
  if (!other || other._id.equals(user._id)) return { sent: true };
  const existing = await Friendship.findOne({
    $or: [
      { from: user._id, to: other._id },
      { from: other._id, to: user._id },
    ],
  });
  if (existing) {
    // They had already asked us: asking back accepts.
    if (existing.status === 'pending' && existing.to.equals(user._id)) {
      existing.status = 'accepted';
      await existing.save();
    }
    return { sent: true };
  }
  await Friendship.create({ from: user._id, to: other._id });
  await notifications.notify([other._id], {
    type: NOTIFICATION_TYPES.FRIEND_REQUEST,
    title: `${user.name} wants to be friends on Sync`,
    body: 'Accept to see which events each other is going to.',
  });
  return { sent: true };
}

export async function respond(user: UserDocument, requestId: string, accept: boolean) {
  const row = await Friendship.findOne({ _id: requestId, to: user._id, status: 'pending' });
  if (!row) throw notFound('Friend request not found');
  if (accept) {
    row.status = 'accepted';
    await row.save();
    await notifications.notify([row.from], {
      type: NOTIFICATION_TYPES.FRIEND_REQUEST,
      title: `${user.name} accepted your friend request`,
      body: "You'll now see events you're both going to.",
    });
  } else {
    await row.deleteOne();
  }
  return list(user);
}

export async function remove(user: UserDocument, friendId: string) {
  const removed = await Friendship.deleteOne({
    $or: [
      { from: user._id, to: friendId },
      { from: friendId, to: user._id },
    ],
  });
  if (!removed.deletedCount) throw badRequest('You are not friends');
  return list(user);
}

/** Friends, requests waiting for you, and requests you sent. */
export async function list(user: UserDocument) {
  const rows = await Friendship.find({ $or: [{ from: user._id }, { to: user._id }] })
    .populate<{ from: { id: string; name: string; avatarUrl: string } }>('from', 'name avatarUrl')
    .populate<{ to: { id: string; name: string; avatarUrl: string } }>('to', 'name avatarUrl')
    .sort({ updatedAt: -1 });
  const person = (p: { id: string; name: string; avatarUrl: string } | null) =>
    p ? { id: p.id, name: p.name, avatarUrl: p.avatarUrl } : null;
  return {
    friends: rows
      .filter((r) => r.status === 'accepted')
      .map((r) => ({ id: r.id as string, user: person(String(r.from?.id) === user.id ? r.to : r.from) })),
    incoming: rows
      .filter((r) => r.status === 'pending' && String(r.to?.id) === user.id)
      .map((r) => ({ id: r.id as string, user: person(r.from) })),
    outgoing: rows
      .filter((r) => r.status === 'pending' && String(r.from?.id) === user.id)
      .map((r) => ({ id: r.id as string, user: person(r.to) })),
  };
}
