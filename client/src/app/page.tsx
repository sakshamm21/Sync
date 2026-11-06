'use client';

import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { ArrowRight, Move } from 'lucide-react';
import PublicHeader from '@/components/shell/PublicHeader';
import { AmbientGlow } from '@/components/shell/AppShell';
import { LogoMark } from '@/components/shell/Logo';
import FeaturedEvents from '@/components/landing/FeaturedEvents';
import { ChatDemo, CountUp, NotifyDemo, RsvpDemo, WaitlistDemo } from '@/components/landing/FeatureDemos';
import { ButtonLink } from '@/components/ui/button';
import { Kicker } from '@/components/ui/surface';
import { Marquee, Reveal, motionEase } from '@/components/ui/motion';
import { useAuth } from '@/context/AuthContext';
import { eventsApi } from '@/lib/api';
import { APP_HOME } from '@/lib/format';
import { cn } from '@/lib/cn';

const STICKERS = [
  { text: "you're in ✓", className: 'bg-primary text-primary-foreground', pos: 'left-[4%] top-[8%]', rotate: -10 },
  { text: '🔥 selling out', className: 'bg-pink text-white', pos: 'right-[6%] top-[2%]', rotate: 8 },
  { text: 'group chat unlocked 💬', className: 'bg-cyan text-black', pos: 'left-[30%] -bottom-4', rotate: 4 },
  { text: 'no more FOMO', className: 'bg-orange text-black', pos: 'right-[18%] bottom-[12%]', rotate: -6 },
];

const MARQUEE_WORDS = ['Discover', 'RSVP', 'Get reminded', 'Group chats', 'Waitlists', 'Check-in', 'Your calendar'];

function Bento({
  className,
  title,
  body,
  children,
  tone,
}: {
  className?: string;
  title: React.ReactNode;
  body: string;
  children: React.ReactNode;
  tone?: string;
}) {
  return (
    <Reveal
      className={cn(
        'group relative flex flex-col overflow-hidden rounded-[32px] border border-border bg-surface p-7',
        tone,
        className
      )}
    >
      <div className="flex flex-1 items-center justify-center py-8">{children}</div>
      <h3 className="text-2xl font-extrabold leading-tight [&_em]:font-serif [&_em]:font-normal [&_em]:italic">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed opacity-70">{body}</p>
    </Reveal>
  );
}

