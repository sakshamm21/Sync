'use client';

/** All teams at a team event, for organisers and door staff, with one-tap team check-in. */
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { errorMessage, teamsApi, type Team } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge, Card } from '@/components/ui/surface';

export default function TeamsCard({ eventId, onCheckedIn }: { eventId: string; onCheckedIn?: () => void }) {
  const [teams, setTeams] = useState<Team[] | null>(null);
  const load = useCallback(() => {
    teamsApi
      .list(eventId)
      .then((r) => setTeams(r.teams))
      .catch(() => setTeams([]));
  }, [eventId]);
  useEffect(load, [load]);

  if (!teams) return null;
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-border p-4">
        <h2 className="font-semibold">Teams ({teams.length})</h2>
      </div>
      {teams.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted">No teams yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {teams.map((t) => {
            const inCount = t.members.filter((m) => m.checkedIn).length;
            return (
              <li key={t.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {t.name} {t.code && <span className="ml-1 font-mono text-xs text-muted">{t.code}</span>}{' '}
                    {t.complete === false && <Badge tone="warning">Needs more people</Badge>}
                  </p>
                  <p className="truncate text-xs text-muted">{t.members.map((m) => m.name).join(', ')}</p>
                </div>
                <Button
                  size="sm"
                  variant={inCount === t.members.length ? 'secondary' : 'primary'}
                  disabled={inCount === t.members.length}
                  onClick={async () => {
                    try {
                      const r = await teamsApi.checkIn(eventId, t.id);
                      toast.success(`${t.name}: ${r.checkedIn} checked in`);
                      load();
                      onCheckedIn?.();
                    } catch (err) {
                      toast.error(errorMessage(err));
                    }
                  }}
                >
                  {inCount === t.members.length ? 'All checked in' : 'Check in team'}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
