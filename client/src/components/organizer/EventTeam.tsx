'use client';

/**
 * Who can help run an event. A club is a committee, not one person, so the
 * creator can invite co-organisers and door staff to a single event.
 */
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ShieldCheck, Trash2, UserPlus } from 'lucide-react';
import { errorMessage, staffApi, type StaffMember, type StaffRole } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Avatar, Badge, Card, Kicker } from '@/components/ui/surface';
import { ConfirmDialog } from '@/components/ui/overlay';
import { Segmented } from '@/components/ui/tabs';

const ROLE_LABEL: Record<StaffRole, string> = {
  owner: 'Owner',
  manager: 'Co-organiser',
  checkin: 'Check-in staff',
};

const ROLE_HINT: Record<Exclude<StaffRole, 'owner'>, string> = {
  manager: 'Can edit the event, message everyone and check people in.',
  checkin: 'Can scan entry codes, but cannot change the event.',
};

export default function EventTeam({ eventId }: { eventId: string }) {
  const [team, setTeam] = useState<StaffMember[] | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Exclude<StaffRole, 'owner'>>('manager');
  const [pending, setPending] = useState(false);
  const [removing, setRemoving] = useState<StaffMember | null>(null);

  const load = useCallback(() => {
    staffApi
      .list(eventId)
      .then(setTeam)
      .catch(() => setTeam([]));
  }, [eventId]);

  useEffect(load, [load]);

  async function invite() {
    if (!email.trim()) return;
    setPending(true);
    try {
      setTeam(await staffApi.invite(eventId, { email: email.trim(), role }));
      setEmail('');
      toast.success('Added to the team. They have been notified.');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setPending(false);
    }
  }

  async function remove(member: StaffMember) {
    if (!member.user) return;
    try {
      setTeam(await staffApi.remove(eventId, member.id));
      toast.success(`${member.user.name} removed from the team`);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function changeRole(member: StaffMember, next: StaffRole, { undoable = true } = {}) {
    const previous = member.role;
    try {
      setTeam(await staffApi.setRole(eventId, member.id, next));
      if (undoable) {
        toast.success(`${member.user?.name ?? 'They'} is now ${ROLE_LABEL[next].toLowerCase()}`, {
          action: { label: 'Undo', onClick: () => void changeRole(member, previous, { undoable: false }) },
        });
      }
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <Card className="p-5">
      <ConfirmDialog
        open={Boolean(removing)}
        onClose={() => setRemoving(null)}
        onConfirm={() => (removing ? remove(removing) : undefined)}
        title={`Remove ${removing?.user?.name ?? 'this person'}?`}
        description="They lose access to this event's console straight away. You can invite them again later."
        confirmLabel="Remove"
      />
      <Kicker className="mb-1">The team</Kicker>
      <p className="mb-4 text-sm text-muted">
        Anyone on the team sees this event in their organizer console and can help run it.
      </p>

      {team === null ? (
        <div className="h-20 animate-pulse rounded-xl bg-surface-muted" />
      ) : (
        <ul className="mb-5 divide-y divide-border">
          {team.map((member) => (
            <li key={member.id} className="flex items-center gap-3 py-3">
              <Avatar name={member.user?.name ?? '?'} src={member.user?.avatarUrl} size={36} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{member.user?.name ?? 'Unknown'}</p>
                <p className="truncate text-xs text-muted">{member.user?.organization || member.user?.id}</p>
              </div>

              {member.role === 'owner' ? (
                <Badge tone="neutral">
                  <ShieldCheck /> {ROLE_LABEL.owner}
                </Badge>
              ) : (
                <>
                  <select
                    value={member.role}
                    onChange={(e) => changeRole(member, e.target.value as StaffRole)}
                    aria-label={`Role for ${member.user?.name ?? 'this person'}`}
                    className="rounded-lg border border-border bg-surface-muted px-2 py-1 text-xs outline-none focus:border-primary"
                  >
                    <option value="manager">{ROLE_LABEL.manager}</option>
                    <option value="checkin">{ROLE_LABEL.checkin}</option>
                  </select>
                  <button
                    onClick={() => setRemoving(member)}
                    aria-label={`Remove ${member.user?.name ?? 'this person'}`}
                    className="rounded-lg p-2 text-muted transition hover:bg-danger-soft hover:text-danger"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </>
              )}
            </li>
          ))}
          {team.length === 0 && <li className="py-6 text-center text-sm text-muted">Just you so far.</li>}
        </ul>
      )}

      <div className="space-y-3 border-t border-border pt-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="teammate@campus.edu"
            aria-label="Teammate's email"
            className="h-10 flex-1 rounded-xl border border-border bg-surface-muted px-3 text-sm outline-none transition focus:border-primary focus:bg-surface focus:ring-4 focus:ring-ring/20"
          />
          <Segmented<Exclude<StaffRole, 'owner'>>
            value={role}
            onChange={setRole}
            options={[
              { value: 'manager', label: 'Co-organiser' },
              { value: 'checkin', label: 'Door staff' },
            ]}
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted">{ROLE_HINT[role]}</p>
          <Button onClick={invite} loading={pending} disabled={!email.trim()}>
            <UserPlus /> Invite
          </Button>
        </div>
      </div>
    </Card>
  );
}
