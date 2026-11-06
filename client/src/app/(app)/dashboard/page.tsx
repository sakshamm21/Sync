'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Compass, Megaphone, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useEventsSync } from '@/context/EventContext';
import { adminApi, eventsApi, meApi, organizerApi, type OrganizerOverview, type PlatformStats, type SyncEvent } from '@/lib/api';
import { CATEGORY_EMOJI, formatDay, formatTime } from '@/lib/format';
import EventCard, { EventCardSkeleton } from '@/components/events/EventCard';
import MiniTicket from '@/components/events/MiniTicket';
import { ButtonLink } from '@/components/ui/button';
import { EmptyState, Kicker, SectionTitle } from '@/components/ui/surface';
import { FadeIn, Marquee, Stagger, StaggerItem } from '@/components/ui/motion';
import { cn } from '@/lib/cn';

function Ticker({ events }: { events: SyncEvent[] }) {
  if (!events.length) return null;
  return (
    <div className="-mx-4 rotate-[-1.5deg] bg-primary py-3 text-primary-foreground sm:mx-0 sm:rounded-full">
      <Marquee duration={40}>
        {events.map((e) => (
          <Link key={e.id} href={`/events/${e.id}`} className="mx-6 flex items-center gap-3 whitespace-nowrap font-display text-lg font-extrabold uppercase tracking-tight hover:underline">
            <span aria-hidden="true">{CATEGORY_EMOJI[e.category]}</span>
            {e.title}
            <span className="font-mono text-xs font-medium normal-case opacity-70">
              {formatDay(e.startsAt)} · {formatTime(e.startsAt)}
            </span>
            <span aria-hidden="true" className="ml-3">✦</span>
          </Link>
        ))}
      </Marquee>
    </div>
  );
}

function RoleShortcuts() {
  const { user } = useAuth();
  const [organizer, setOrganizer] = useState<OrganizerOverview['stats'] | null>(null);
  const [platform, setPlatform] = useState<PlatformStats | null>(null);

  useEffect(() => {
    if (user?.role === 'organizer' || user?.role === 'admin') organizerApi.overview().then((o) => setOrganizer(o.stats)).catch(() => {});
    if (user?.role === 'admin') adminApi.stats().then(setPlatform).catch(() => {});
  }, [user?.role]);

  if (!organizer && !platform) return null;

  const cards = [
    organizer && {
      href: '/organizer',
      icon: <Megaphone />,
      title: 'Your events',
      line: `${organizer.upcomingEvents} live · ${organizer.totalRegistrations} RSVPs · ${organizer.waitlisted} waiting`,
      className: 'bg-cyan text-black',
    },
    platform && {
      href: '/admin?tab=applications',
      icon: <ShieldCheck />,
      title: 'Admin',
      line: `${platform.pendingApplications} organizer request${platform.pendingApplications === 1 ? '' : 's'} · ${platform.users.total} people`,
      className: 'bg-pink text-white',
    },
  ].filter(Boolean) as { href: string; icon: React.ReactNode; title: string; line: string; className: string }[];

  return (
    <div className={cn('grid gap-4', cards.length > 1 && 'md:grid-cols-2')}>
      {cards.map((c, i) => (
        <Link
          key={c.href}
          href={c.href}
          style={{ rotate: `${i % 2 ? 0.8 : -0.8}deg` }}
          className={cn('group flex items-center gap-4 rounded-[28px] p-5 transition hover:rotate-0 hover:scale-[1.01]', c.className)}
        >
          <span className="flex size-12 items-center justify-center rounded-full bg-black/10 [&_svg]:size-5">{c.icon}</span>
          <div className="flex-1">
            <p className="font-display text-xl font-extrabold">{c.title}</p>
            <p className="text-sm opacity-75">{c.line}</p>
          </div>
          <ArrowUpRight className="size-6 transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
        </Link>
      ))}
    </div>
  );
}

