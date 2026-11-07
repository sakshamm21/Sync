import type { FilterQuery } from 'mongoose';
import {
  User,
  Event,
  Registration,
  OrganizerApplication,
  Report,
  type IOrganizerApplication,
  type IUser,
  type UserDocument,
} from '../../models';
import { badRequest, notFound, conflict } from '../../lib/errors';
import { escapeRegex, paginationMeta, type Page } from '../../lib/schemas';
import * as notifications from '../notifications/notifications.service';
import { assertNotDemoAccount } from '../../demo/accounts';
import { audit } from '../../lib/audit';
import { AuditLog } from '../../models';
import {
  ROLES,
  USER_STATUS,
  EVENT_VISIBILITY,
  EVENT_STATUS,
  ORGANIZER_APPLICATION_STATUS,
  REPORT_STATUS,
  NOTIFICATION_TYPES,
  type OrganizerApplicationStatus,
  type Role,
  type UserStatus,
} from '../../constants';

/** New sign-ups, RSVPs and events per week for the last 8 weeks (Roadmap "Next" #9). */
async function weeklyTrends(now: Date) {
  const WEEK = 7 * 24 * 60 * 60 * 1000;
  const since = new Date(now.getTime() - 8 * WEEK);
  const bucket = (field: string) => ({ $floor: { $divide: [{ $subtract: [field, since] }, WEEK] } });
  const count = (model: typeof User | typeof Registration | typeof Event, match: Record<string, unknown> = {}) =>
    (model as typeof User).aggregate<{ _id: number; count: number }>([
      { $match: { createdAt: { $gte: since }, ...match } },
      { $group: { _id: bucket('$createdAt'), count: { $sum: 1 } } },
    ]);
  const [users, rsvps, events, activeClubs] = await Promise.all([
    count(User),
    count(Registration),
    count(Event, { visibility: EVENT_VISIBILITY.PUBLIC }),
    // Clubs that published at least one event that week.
    Event.aggregate<{ _id: number; count: number }>([
      { $match: { createdAt: { $gte: since }, visibility: EVENT_VISIBILITY.PUBLIC } },
      { $group: { _id: { week: bucket('$createdAt'), owner: '$owner' } } },
      { $group: { _id: '$_id.week', count: { $sum: 1 } } },
    ]),
  ]);
  const series = (rows: { _id: number; count: number }[]) => {
    const out = Array.from({ length: 8 }, () => 0);
    for (const r of rows) if (r._id >= 0 && r._id < 8) out[r._id] = r.count;
    return out;
  };
  return {
    weekStarts: Array.from({ length: 8 }, (_, i) => new Date(since.getTime() + i * WEEK)),
    newUsers: series(users),
    rsvps: series(rsvps),
    events: series(events),
    activeClubs: series(activeClubs),
  };
}

export async function stats() {
  const now = new Date();
  const publicEvents = { visibility: EVENT_VISIBILITY.PUBLIC };
  const [usersByRole, suspended, upcomingEvents, totalEvents, registrations, pendingApplications, openReports] =
    await Promise.all([
      User.aggregate<{ _id: Role; count: number }>([{ $group: { _id: '$role', count: { $sum: 1 } } }]),
      User.countDocuments({ status: USER_STATUS.SUSPENDED }),
      Event.countDocuments({ ...publicEvents, status: EVENT_STATUS.PUBLISHED, endsAt: { $gte: now } }),
      Event.countDocuments(publicEvents),
      Registration.countDocuments(),
      OrganizerApplication.countDocuments({ status: ORGANIZER_APPLICATION_STATUS.PENDING }),
      Report.countDocuments({ status: REPORT_STATUS.OPEN }),
    ]);

  const roles = Object.fromEntries(Object.values(ROLES).map((r) => [r, 0])) as Record<Role, number>;
  for (const { _id, count } of usersByRole) roles[_id] = count;

  return {
    trends: await weeklyTrends(now),
    users: { total: Object.values(roles).reduce((a, b) => a + b, 0), byRole: roles, suspended },
    events: { total: totalEvents, upcoming: upcomingEvents },
    registrations,
    pendingApplications,
    openReports,
  };
}

