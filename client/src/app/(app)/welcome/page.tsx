'use client';

/**
 * Onboarding, right after sign-up: pick what you're into and follow a few
 * clubs, so recommendations and notifications are useful from day one.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { clubsApi, errorMessage, meApi, type CategoryValue, type ClubSuggestion } from '@/lib/api';
import { APP_HOME, CATEGORIES, CATEGORY_EMOJI, CATEGORY_LABELS } from '@/lib/format';
import FollowButton from '@/components/clubs/FollowButton';
import { Button } from '@/components/ui/button';
import { Avatar, Card, PageHeader } from '@/components/ui/surface';
import { cn } from '@/lib/cn';

export default function WelcomePage() {
  const router = useRouter();
  const { user, setUser } = useAuth();
  const [interests, setInterests] = useState<CategoryValue[]>(user?.interests ?? []);
  const [clubs, setClubs] = useState<ClubSuggestion[] | null>(null);
  const [following, setFollowing] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  // Suggestions follow the interests as they're picked.
  useEffect(() => {
    const timer = setTimeout(() => {
      clubsApi
        .suggestions(interests)
        .then((list) => setClubs(list.slice(0, 3)))
        .catch(() => setClubs([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [interests]);

  const toggle = (c: CategoryValue) => setInterests((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));

  async function finish() {
    setSaving(true);
    try {
      setUser(await meApi.update({ interests }));
      router.replace(APP_HOME);
    } catch (err) {
      toast.error(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader
        kicker={`Welcome${user ? `, ${user.name.split(' ')[0]}` : ''}`}
        title={
          <>
            What are you <em>into?</em>
          </>
        }
        description="Pick a few. We'll use them to suggest events and clubs. You can change them any time in Settings."
      />
      <div className="mb-10 flex flex-wrap gap-2">
        {CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            aria-pressed={interests.includes(c)}
            onClick={() => toggle(c)}
            className={cn(
              'flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-semibold transition-colors',
              interests.includes(c)
                ? 'border-transparent bg-foreground text-background'
                : 'border-border bg-surface text-muted hover:text-foreground'
            )}
          >
            <span aria-hidden="true">{CATEGORY_EMOJI[c]}</span> {CATEGORY_LABELS[c]}
          </button>
        ))}
      </div>

      <h2 className="mb-4 font-display text-2xl font-extrabold">Clubs to follow</h2>
      {clubs === null ? (
        <div className="h-28 animate-pulse rounded-3xl bg-surface-muted" />
      ) : clubs.length === 0 ? (
        <p className="text-muted">No suggestions yet. Explore what&apos;s on and follow clubs from their pages.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          {clubs.map((club) => (
            <Card key={club.id} className="flex flex-col gap-3 p-5">
              <div className="flex items-center gap-3">
                <Avatar name={club.name} src={club.avatarUrl} size={44} />
                <div className="min-w-0">
                  <p className="truncate font-semibold">{club.name}</p>
                  <p className="text-xs text-muted">
                    {club.upcomingEvents} upcoming event{club.upcomingEvents === 1 ? '' : 's'}
                  </p>
                </div>
              </div>
              {club.bio && <p className="line-clamp-2 text-sm text-muted">{club.bio}</p>}
              <FollowButton
                size="sm"
                clubId={club.id}
                following={following.has(club.id)}
                onChange={(s) =>
                  setFollowing((prev) => {
                    const next = new Set(prev);
                    if (s.following) next.add(club.id);
                    else next.delete(club.id);
                    return next;
                  })
                }
              />
            </Card>
          ))}
        </div>
      )}

      <div className="mt-10 flex justify-end">
        <Button size="lg" loading={saving} onClick={finish}>
          {interests.length || following.size ? "Let's go" : 'Skip for now'}
        </Button>
      </div>
    </>
  );
}
