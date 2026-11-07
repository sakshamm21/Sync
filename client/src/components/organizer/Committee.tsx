'use client';

/**
 * The club's committee (Roadmap "Next" #10): add people once and they help
 * run every event the club runs. Core members co-organise; volunteers work
 * the door.
 */
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { UserPlus } from 'lucide-react';
import { clubsApi, errorMessage, type CommitteeMember } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { Avatar, Card } from '@/components/ui/surface';

export default function Committee() {
  const [members, setMembers] = useState<CommitteeMember[] | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<CommitteeMember['role']>('core');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    clubsApi
      .committee()
      .then(setMembers)
      .catch(() => setMembers(null));
  }, []);

  const run = async (fn: () => Promise<CommitteeMember[]>, done?: string) => {
    setBusy(true);
    try {
      setMembers(await fn());
      if (done) toast.success(done);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (!members) return null;
  return (
    <Card className="mt-8 p-5">
      <h2 className="font-semibold">Your committee</h2>
      <p className="mb-4 mt-0.5 text-sm text-muted">
        People added here help run every event you publish, now and in future. Core members can edit and manage; volunteers check
        people in.
      </p>
      {members.length > 0 && (
        <ul className="mb-4 divide-y divide-border">
          {members.map((m) => (
            <li key={m.id} className="flex items-center gap-3 py-2.5">
              <Avatar name={m.user?.name ?? '?'} src={m.user?.avatarUrl} size={32} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{m.user?.name}</p>
                <p className="truncate text-xs text-muted">{m.user?.email}</p>
              </div>
              <select
                value={m.role}
                aria-label={`Role for ${m.user?.name ?? 'this person'}`}
                onChange={(e) => run(() => clubsApi.setMemberRole(m.id, e.target.value as CommitteeMember['role']))}
                className="rounded-lg border border-border bg-surface-muted px-2 py-1 text-xs outline-none focus:border-primary"
              >
                <option value="core">Core team</option>
                <option value="volunteer">Volunteer</option>
              </select>
              <button
                type="button"
                className="text-xs text-muted hover:text-danger"
                onClick={() => run(() => clubsApi.removeMember(m.id), 'Removed')}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => clubsApi.addMember(email.trim(), role), 'Added to the committee').then(() => setEmail(''));
        }}
      >
        <Input
          type="email"
          placeholder="their@college.edu"
          aria-label="Committee member email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <select
          value={role}
          aria-label="Committee role"
          onChange={(e) => setRole(e.target.value as CommitteeMember['role'])}
          className="h-12 rounded-2xl border border-border bg-surface-muted px-3 text-sm outline-none focus:border-primary"
        >
          <option value="core">Core team</option>
          <option value="volunteer">Volunteer</option>
        </select>
        <Button type="submit" loading={busy}>
          <UserPlus /> Add
        </Button>
      </form>
    </Card>
  );
}