export default function LandingPage() {
  const { user } = useAuth();
  const heroRef = useRef<HTMLDivElement>(null);
  const [liveCount, setLiveCount] = useState<number | null>(null);
  const primaryHref = user ? APP_HOME : '/authentication?mode=register';

  useEffect(() => {
    eventsApi
      .list({ limit: 1 })
      .then(({ meta }) => setLiveCount(meta.total))
      .catch(() => {});
  }, []);

  return (
    <div className="min-h-screen overflow-x-hidden">
      <AmbientGlow />
      <PublicHeader />

      {/* Hero */}
      <section className="mx-auto max-w-7xl px-4 pb-20 pt-10 sm:px-6 lg:px-8 lg:pt-16">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="inline-flex items-center gap-2 rounded-full border border-border bg-surface/70 px-3.5 py-1.5 backdrop-blur"
        >
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-70" />
            <span className="relative inline-flex size-2 rounded-full bg-primary" />
          </span>
          <Kicker className="text-foreground">
            {liveCount === null ? 'live on campus' : `${liveCount} events live on campus`}
          </Kicker>
        </motion.div>

        <div ref={heroRef} className="relative mt-8">
          <motion.h1
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, ease: motionEase }}
            className="text-[clamp(3.6rem,12.5vw,11.5rem)] font-extrabold leading-[0.82] tracking-[-0.055em]"
          >
            campus plans,
            <br />
            <span className="font-serif font-normal italic tracking-[-0.03em] text-primary">minus</span> the chaos.
          </motion.h1>

          {/* Stickers you can throw around */}
          {STICKERS.map((s, i) => (
            <motion.div
              key={s.text}
              drag
              dragConstraints={heroRef}
              dragElastic={0.4}
              whileDrag={{ scale: 1.12, rotate: 0, cursor: 'grabbing' }}
              initial={{ opacity: 0, scale: 0.4, rotate: 0 }}
              animate={{ opacity: 1, scale: 1, rotate: s.rotate }}
              transition={{ type: 'spring', bounce: 0.5, delay: 0.6 + i * 0.12 }}
              className={cn(
                'absolute z-10 hidden cursor-grab select-none rounded-full px-4 py-2 font-display text-base font-extrabold shadow-[0_14px_30px_-10px_rgb(0_0_0/0.6)] md:block',
                s.className,
                s.pos
              )}
            >
              {s.text}
            </motion.div>
          ))}
        </div>

        <div className="mt-12 grid items-center gap-12 lg:grid-cols-[1fr_1.1fr]">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.7, ease: motionEase }}
          >
            <p className="max-w-md text-lg leading-relaxed text-muted">
              Every event on campus in one place. Tap <span className="font-semibold text-foreground">I&apos;m in</span>, get
              reminded, chat with everyone going. Running something? Waitlists and check-in handle themselves.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <ButtonLink href={primaryHref} size="xl" className="group">
                {user ? 'Open Sync' : 'Get in, it’s free'}
                <ArrowRight className="transition group-hover:translate-x-1" />
              </ButtonLink>
              <ButtonLink href={user ? '/explore' : '/authentication'} size="xl" variant="secondary">
                {user ? "See what's on" : 'Sign in'}
              </ButtonLink>
            </div>
            <p className="mt-6 hidden items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-subtle md:flex">
              <Move className="size-3.5" /> psst: the stickers are draggable
            </p>
          </motion.div>
          <FeaturedEvents />
        </div>
      </section>

      {/* Marquee bands */}
      <section className="relative py-10" aria-hidden="true">
        <div className="-mx-4 rotate-[-2.5deg] bg-primary py-4 text-primary-foreground">
          <Marquee duration={28}>
            {MARQUEE_WORDS.map((w) => (
              <span
                key={w}
                className="mx-6 flex items-center gap-6 whitespace-nowrap font-display text-4xl font-extrabold uppercase tracking-tight sm:text-5xl"
              >
                {w} <span className="text-3xl">✦</span>
              </span>
            ))}
          </Marquee>
        </div>
        <div className="-mx-4 -mt-3 rotate-[1.5deg] bg-pink py-3 text-white">
          <Marquee duration={34} reverse>
            {MARQUEE_WORDS.map((w) => (
              <span key={w} className="mx-6 flex items-center gap-6 whitespace-nowrap font-serif text-3xl italic">
                {w.toLowerCase()} <span>✺</span>
              </span>
            ))}
          </Marquee>
        </div>
      </section>

      {/* Features as live mini-demos */}
      <section className="mx-auto max-w-7xl px-4 py-24 sm:px-6 lg:px-8">
        <Reveal className="max-w-3xl">
          <Kicker>What you get</Kicker>
          <h2 className="mt-3 text-5xl font-extrabold leading-[0.95] sm:text-7xl">
            built for going out <em className="font-serif font-normal italic text-primary">and</em> putting on.
          </h2>
        </Reveal>

        <div className="mt-14 grid gap-5 md:grid-cols-3">
          <Bento
            className="md:col-span-2"
            title={
              <>
                RSVP in <em>one</em> tap.
              </>
            }
            body="It lands on your schedule, you get a reminder the day before, and you’re in the group chat. Try it ↑"
          >
            <RsvpDemo />
          </Bento>
          <Bento
            title={
              <>
                Waitlists that <em>run</em> themselves.
              </>
            }
            body="Full? Join the line. When a spot opens, you’re moved in and pinged instantly."
          >
            <WaitlistDemo />
          </Bento>
          <Bento
            title={
              <>
                Never miss <em>a</em> change.
              </>
            }
            body="Time moved? Venue swapped? Cancelled? You’ll know before the group chat does."
          >
            <NotifyDemo />
          </Bento>
          <Bento
            className="md:col-span-2"
            title={
              <>
                A group chat for <em>every</em> event.
              </>
            }
            body="Ask the organizer, find your people, get announcements. It disappears into history when the event’s done."
          >
            <ChatDemo />
          </Bento>
        </div>
      </section>

      {/* For organizers */}
      <section className="mx-auto max-w-7xl px-4 pb-24 sm:px-6 lg:px-8">
        <Reveal className="overflow-hidden rounded-[40px] bg-cyan p-8 text-black sm:p-14">
          <div className="grid items-end gap-10 lg:grid-cols-2">
            <div>
              <Kicker className="text-black/60">For clubs & organizers</Kicker>
              <h2 className="mt-3 text-5xl font-extrabold leading-[0.95] sm:text-6xl">
                run the <em className="font-serif font-normal italic">show</em>, not the spreadsheet.
              </h2>
              <p className="mt-4 max-w-md text-black/70">
                Publish in a minute, cap capacity, check people in at the door, export attendees, and see who actually showed up.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-4">
              {[
                { to: 300, label: 'capacity, handled', suffix: '' },
                { to: 1, label: 'tap to check in', suffix: '' },
                { to: 100, label: 'less chaos', suffix: '%' },
              ].map((s) => (
                <div key={s.label} className="rounded-3xl bg-black/10 p-4">
                  <CountUp
                    to={s.to}
                    suffix={s.suffix}
                    className="block font-display text-4xl font-extrabold tabular-nums sm:text-5xl"
                  />
                  <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-black/60">{s.label}</p>
                </div>
              ))}
            </div>
          </div>
        </Reveal>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-7xl px-4 pb-24 text-center sm:px-6 lg:px-8">
        <Reveal>
          <h2 className="text-[clamp(3rem,10vw,8rem)] font-extrabold leading-[0.85] tracking-[-0.05em]">
            stop missing
            <br />
            <span className="font-serif font-normal italic text-primary">out.</span>
          </h2>
          <ButtonLink href={primaryHref} size="xl" className="mt-10">
            {user ? 'Open Sync' : 'Create your account'} <ArrowRight />
          </ButtonLink>
        </Reveal>
      </section>

      <footer className="overflow-hidden border-t border-border pt-10">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 px-4 font-mono text-[11px] uppercase tracking-[0.14em] text-subtle sm:flex-row sm:px-6 lg:px-8">
          <span className="flex items-center gap-2">
            <LogoMark className="size-6" /> sync
          </span>
          <span>made by Saksham Malhotra · {new Date().getFullYear()}</span>
        </div>
        <p
          aria-hidden="true"
          className="mt-6 select-none whitespace-nowrap text-center font-display text-[19vw] font-extrabold leading-[0.8] tracking-[-0.06em] text-transparent [-webkit-text-stroke:1px_var(--border-strong)]"
        >
          sync
        </p>
      </footer>
    </div>
  );
}
