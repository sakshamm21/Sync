'use client';

/**
 * Volunteer shifts (Roadmap "Later" #6). Organisers post the shifts an event
 * needs; anyone on the event team (or the club committee) signs up for one.
 */
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Plus, Trash2 } from 'lucide-react';
import { errorMessage, opsApi, type Shift, type SyncEvent } from '@/lib/api';
import { formatDay, formatTime } from '@/lib/format';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { Badge, Card } from '@/components/ui/surface';

/** `datetime-local` wants "YYYY-MM-DDTHH:mm" in local time. */
const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

export default function Shifts({ event }: { event: SyncEvent }) {
  const { user } = useAuth();
  const canManage = event.viewer.canManage;
  const [shifts, setShifts] = useState<Shift[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    title: '',
    startsAt: toLocalInput(event.startsAt),
    endsAt: toLocalInput(event.endsAt),
    slots: 2,
  });

  useEffect(() => {
    opsApi
      .shifts(event.id)
      .then(setShifts)
      .catch(() => setShifts([]));
  }, [event.id]);

  const run = async (fn: () => Promise<Shift[]>, done?: string) => {
    setBusy(true);
    try {
      setShifts(await fn());
      if (done) toast.success(done);
      return true;
    } catch (err) {
      toast.error(errorMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await run(
      () =>
        opsApi.addShift(event.id, {
          title: form.title.trim(),
          startsAt: new Date(form.startsAt).toISOString(),
          endsAt: new Date(form.endsAt).toISOString(),
          slots: form.slots,
        }),
      'Shift added'
    );
    if (ok) setForm((f) => ({ ...f, title: '' }));
  };

  if (!shifts) return <Card className="h-40 animate-pulse bg-surface-muted" />;
  return (
    <Card className="p-5">
      <h2 className="font-semibold">Volunteer shifts</h2>
      <p className="mb-4 mt-0.5 text-xs text-muted">
        {canManage
          ? 'Post the jobs this event needs. Your event team and committee sign up here.'
          : 'Pick a shift to help with. The organisers see who signed up.'}
      </p>

      {shifts.length === 0 ? (
        <p className="mb-4 text-sm text-muted">No shifts yet.</p>
      ) : (
        <ul className="mb-4 divide-y divide-border">
          {shifts.map((s) => {
            const mine = s.volunteers.some((v) => v.id === user?.id);
            const full = s.volunteers.length >= s.slots;
            return (
              <li key={s.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{s.title}</p>
                  <p className="text-xs text-muted">
                    {formatDay(s.startsAt)} · {formatTime(s.startsAt)} – {formatTime(s.endsAt)}
                  </p>
                  {s.volunteers.length > 0 && (
                    <p className="mt-1 text-xs text-subtle">{s.volunteers.map((v) => v.name).join(', ')}</p>
                  )}
                </div>
                <Badge tone={full ? 'success' : 'neutral'}>
                  {s.volunteers.length}/{s.slots}
                </Badge>
                <Button
                  size="sm"
                  variant={mine ? 'secondary' : 'primary'}
                  disabled={busy || (full && !mine)}
                  onClick={() =>
                    run(() => opsApi.volunteer(event.id, s.id, !mine), mine ? 'You left the shift' : 'You are on this shift')
                  }
                >
                  {mine ? 'Leave' : full ? 'Full' : 'Sign up'}
                </Button>
                {canManage && (
                  <button
                    type="button"
                    aria-label={`Delete the ${s.title} shift`}
                    className="text-muted hover:text-danger"
                    onClick={() => run(() => opsApi.removeShift(event.id, s.id), 'Shift removed')}
                  >
                    <Trash2 className="size-4" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {canManage && (
        <form onSubmit={add} className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <Input
            aria-label="Shift name"
            placeholder="e.g. Registration desk"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            minLength={2}
            maxLength={80}
            required
          />
          <Input
            type="number"
            aria-label="People needed"
            title="People needed"
            className="sm:w-24"
            min={1}
            max={100}
            value={form.slots}
            onChange={(e) => setForm({ ...form, slots: Number(e.target.value) || 1 })}
            required
          />
          <Input
            type="datetime-local"
            aria-label="Shift starts"
            value={form.startsAt}
            onChange={(e) => setForm({ ...form, startsAt: e.target.value })}
            required
          />
          <Input
            type="datetime-local"
            aria-label="Shift ends"
            value={form.endsAt}
            onChange={(e) => setForm({ ...form, endsAt: e.target.value })}
            required
          />
          <Button type="submit" loading={busy} className="sm:col-span-2">
            <Plus /> Add shift
          </Button>
        </form>
      )}
    </Card>
  );
}
