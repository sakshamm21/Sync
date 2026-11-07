'use client';

/** A club's page: who they are, what's coming up, what they've run, and Follow. */
import { use, useEffect, useState } from 'react';
import { Star, Users } from 'lucide-react';
import PublicHeader from '@/components/shell/PublicHeader';
import { AmbientGlow } from '@/components/shell/AppShell';
import EventCard from '@/components/events/EventCard';
import FollowButton from '@/components/clubs/FollowButton';
import { useAuth } from '@/context/AuthContext';
import { clubsApi, errorMessage, type ClubProfile, type SyncEvent } from '@/lib/api';
import { Avatar, EmptyState, Kicker } from '@/components/ui/surface';
import { ButtonLink } from '@/components/ui/button';

export default function ClubPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { status } = useAuth();
  const [club, setClub] = useState<ClubProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status === 'loading') return;
    clubsApi
      .get(id)
      .then(setClub)
      .catch((err) => setError(errorMessage(err)));
  }, [id, status]);

  const replace = (list: 'upcoming' | 'past') => (updated: SyncEvent) =>
    setClub((prev) => prev && { ...prev, [list]: prev[list].map((e) => (e.id === updated.id ? updated : e)) });

  return (
    <div className="min-h-screen">
      <AmbientGlow />
      <PublicHeader />
      <main className="mx-auto max-w-7xl px-4 pb-24 pt-8 sm:px-6 lg:px-8">
        {error ? (
          <EmptyState
            emoji="🔍"
            title="Club not found"
            description={error}
            action={<ButtonLink href="/explore">See what&apos;s on</ButtonLink>}
          />
        ) : !club ? (
          <div className="h-64 animate-pulse rounded-[32px] bg-surface-muted" />
        ) : (
          <>
            <section className="flex flex-col gap-6 rounded-[32px] border border-border bg-surface p-6 sm:flex-row sm:items-center sm:p-8">
              <Avatar name={club.name} src={club.avatarUrl} size={88} />
              <div className="min-w-0 flex-1">
                <Kicker>Club</Kicker>
                <h1 className="mt-1 font-display text-4xl font-extrabold tracking-tight">{club.name}</h1>
                {club.bio && <p className="mt-2 max-w-2xl text-muted">{club.bio}</p>}
                <p className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted">
                  <span className="flex items-center gap-1.5">
                    <Users className="size-4" /> {club.followers} follower{club.followers === 1 ? '' : 's'}
                  </span>
                  {club.averageRating != null && (
                    <span className="flex items-center gap-1.5">
                      <Star className="size-4" /> {club.averageRating} from {club.ratingCount} rating
                      {club.ratingCount === 1 ? '' : 's'}
                    </span>
                  )}
                  {club.contactName && <span>Contact: {club.contactName}</span>}
                </p>
              </div>
              <FollowButton
                clubId={club.id}
                following={club.following}
                onChange={(s) => setClub((prev) => prev && { ...prev, ...s })}
              />
            </section>

            <h2 className="mb-4 mt-10 font-display text-2xl font-extrabold">Coming up</h2>
            {club.upcoming.length === 0 ? (
              <p className="text-muted">Nothing scheduled right now. Follow to hear about the next one.</p>
            ) : (
              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {club.upcoming.map((e) => (
                  <EventCard key={e.id} event={e} onChange={replace('upcoming')} />
                ))}
              </div>
            )}

            {club.past.length > 0 && (
              <>
                <h2 className="mb-4 mt-12 font-display text-2xl font-extrabold">Past events</h2>
                <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                  {club.past.map((e) => (
                    <EventCard key={e.id} event={e} onChange={replace('past')} />
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
