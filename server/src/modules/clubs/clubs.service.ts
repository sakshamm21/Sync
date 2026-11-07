/**
 * Club pages and following (Roadmap "Now" #5). A club is an organiser
 * account: its page shows who they are, what's coming up, what they've run
 * and how it was rated, and members can follow it to hear about new events.
 */
import type { Types } from 'mongoose';
import { Event, Follow, Sponsor, User, type EventDocument, type UserDocument } from '../../models';
import { notFound, badRequest } from '../../lib/errors';
import { isAllowedWebhook, postEventWebhook } from '../../lib/webhooks';
import { runInBackground } from '../../lib/background';
import { formatCampusTime } from '../../lib/campusTime';
import env from '../../config/env';
import * as notifications from '../notifications/notifications.service';
import { OWNER_FIELDS, withViewerContext, type Viewer } from '../events/events.policy';
import { EVENT_STATUS, EVENT_VISIBILITY, NOTIFICATION_TYPES, ROLES, USER_STATUS, type Category } from '../../constants';

const CLUB_ROLES = [ROLES.ORGANIZER, ROLES.ADMIN];

async function findClub(id: string) {
  const club = await User.findOne({ _id: id, role: { $in: CLUB_ROLES }, status: { $ne: USER_STATUS.SUSPENDED } });
  if (!club) throw notFound('Club not found');
  return club;
}

/** Everything the club page shows. */
export async function profile(viewer: Viewer, id: string) {
  const club = await findClub(id);
  const now = new Date();
  const listed = {
    visibility: EVENT_VISIBILITY.PUBLIC,
    status: { $in: [EVENT_STATUS.PUBLISHED] },
    $or: [{ owner: club._id }, { organizers: club._id }],
  };
  const [upcoming, past, followers, following, rated] = await Promise.all([
    Event.find({ ...listed, endsAt: { $gte: now } })
      .sort({ startsAt: 1 })
      .limit(24)
      .populate('owner', OWNER_FIELDS),
    Event.find({ ...listed, endsAt: { $lt: now } })
      .sort({ startsAt: -1 })
      .limit(12)
      .populate('owner', OWNER_FIELDS),
    Follow.countDocuments({ club: club._id }),
    viewer ? Follow.exists({ club: club._id, user: viewer.id }) : null,
    Event.aggregate<{ sum: number; count: number }>([
      { $match: { owner: club._id, ratingCount: { $gt: 0 } } },
      { $group: { _id: null, sum: { $sum: '$ratingSum' }, count: { $sum: '$ratingCount' } } },
    ]),
  ]);
  const totals = rated[0];
  return {
    id: club.id as string,
    name: club.organization || club.name,
    contactName: club.organization ? club.name : null,
    bio: club.bio,
    avatarUrl: club.avatarUrl,
    followers,
    following: Boolean(following),
    averageRating: totals?.count ? Math.round((totals.sum / totals.count) * 10) / 10 : null,
    ratingCount: totals?.count ?? 0,
    sponsors: (await Sponsor.find({ club: club._id }).sort({ tier: 1, name: 1 })).map((s) => ({
      id: s.id as string,
      name: s.name,
      url: s.url,
      logoUrl: s.logoUrl,
      tier: s.tier,
    })),
    upcoming: await withViewerContext(upcoming, viewer),
    past: await withViewerContext(past, viewer),
  };
}

export async function setFollowing(user: UserDocument, id: string, follow: boolean) {
  const club = await findClub(id);
  if (club._id.equals(user._id)) throw badRequest("You can't follow yourself", 'SELF_FOLLOW');
  if (follow)
    await Follow.updateOne(
      { user: user._id, club: club._id },
      { $setOnInsert: { user: user._id, club: club._id } },
      { upsert: true }
    );
  else await Follow.deleteOne({ user: user._id, club: club._id });
  return { following: follow, followers: await Follow.countDocuments({ club: club._id }) };
}

/** Clubs worth following for someone with these interests: most upcoming events in those categories first. */
export async function suggestions(user: UserDocument, interests: Category[], limit = 6) {
  const followed = await Follow.find({ user: user._id }).distinct('club');
  const match = {
    visibility: EVENT_VISIBILITY.PUBLIC,
    status: EVENT_STATUS.PUBLISHED,
    endsAt: { $gte: new Date() },
    owner: { $nin: [...followed, user._id] },
    ...(interests.length ? { category: { $in: interests } } : {}),
  };
  const ranked = await Event.aggregate<{ _id: Types.ObjectId; events: number }>([
    { $match: match },
    { $group: { _id: '$owner', events: { $sum: 1 } } },
    { $sort: { events: -1 } },
    { $limit: limit },
  ]);
  const clubs = await User.find({ _id: { $in: ranked.map((r) => r._id) }, status: { $ne: USER_STATUS.SUSPENDED } }).select(
    'name organization avatarUrl bio'
  );
  const byId = new Map(clubs.map((c) => [String(c._id), c]));
  return ranked
    .filter((r) => byId.has(String(r._id)))
    .map((r) => {
      const c = byId.get(String(r._id))!;
      return { id: c.id as string, name: c.organization || c.name, avatarUrl: c.avatarUrl, bio: c.bio, upcomingEvents: r.events };
    });
}

/** Tells a club's followers about a newly published event (in the app and by push; no email). */
export async function announceNewEvent(event: EventDocument) {
  if (event.visibility !== EVENT_VISIBILITY.PUBLIC || event.status !== EVENT_STATUS.PUBLISHED) return;
  // `owner` may be populated or a bare id depending on how the event was loaded.
  const ownerId = (event.owner as unknown as { _id?: Types.ObjectId })?._id ?? event.owner;
  const owner = await User.findById(ownerId).select('name organization +announceWebhookUrl');
  // The club's own Discord or Slack hears about it too, in the background.
  if (owner?.announceWebhookUrl) {
    const url = owner.announceWebhookUrl;
    runInBackground('club-webhook', () =>
      postEventWebhook(url, {
        title: event.title,
        when: formatCampusTime(event.startsAt),
        where: event.venue?.name ?? '',
        link: `${env.clientUrl}/events/${event.id}`,
        host: owner.organization || owner.name,
      })
    );
  }
  const followers = await Follow.find({ club: ownerId }).distinct('user');
  if (!followers.length) return;
  await notifications.notify(followers, {
    type: NOTIFICATION_TYPES.CLUB_NEW_EVENT,
    title: `New from ${owner?.organization || owner?.name || 'a club you follow'}: ${event.title}`,
    body: 'Tap to see the details and grab a spot.',
    eventId: event._id,
  });
}

/** Sets or clears the club's Discord/Slack webhook. */
export async function setWebhook(user: UserDocument, url: string) {
  if (user.role !== ROLES.ORGANIZER && user.role !== ROLES.ADMIN) throw badRequest('Only club accounts can connect a channel');
  if (url && !isAllowedWebhook(url)) throw badRequest('Paste a Discord or Slack incoming-webhook URL', 'BAD_WEBHOOK');
  await User.updateOne({ _id: user._id }, { $set: { announceWebhookUrl: url } });
  return { connected: Boolean(url) };
}

export async function webhookStatus(user: UserDocument) {
  const me = await User.findById(user._id).select('+announceWebhookUrl');
  const url = me?.announceWebhookUrl ?? '';
  return { connected: Boolean(url), kind: url.includes('slack') ? 'slack' : url ? 'discord' : null };
}
