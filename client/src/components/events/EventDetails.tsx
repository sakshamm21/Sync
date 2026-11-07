'use client';

/**
 * The interactive half of the event page. The server renders the public
 * details for the first paint; this hydrates from that same data and takes
 * over everything that depends on who is signed in.
 */
import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowLeft, CalendarPlus, Flag, Hourglass, Link2, MapPin, Navigation, Share2, Star, Users } from 'lucide-react';
import RsvpButton from './RsvpButton';
import EventCover, { statusOf } from './EventCover';
import { CapacityBar, DateStamp } from './EventCard';
import EventChat from '@/components/chat/EventChat';
import { useAuth } from '@/context/AuthContext';
import { errorMessage, eventsApi, type EventRating, type ReportReason, type SyncEvent } from '@/lib/api';
import { CATEGORY_EMOJI, formatEventWhen, formatVenue } from '@/lib/format';
import { Button, ButtonLink } from '@/components/ui/button';
import { Avatar, Card, EmptyState, Kicker, Sticker } from '@/components/ui/surface';
import { FadeIn } from '@/components/ui/motion';

/** What the server rendered, before any client-side fetch. */
interface ServerEvent {
  id: string;
  title: string;
  description: string;
  category: string;
  startsAt: string;
  endsAt: string;
  status: string;
  visibility: string;
  coverImageUrl: string;
  attendeeCount: number;
  capacity: number | null;
  venue: { name?: string; address?: string; latitude?: number; longitude?: number };
  owner: { name?: string; organization?: string; avatarUrl?: string };
}

function directionsUrl(event: SyncEvent): string | null {
  const { latitude, longitude, name, address } = event.venue ?? {};
  if (latitude != null && longitude != null) return `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`;
  const query = [name, address].filter(Boolean).join(', ');
  return query ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}` : null;
}

function mapEmbed(event: SyncEvent): string | null {
  const { latitude: lat, longitude: lng } = event.venue ?? {};
  if (lat == null || lng == null) return null;
  const d = 0.004;
  return `https://www.openstreetmap.org/export/embed.html?bbox=${lng - d}%2C${lat - d}%2C${lng + d}%2C${lat + d}&layer=mapnik&marker=${lat}%2C${lng}`;
}

function RoundAction({
  label,
  onClick,
  href,
  children,
}: {
  label: string;
  onClick?: () => void;
  href?: string | null;
  children: React.ReactNode;
}) {
  const className =
    'flex flex-col items-center gap-1.5 text-xs font-semibold text-muted transition hover:text-foreground disabled:opacity-40 [&>span:first-child]:flex [&>span:first-child]:size-12 [&>span:first-child]:items-center [&>span:first-child]:justify-center [&>span:first-child]:rounded-full [&>span:first-child]:border [&>span:first-child]:border-border [&>span:first-child]:bg-surface-muted [&>span:first-child]:transition hover:[&>span:first-child]:border-primary hover:[&>span:first-child]:text-primary [&_svg]:size-5';
  if (href) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={className}>
        <span>{children}</span>
        <span>{label}</span>
      </a>
    );
  }
  return (
    <button onClick={onClick} disabled={!onClick} className={className}>
      <span>{children}</span>
      <span>{label}</span>
    </button>
  );
}

