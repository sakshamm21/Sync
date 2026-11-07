'use client';

/** Your team at a team event: create one, join with a code, or see who's in (Roadmap "Next" #2). */
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Copy, Users } from 'lucide-react';
import { errorMessage, teamsApi, type SyncEvent, type Team } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { Avatar, Card, Kicker } from '@/components/ui/surface';

export default function TeamPanel({ event }: { event: SyncEvent }) {
  const [team, setTeam] = useState<Team | null | undefined>(undefined);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const registered = event.viewer.registration === 'going' || event.viewer.registration === 'waitlisted';

  useEffect(() => {
    if (!registered) return;
    teamsApi
      .mine(event.id)
      .then(setTeam)
      .catch(() => setTeam(null));
  }, [event.id, registered]);

  if (!event.teamSize || !registered || team === undefined) return null;
  const size = event.teamSize;

  const run = async (fn: () => Promise<Team | null>, done?: string) => {
    setBusy(true);
    try {
      setTeam(await fn());
      if (done) toast.success(done);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <Kicker className="mb-3">Your team · {size.min === size.max ? size.max : `${size.min}–${size.max}`} people</Kicker>
      <Card className="space-y-4 p-5">
        {team ? (
          <>
            <div className="flex items-center justify-between gap-3">
              <p className="font-display text-xl font-bold">{team.name}</p>
              {team.code && (
                <button
                  type="button"
                  onClick={() => navigator.clipboard.writeText(team.code!).then(() => toast.success('Code copied'))}
                  className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1 font-mono text-sm"
                  aria-label={`Team code ${team.code}, copy`}
                >
                  {team.code} <Copy className="size-3.5" />
                </button>
              )}
            </div>
            <ul className="space-y-2">
              {team.members.map((m) => (
                <li key={m.id} className="flex items-center gap-2.5 text-sm">
                  <Avatar name={m.name} src={m.avatarUrl} size={28} />
                  <span className="flex-1">
                    {m.name}
                    {m.id === team.captain && <span className="ml-1.5 text-xs text-muted">captain</span>}
                  </span>
                  {m.status === 'waitlisted' && <span className="text-xs text-warning">waitlisted</span>}
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted">
              {team.members.length < size.min
                ? `Needs ${size.min - team.members.length} more. Share the code with your teammates.`
                : team.members.length < size.max
                  ? `Room for ${size.max - team.members.length} more.`
                  : 'Your team is full.'}
            </p>
            <Button
              variant="ghost"
              size="sm"
              loading={busy}
              onClick={() => run(() => teamsApi.leave(event.id), 'You left the team')}
            >
              Leave team
            </Button>
          </>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                void run(() => teamsApi.create(event.id, name.trim()), 'Team created. Share the code!');
              }}
            >
              <label htmlFor="team-name" className="block text-sm font-medium">
                Start a team
              </label>
              <Input
                id="team-name"
                placeholder="Team name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                minLength={2}
              />
              <Button type="submit" size="sm" loading={busy}>
                <Users /> Create team
              </Button>
            </form>
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                void run(() => teamsApi.join(event.id, code.trim()), "You're on the team");
              }}
            >
              <label htmlFor="team-code" className="block text-sm font-medium">
                Join with a code
              </label>
              <Input id="team-code" placeholder="e.g. K7Q2MX" value={code} onChange={(e) => setCode(e.target.value)} required />
              <Button type="submit" size="sm" variant="secondary" loading={busy}>
                Join team
              </Button>
            </form>
          </div>
        )}
      </Card>
    </section>
  );
}