export default function HomePage() {
  const { user } = useAuth();
  const { version } = useEventsSync();
  const [upNext, setUpNext] = useState<SyncEvent[] | null>(null);
  const [picked, setPicked] = useState<SyncEvent[] | null>(null);
  const [ticker, setTicker] = useState<SyncEvent[]>([]);

  useEffect(() => {
    meApi
      .registrations(true)
      .then((items) => setUpNext(items.filter((e) => e.status !== 'cancelled')))
      .catch(() => setUpNext([]));
    eventsApi.recommended().then(setPicked).catch(() => setPicked([]));
    eventsApi
      .list({ sort: 'soonest', limit: 10 })
      .then(({ items }) => setTicker(items))
      .catch(() => {});
  }, [version]);

  const replace = (updated: SyncEvent) => setPicked((prev) => prev?.map((e) => (e.id === updated.id ? updated : e)) ?? prev);
  const today = formatDay(new Date().toISOString());
  const thisWeek = upNext?.filter((e) => new Date(e.startsAt).getTime() - Date.now() < 7 * 24 * 60 * 60 * 1000).length ?? 0;

  return (
    <div className="space-y-14">
      <FadeIn>
        <Kicker>
          {today} · {upNext ? `${thisWeek} plan${thisWeek === 1 ? '' : 's'} this week` : '…'}
        </Kicker>
        <h1 className="mt-3 text-[clamp(3rem,9vw,7rem)] font-extrabold leading-[0.9] tracking-[-0.04em]">
          What&apos;s the <em className="font-serif font-normal italic text-primary">move</em>,
          <br />
          {user?.name.split(' ')[0]}?
        </h1>
        <div className="mt-8 flex flex-wrap gap-3">
          <ButtonLink href="/explore" size="lg">
            <Compass /> Find something to do
          </ButtonLink>
          <ButtonLink href="/schedule" variant="secondary" size="lg">
            My week
          </ButtonLink>
        </div>
      </FadeIn>

      <Ticker events={ticker} />

      <RoleShortcuts />

      <section>
        <SectionTitle
          emoji="🎟️"
          title={<>Your <em>tickets</em></>}
          action={<Link href="/schedule" className="font-mono text-xs uppercase tracking-wider text-muted hover:text-foreground">See all →</Link>}
        />
        {upNext === null ? (
          <div className="flex gap-4 overflow-hidden">{[0, 1, 2].map((i) => <div key={i} className="h-32 w-[22rem] shrink-0 animate-pulse rounded-[24px] bg-surface-muted" />)}</div>
        ) : upNext.length ? (
          <div className="no-scrollbar -mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
            {upNext.map((event) => (
              <MiniTicket key={event.id} event={event} />
            ))}
          </div>
        ) : (
          <EmptyState
            emoji="🎫"
            title="No plans yet. Fixable."
            description="RSVP to something and your ticket lands here, with a reminder before it starts."
            action={<ButtonLink href="/explore" variant="secondary">Browse what&apos;s on</ButtonLink>}
          />
        )}
      </section>

      <section>
        <SectionTitle emoji="✨" title={<>Picked for <em>you</em></>} action={<Link href="/explore" className="font-mono text-xs uppercase tracking-wider text-muted hover:text-foreground">Explore →</Link>} />
        {picked === null ? (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((i) => <EventCardSkeleton key={i} />)}</div>
        ) : picked.length ? (
          <Stagger className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {picked.map((event) => (
              <StaggerItem key={event.id}>
                <EventCard event={event} onChange={replace} />
              </StaggerItem>
            ))}
          </Stagger>
        ) : (
          <EmptyState emoji="🫡" title="You've joined everything." description="Overachiever. New events will pop up here." />
        )}
        {picked && picked.length > 0 && !user?.interests.length && (
          <p className="mt-6 text-sm text-muted">
            Psst, pick your vibes in{' '}
            <Link href="/settings" className="font-semibold text-primary hover:underline">
              Settings
            </Link>{' '}
            and these get way better.
          </p>
        )}
      </section>
    </div>
  );
}
