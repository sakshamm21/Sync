/** Volunteer shifts, sponsors and event budgets (Roadmap "Later" #6). */
import { BudgetLine, Event, EventStaff, Shift, Sponsor, type UserDocument } from '../../models';
import { badRequest, forbidden, notFound } from '../../lib/errors';
import { loadEvent } from '../events/events.policy';
import { ROLES } from '../../constants';

async function managed(user: UserDocument, eventId: string) {
  const { event, access } = await loadEvent(user, eventId);
  if (!access.canManage) throw forbidden('Only the organisers can do that');
  return event;
}

// --- Shifts: organisers post them; anyone on the event's team signs up. -----

async function presentShifts(eventId: unknown) {
  const shifts = await Shift.find({ event: eventId })
    .sort({ startsAt: 1 })
    .populate<{ volunteers: { id: string; name: string }[] }>('volunteers', 'name');
  return shifts.map((s) => ({
    id: s.id as string,
    title: s.title,
    startsAt: s.startsAt,
    endsAt: s.endsAt,
    slots: s.slots,
    volunteers: s.volunteers.map((v) => ({ id: v.id, name: v.name })),
  }));
}

export async function listShifts(user: UserDocument, eventId: string) {
  const { event, access } = await loadEvent(user, eventId);
  if (!access.canCheckIn) throw forbidden('Shifts are for the event team');
  return presentShifts(event._id);
}

export async function addShift(
  user: UserDocument,
  eventId: string,
  body: { title: string; startsAt: Date; endsAt: Date; slots: number }
) {
  const event = await managed(user, eventId);
  if (body.endsAt <= body.startsAt) throw badRequest('A shift must end after it starts');
  await Shift.create({ ...body, event: event._id });
  return presentShifts(event._id);
}

export async function removeShift(user: UserDocument, eventId: string, shiftId: string) {
  const event = await managed(user, eventId);
  await Shift.deleteOne({ _id: shiftId, event: event._id });
  return presentShifts(event._id);
}

/** Sign up for (or drop) a shift. Only the event's team can volunteer; full shifts refuse. */
export async function setVolunteering(user: UserDocument, eventId: string, shiftId: string, join: boolean) {
  const { event, access } = await loadEvent(user, eventId);
  if (!access.canCheckIn) throw forbidden('Join the event team (or the club committee) to volunteer');
  if (join) {
    const shift = await Shift.findOne({ _id: shiftId, event: event._id });
    if (!shift) throw notFound('Shift not found');
    const updated = await Shift.findOneAndUpdate(
      { _id: shiftId, event: event._id, volunteers: { $ne: user._id }, [`volunteers.${shift.slots - 1}`]: { $exists: false } },
      { $push: { volunteers: user._id } }
    );
    if (!updated && !shift.volunteers.some((v) => v.equals(user._id))) throw badRequest('That shift is full', 'SHIFT_FULL');
  } else {
    await Shift.updateOne({ _id: shiftId, event: event._id }, { $pull: { volunteers: user._id } });
  }
  return presentShifts(event._id);
}

// --- Sponsors: the club lists who supports it; shown on its page. ----------

export const listSponsors = (clubId: string) =>
  Sponsor.find({ club: clubId }).sort({ tier: 1, name: 1 }).collation({ locale: 'en' });

export async function addSponsor(
  user: UserDocument,
  body: { name: string; url: string; logoUrl: string; tier: 'title' | 'gold' | 'partner' }
) {
  if (user.role !== ROLES.ORGANIZER && user.role !== ROLES.ADMIN) throw forbidden('Only club accounts have sponsors');
  await Sponsor.create({ ...body, club: user._id });
  return listSponsors(user.id);
}

export async function removeSponsor(user: UserDocument, id: string) {
  await Sponsor.deleteOne({ _id: id, club: user._id });
  return listSponsors(user.id);
}

// --- Budget: income and expenses for one event, managers only. -------------

async function presentBudget(eventId: unknown) {
  const lines = await BudgetLine.find({ event: eventId })
    .sort({ createdAt: 1 })
    .populate<{ addedBy: { name: string } | null }>('addedBy', 'name');
  const income = lines.filter((l) => l.kind === 'income').reduce((n, l) => n + l.amount, 0);
  const expense = lines.filter((l) => l.kind === 'expense').reduce((n, l) => n + l.amount, 0);
  return {
    lines: lines.map((l) => ({
      id: l.id as string,
      label: l.label,
      amount: l.amount,
      kind: l.kind,
      addedBy: l.addedBy?.name ?? null,
    })),
    income,
    expense,
    balance: income - expense,
  };
}

export async function budget(user: UserDocument, eventId: string) {
  return presentBudget((await managed(user, eventId))._id);
}

export async function addBudgetLine(
  user: UserDocument,
  eventId: string,
  body: { label: string; amount: number; kind: 'income' | 'expense' }
) {
  const event = await managed(user, eventId);
  await BudgetLine.create({ ...body, event: event._id, addedBy: user._id });
  return presentBudget(event._id);
}

export async function removeBudgetLine(user: UserDocument, eventId: string, lineId: string) {
  const event = await managed(user, eventId);
  await BudgetLine.deleteOne({ _id: lineId, event: event._id });
  return presentBudget(event._id);
}

/** Removes everything ops-related when an event is deleted. */
export async function forgetEvent(eventId: unknown) {
  await Promise.all([Shift.deleteMany({ event: eventId }), BudgetLine.deleteMany({ event: eventId })]);
}

// Re-exported for routes that need the event's existence checked cheaply.
export { Event, EventStaff };