/** One-tap rating, shown once the event is over to people who attended. */
function RatingPanel({ event, onRated }: { event: SyncEvent; onRated: (r: EventRating) => void }) {
  const [rating, setRating] = useState<EventRating | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    eventsApi
      .ratings(event.id)
      .then(setRating)
      .catch(() => setRating(null));
  }, [event.id]);

  if (!rating) return null;
  const canRate = event.viewer.registration === 'going' && event.isPast;

  async function give(value: number) {
    setPending(true);
    try {
      onRated(await eventsApi.rate(event.id, value));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <section>
      <Kicker className="mb-3">How was it?</Kicker>
      <Card className="p-5">
        {rating.average !== null && (
          <div className="mb-4 flex items-center gap-2">
            <span className="font-display text-3xl font-extrabold">{rating.average.toFixed(1)}</span>
            <span className="flex gap-0.5" aria-label={`${rating.average} out of 5`}>
              {[1, 2, 3, 4, 5].map((n) => (
                <Star
                  key={n}
                  className={`size-4 ${n <= Math.round(rating.average!) ? 'fill-primary text-primary' : 'text-muted'}`}
                />
              ))}
            </span>
            <span className="text-sm text-muted">
              from {rating.count} {rating.count === 1 ? 'person' : 'people'}
            </span>
          </div>
        )}

        {canRate ? (
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted">{rating.mine ? 'Your rating' : 'Rate it'}:</span>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  onClick={() => give(n)}
                  disabled={pending}
                  aria-label={`${n} star${n === 1 ? '' : 's'}`}
                  className="transition hover:scale-110 disabled:opacity-50"
                >
                  <Star className={`size-7 ${n <= (rating.mine ?? 0) ? 'fill-primary text-primary' : 'text-muted'}`} />
                </button>
              ))}
            </div>
          </div>
        ) : (
          rating.average === null && <p className="text-sm text-muted">No ratings yet.</p>
        )}
      </Card>
    </section>
  );
}

