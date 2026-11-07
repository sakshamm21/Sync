'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { motion } from 'motion/react';
import { eventsApi, type SyncEvent } from '@/lib/api';
import { formatTime, formatVenue } from '@/lib/format';
import EventCover from '@/components/events/EventCover';
import { DateStamp } from '@/components/events/EventCard';

const FAN = [
  { rotate: -9, x: -70, y: 18 },
  { rotate: 0, x: 0, y: 0 },
  { rotate: 9, x: 70, y: 18 },
];

/** Three real popular events, fanned like a hand of tickets; they spread on hover. */
export default function FeaturedEvents() {
  const [events, setEvents] = useState<SyncEvent[] | null>(null);
  const [spread, setSpread] = useState(false);

  useEffect(() => {
    eventsApi
      .list({ sort: 'popular', limit: 3 })
      .then(({ items }) => setEvents(items))
      .catch(() => setEvents([]));
  }, []);

  if (events === null) return <div className="mx-auto h-[420px] w-full max-w-md" />;
  if (events.length === 0) return null;

  return (
    <div
      className="relative mx-auto flex h-[440px] w-full max-w-lg items-center justify-center"
      onMouseEnter={() => setSpread(true)}
      onMouseLeave={() => setSpread(false)}
    >
      {events.map((event, i) => {
        const pose = FAN[i] ?? FAN[1];
        const factor = spread ? 1.6 : 1;
        return (
          <motion.div
            key={event.id}
            className="absolute w-64"
            style={{ zIndex: i === 1 ? 3 : 2 }}
            initial={{ opacity: 0, y: 80, rotate: 0 }}
            animate={{ opacity: 1, x: pose.x * factor, y: pose.y * factor, rotate: pose.rotate * factor }}
            transition={{ type: 'spring', bounce: 0.3, duration: 0.8, delay: 0.3 + i * 0.1 }}
            whileHover={{ y: pose.y * factor - 16, scale: 1.04, zIndex: 5 }}
          >
            <Link href={`/events/${event.id}`} className="group block [filter:drop-shadow(0_30px_40px_rgb(0_0_0/0.45))]">
              <div className="ticket-top overflow-hidden rounded-t-[24px]">
                <EventCover event={event} className="aspect-[4/3]" />
              </div>
              <div className="ticket-bottom relative flex gap-3 rounded-b-[24px] bg-surface p-4 pt-5">
                <div aria-hidden="true" className="absolute inset-x-4 top-0 border-t-2 border-dashed border-border" />
                <DateStamp iso={event.startsAt} className="w-12" />
                <div className="min-w-0 border-l border-border pl-3">
                  <p className="line-clamp-2 font-display text-base font-bold leading-tight">{event.title}</p>
                  <p className="mt-1 truncate font-mono text-[10px] uppercase tracking-wider text-muted">
                    {formatTime(event.startsAt)} · {formatVenue(event)}
                  </p>
                </div>
              </div>
            </Link>
          </motion.div>
        );
      })}
    </div>
  );
}