export async function listUsers({ q, role, status, page, limit }: Page & { q?: string; role?: Role; status?: UserStatus }) {
  const filter: FilterQuery<IUser> = {};
  if (role) filter.role = role;
  if (status) filter.status = status;
  if (q) {
    const pattern = new RegExp(escapeRegex(q), 'i');
    filter.$or = [{ name: pattern }, { email: pattern }, { organization: pattern }];
  }
  const [items, total] = await Promise.all([
    User.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    User.countDocuments(filter),
  ]);
  return { items, meta: paginationMeta({ page, limit }, total) };
}

export async function updateUser(
  admin: UserDocument,
  userId: string,
  { role, status, reason }: { role?: Role; status?: UserStatus; reason?: string }
) {
  // Prevents an admin from accidentally locking themselves (or everyone) out.
  if (String(admin._id) === String(userId)) throw badRequest('You cannot change your own role or status');

  const user = await User.findById(userId);
  if (!user) throw notFound('User not found');
  assertNotDemoAccount(user.email);
  const before = { role: user.role, status: user.status };
  if (role) user.role = role;
  if (status) user.status = status;
  if (status) user.suspensionReason = status === USER_STATUS.SUSPENDED ? (reason ?? '') : '';
  await user.save();
  if (role && role !== before.role) {
    await audit(admin, 'user.role_changed', `Changed ${user.name}'s role from ${before.role} to ${role}`, {
      kind: 'user',
      id: user._id,
    });
  }
  if (status && status !== before.status) {
    await audit(
      admin,
      status === 'suspended' ? 'user.suspended' : 'user.reactivated',
      `${status === 'suspended' ? 'Suspended' : 'Reactivated'} ${user.name}${status === 'suspended' && reason ? `: ${reason}` : ''}`,
      {
        kind: 'user',
        id: user._id,
      }
    );
  }
  return user;
}

/** The newest admin actions first. */
export async function auditLog({ page, limit }: Page) {
  const [items, total] = await Promise.all([
    AuditLog.find({})
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('actor', 'name avatarUrl'),
    AuditLog.countDocuments({}),
  ]);
  return { items, meta: paginationMeta({ page, limit }, total) };
}

export async function listApplications({ status, page, limit }: Page & { status?: OrganizerApplicationStatus }) {
  const filter: FilterQuery<IOrganizerApplication> = status ? { status } : {};
  const [items, total] = await Promise.all([
    OrganizerApplication.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('user', 'name email avatarUrl role')
      .populate('reviewedBy', 'name'),
    OrganizerApplication.countDocuments(filter),
  ]);
  return { items, meta: paginationMeta({ page, limit }, total) };
}

export async function reviewApplication(admin: UserDocument, id: string, { approve, note }: { approve: boolean; note: string }) {
  const application = await OrganizerApplication.findById(id);
  if (!application) throw notFound('Application not found');
  if (application.status !== ORGANIZER_APPLICATION_STATUS.PENDING) throw conflict('This application has already been reviewed');

  application.status = approve ? ORGANIZER_APPLICATION_STATUS.APPROVED : ORGANIZER_APPLICATION_STATUS.REJECTED;
  application.reviewedBy = admin._id;
  application.reviewedAt = new Date();
  application.reviewNote = note;
  await application.save();
  await audit(
    admin,
    approve ? 'application.approved' : 'application.rejected',
    `${approve ? 'Approved' : 'Rejected'} the organiser application for ${application.organization}${note ? `: ${note}` : ''}`,
    { kind: 'application', id: application._id }
  );

  if (approve) {
    await User.updateOne(
      { _id: application.user, role: ROLES.MEMBER },
      { $set: { role: ROLES.ORGANIZER, organization: application.organization } }
    );
  }

  await notifications.notify(
    [application.user],
    approve
      ? {
          type: NOTIFICATION_TYPES.ORGANIZER_APPROVED,
          title: 'You are now an organiser',
          body: `Your application for ${application.organization} was approved. You can now publish public events.`,
        }
      : {
          type: NOTIFICATION_TYPES.ORGANIZER_REJECTED,
          title: 'Organiser application update',
          body: note || 'Your application was not approved this time.',
        },
    { email: true }
  );

  await application.populate([
    { path: 'user', select: 'name email avatarUrl role' },
    { path: 'reviewedBy', select: 'name' },
  ]);
  return application;
}