/** Lets a member flag an event for an admin. */
function ReportButton({ event }: { event: SyncEvent }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReportReason>('misleading');
  const [pending, setPending] = useState(false);

  const REASONS: { value: ReportReason; label: string }[] = [
    { value: 'misleading', label: 'Misleading details' },
    { value: 'inappropriate', label: 'Inappropriate' },
    { value: 'spam', label: 'Spam' },
    { value: 'duplicate', label: 'Duplicate' },
    { value: 'other', label: 'Something else' },
  ];

  async function submit() {
    setPending(true);
    try {
      await eventsApi.report(event.id, { reason });
      toast.success('Thanks — an admin will take a look.');
      setOpen(false);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setPending(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-xs text-muted underline-offset-2 hover:text-foreground hover:underline"
      >
        Report this event
      </button>
    );
  }

  return (
    <div className="rounded-2xl bg-surface-muted p-4">
      <p className="text-sm font-semibold">What&apos;s wrong?</p>
      <div className="mt-2 space-y-1.5">
        {REASONS.map((r) => (
          <label key={r.value} className="flex cursor-pointer items-center gap-2 text-sm">
            <input type="radio" name="reason" checked={reason === r.value} onChange={() => setReason(r.value)} />
            {r.label}
          </label>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        <Button size="sm" onClick={submit} loading={pending}>
          Send
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

export default function EventDetails({
  id,
  initialEvent,
  initialCategoryLabel,
}: {
  id: string;
  /** Null for events the server can't show anonymously (private plans, drafts): fetched with the user's session instead. */
  initialEvent: ServerEvent | null;
  initialCategoryLabel: string;
}) {
  const router = useRouter();
  const { user, status } = useAuth();
  // Start from the server's copy so the page is readable before any fetch,
  // then replace it with the authenticated view once that arrives.
  const [missing, setMissing] = useState(false);
  const [event, setEvent] = useState<SyncEvent | null>(
    () =>
      initialEvent && {
        ...(initialEvent as unknown as SyncEvent),
        tags: [],
        onlineUrl: '',
        viewer: {
          isOwner: false,
          isOrganizer: false,
          canManage: false,
          canCheckIn: false,
          canChat: false,
          staffRole: null,
          registration: null,
        },
        spotsLeft: initialEvent.capacity === null ? null : Math.max(initialEvent.capacity - initialEvent.attendeeCount, 0),
        isPast: new Date(initialEvent.endsAt) < new Date(),
        averageRating: null,
        createdAt: initialEvent.startsAt,
        updatedAt: initialEvent.startsAt,
      }
  );

  useEffect(() => {
    if (status === 'loading') return;
    eventsApi
      .get(id)
      .then(setEvent)
      .catch((err) => {
        // With no server copy this was a private plan or draft: if the
        // signed-in user can't see it either, it doesn't exist for them.
        if (!initialEvent) setMissing(true);
        else toast.error(errorMessage(err));
      });
  }, [id, status, initialEvent]);

  async function share() {
    if (!event) return;
    const url = window.location.href;
    try {
      if (navigator.share) await navigator.share({ title: event.title, url });
      else {
        await navigator.clipboard.writeText(url);
        toast.success('Link copied. Send it to the group chat 📲');
      }
    } catch {
      // The share sheet was closed.
    }
  }

  async function addToCalendar() {
    if (!event) return;
    try {
      await eventsApi.downloadCalendarFile(event);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  const embed = useMemo(() => (event ? mapEmbed(event) : null), [event]);
  const badge = event && statusOf(event);
  const host = event ? event.owner?.organization || event.owner?.name || '' : '';

  if (missing) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-24">
        <EmptyState
          emoji="🔍"
          title="Event not found"
          description={
            user
              ? 'This event may have been deleted, or it is private.'
              : 'If this is your private plan or draft, sign in to see it.'
          }
          action={
            user ? (
              <ButtonLink href="/explore">See what&apos;s on</ButtonLink>
            ) : (
              <ButtonLink href={`/authentication?next=${encodeURIComponent(`/events/${id}`)}`}>Sign in</ButtonLink>
            )
          }
        />
      </main>
    );
  }

  return (
    <>
      {!event && <div className="mx-auto mt-6 h-[55vh] max-w-7xl animate-pulse rounded-[40px] bg-surface-muted" />}

      {event && (
        <>
          {/* Hero */}
          <section className="relative mx-auto max-w-7xl px-4 pt-4 sm:px-6 lg:px-8">
            <div className="relative overflow-hidden rounded-[40px]">
              <EventCover event={event} stickers={false} className="h-[52vh] min-h-[360px] w-full" />
              <div className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent" />
              <button
                onClick={() => (window.history.length > 1 ? router.back() : router.push(user ? '/explore' : '/'))}
                aria-label="Back"
                className="absolute left-5 top-16 flex size-11 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-md transition hover:bg-black/60 sm:top-5"
              >
                <ArrowLeft className="size-5" />
              </button>
              <FadeIn className="absolute inset-x-0 bottom-0 p-6 sm:p-10">
                <div className="mb-4 flex flex-wrap items-center gap-2">
                  <Sticker rotate={-4}>
                    <span aria-hidden="true">{CATEGORY_EMOJI[event.category]}</span>
                    {initialCategoryLabel}
                  </Sticker>
                  {badge && (
                    <Sticker rotate={3} className={`border-transparent ${badge.className}`}>
                      {badge.icon}
                      {badge.label}
                    </Sticker>
                  )}
                </div>
                <Kicker className="text-foreground/80">{formatEventWhen(event)}</Kicker>
                <h1 className="mt-3 max-w-4xl text-[clamp(2.4rem,6vw,5.5rem)] font-extrabold leading-[0.92] tracking-[-0.04em]">
                  {event.title}
                </h1>
                {event.visibility === 'public' && host && (
                  <div className="mt-5 flex items-center gap-2.5 text-sm">
                    <Avatar name={host} src={event.owner?.avatarUrl} size={30} />
                    <span className="text-muted">hosted by</span>
                    <span className="font-semibold">{host}</span>
                  </div>
                )}
              </FadeIn>
            </div>
          </section>

          <main className="mx-auto mt-10 grid max-w-7xl gap-10 px-4 pb-24 sm:px-6 lg:grid-cols-[1fr_24rem] lg:px-8">
            <div className="min-w-0 space-y-12">
              {event.description && (
                <section>
                  <Kicker className="mb-3">The plan</Kicker>
                  <p className="whitespace-pre-wrap text-lg leading-relaxed text-foreground/85">{event.description}</p>
                </section>
              )}

              {event.tags.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {event.tags.map((tag, i) => (
                    <Link
                      key={tag}
                      href={`/explore?q=${encodeURIComponent(tag)}`}
                      style={{ rotate: `${(i % 3) - 1}deg` }}
                      className="rounded-full border border-border bg-surface px-4 py-1.5 text-sm font-semibold transition hover:rotate-0 hover:border-primary hover:text-primary"
                    >
                      #{tag}
                    </Link>
                  ))}
                </div>
              )}

              {embed && (
                <section>
                  <Kicker className="mb-3">Where</Kicker>
                  <div className="overflow-hidden rounded-[28px] border border-border">
                    <iframe title="Venue map" src={embed} className="map-frame h-72 w-full border-0" />
                  </div>
                </section>
              )}

              {event.visibility === 'public' && (
                <RatingPanel event={event} onRated={(r) => setEvent({ ...event, averageRating: r.average })} />
              )}

              {event.visibility === 'public' && (
                <section>
                  <Kicker className="mb-3">The group chat</Kicker>
                  {event.viewer.canChat ? (
                    <Card className="flex h-[540px] flex-col overflow-hidden">
                      <EventChat eventId={event.id} canAnnounce={event.viewer.canManage} className="flex-1" />
                    </Card>
                  ) : (
                    <Card className="p-8 text-center">
                      <p className="text-3xl">💬</p>
                      <p className="mt-2 font-display text-lg font-bold">The chat is for people who are going</p>
                      <p className="mt-1 text-sm text-muted">
                        {user ? 'Tap I’m in to join the conversation.' : 'Sign in and tap I’m in to join.'}
                      </p>
                    </Card>
                  )}
                </section>
              )}

              {user && event.visibility === 'public' && (
                <section className="border-t border-border pt-6">
                  <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted">
                    <Flag className="size-3.5" /> Something off?
                  </p>
                  <ReportButton event={event} />
                </section>
              )}
            </div>

            {/* Ticket panel */}
            <aside className="lg:sticky lg:top-24 lg:self-start">
              <div className="[filter:drop-shadow(0_24px_40px_rgb(0_0_0/0.3))]">
                <div className="ticket-top rounded-t-[28px] bg-surface p-6">
                  <div className="flex items-center gap-5">
                    <DateStamp iso={event.startsAt} className="w-16 [&>span:nth-child(2)]:text-6xl" />
                    <div className="min-w-0 space-y-2 border-l border-border pl-5 text-sm">
                      <p className="font-semibold">{formatEventWhen(event)}</p>
                      <p className="flex items-center gap-1.5 text-muted">
                        <MapPin className="size-4 shrink-0 text-primary" />
                        <span className="truncate">{formatVenue(event)}</span>
                      </p>
                      {event.onlineUrl && (
                        <a
                          href={event.onlineUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-1.5 font-semibold text-primary hover:underline"
                        >
                          <Link2 className="size-4" /> Join online
                        </a>
                      )}
                    </div>
                  </div>
                </div>
                <div className="ticket-bottom relative space-y-5 rounded-b-[28px] bg-surface p-6 pt-7">
                  <div aria-hidden="true" className="absolute inset-x-6 top-0 border-t-2 border-dashed border-border" />
                  {event.visibility === 'public' && <CapacityBar event={event} />}
                  {event.viewer.registration === 'waitlisted' && (
                    <p className="flex gap-2 rounded-2xl bg-warning-soft p-3 text-sm text-warning">
                      <Hourglass className="mt-0.5 size-4 shrink-0" />
                      You&apos;re on the waitlist. If a spot opens, you&apos;re in automatically.
                    </p>
                  )}
                  <RsvpButton event={event} onChange={setEvent} size="xl" className="w-full" />
                  <div className="flex justify-around pt-1">
                    <RoundAction label="Calendar" onClick={addToCalendar}>
                      <CalendarPlus />
                    </RoundAction>
                    <RoundAction label="Share" onClick={event.visibility === 'public' ? share : undefined}>
                      <Share2 />
                    </RoundAction>
                    <RoundAction label="Directions" href={directionsUrl(event)} onClick={undefined}>
                      <Navigation />
                    </RoundAction>
                  </div>
                  {event.visibility === 'public' && (
                    <p className="flex items-center justify-center gap-1.5 pt-1 text-xs text-muted">
                      <Users className="size-3.5" />
                      {event.attendeeCount} going
                      {event.averageRating !== null && ` · ★ ${event.averageRating.toFixed(1)}`}
                    </p>
                  )}
                </div>
              </div>
            </aside>
          </main>
        </>
      )}
    </>
  );
}
