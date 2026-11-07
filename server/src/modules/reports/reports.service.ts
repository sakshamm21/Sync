/**
 * Event reports: a member flags something, an admin looks at it.
 * Admins can already suspend users, but until now nothing let a member raise
 * a problem in the first place.
 */
import { Report, Event, type UserDocument } from '../../models';
import * as notifications from '../notifications/notifications.service';
import { cancelEvent } from '../events/events.service';
import { paginationMeta, type Page } from '../../lib/schemas';
import { badRequest, notFound } from '../../lib/errors';
import { findViewableEvent } from '../events/events.policy';
import { REPORT_STATUS, EVENT_STATUS, NOTIFICATION_TYPES, type ReportReason, type ReportStatus } from '../../constants';

/** Files or updates a member's report on an event. */
export async function file(user: UserDocument, eventId: string, { reason, details }: { reason: ReportReason; details: string }) {
  const event = await findViewableEvent(user, eventId);
  // Reporting something already cancelled changes nothing.
  if (event.status === EVENT_STATUS.CANCELLED) throw badRequest('This event has already been cancelled');

  const existing = await Report.findOne({ event: event._id, reporter: user.id });
  // An identical report that was already dismissed stays dismissed.
  if (existing && existing.status !== REPORT_STATUS.OPEN && existing.reason === reason) return existing;

  if (existing) {
    existing.reason = reason;
    existing.details = details;
    existing.status = REPORT_STATUS.OPEN;
    existing.reviewedBy = null;
    existing.reviewedAt = null;
    await existing.save();
    return existing;
  }
  return Report.create({ event: event._id, reporter: user._id, reason, details });
}

export async function listReports({ status, page, limit }: Page & { status?: ReportStatus }) {
  const filter = status ? { status } : {};
  const [items, total, open] = await Promise.all([
    Report.find(filter)
      .sort({ status: 1, createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('event', 'title startsAt status category')
      .populate('reporter', 'name email')
      .populate('reviewedBy', 'name'),
    Report.countDocuments(filter),
    Report.countDocuments({ status: REPORT_STATUS.OPEN }),
  ]);

  return {
    items: items.map((r) => {
      const event = r.event as unknown as { id: string; title: string } | null;
      const reporter = r.reporter as unknown as { name: string } | null;
      return {
        id: r.id as string,
        reason: r.reason,
        details: r.details,
        status: r.status,
        createdAt: r.createdAt,
        reviewedAt: r.reviewedAt,
        event: event ? { id: event.id, title: event.title } : null,
        reporter: reporter ? { name: reporter.name } : null,
      };
    }),
    meta: { ...paginationMeta({ page, limit }, total), open },
  };
}

/**
 * Closes a report. Marking it `reviewed` also cancels the event it is about,
 * since that is the action a report almost always ends in. Attendees are told
 * as for any cancellation, and the organiser is told why.
 */
export async function resolve(
  admin: UserDocument,
  id: string,
  { status, reason = '' }: { status: ReportStatus; reason?: string }
) {
  const report = await Report.findById(id);
  if (!report) throw notFound('Report not found');

  report.status = status;
  report.reviewedBy = admin._id;
  report.reviewedAt = new Date();
  await report.save();

  if (status === REPORT_STATUS.REVIEWED && report.event) {
    const event = await Event.findById(report.event);
    if (event && event.status === EVENT_STATUS.PUBLISHED) {
      await cancelEvent(event, { reason, fallback: 'This event has been cancelled by the Sync team.' });
      await notifications.notify(
        event.organizers?.length ? event.organizers : [event.owner],
        {
          type: NOTIFICATION_TYPES.EVENT_CANCELLED,
          title: `Taken down: ${event.title}`,
          body: `An admin cancelled this event after it was reported${reason ? `: ${reason}` : '.'} Attendees have been told.`,
          eventId: event._id,
        },
        { email: true }
      );
    }
  }
  return report;
}

/** How many open reports there are, for the admin dashboard. */
export async function openCount(): Promise<number> {
  return Report.countDocuments({ status: REPORT_STATUS.OPEN });
}
