'use client';

import { useEffect, useRef, useState } from 'react';
import confetti from 'canvas-confetti';
import { AnimatePresence, motion, useInView } from 'motion/react';
import { Bell, Check, Megaphone, PartyPopper, Plus } from 'lucide-react';
import { cn } from '@/lib/cn';

/** A real button that celebrates: the core RSVP moment, playable on the landing page. */
export function RsvpDemo() {
  const [going, setGoing] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const tap = () => {
    if (!going && ref.current) {
      const r = ref.current.getBoundingClientRect();
      confetti({
        particleCount: 90,
        spread: 80,
        origin: { x: (r.left + r.width / 2) / window.innerWidth, y: (r.top + r.height / 2) / window.innerHeight },
        colors: ['#d4ff3a', '#ff4fd8', '#3df5ff', '#ff7a1a'],
        zIndex: 80,
      });
    }
    setGoing((g) => !g);
  };
  return (
    <div className="flex flex-col items-center gap-3">
      <motion.button
        ref={ref}
        onClick={tap}
        whileTap={{ scale: 0.92 }}
        className={cn(
          'flex h-14 items-center gap-2 rounded-full px-8 font-display text-lg font-extrabold transition-colors',
          going ? 'bg-surface-muted text-primary' : 'bg-primary text-primary-foreground shadow-[0_10px_40px_-8px_var(--glow)]'
        )}
      >
        {going ? <Check className="size-5" /> : <Plus className="size-5" />}
        {going ? "You're in" : "I'm in"}
      </motion.button>
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-subtle">
        {going ? 'tap again to cancel' : 'go on, tap it'}
      </p>
    </div>
  );
}

/** Spots tick down, it sells out, then the waitlist moves you in. */
export function WaitlistDemo() {
  const steps = ['3 spots left', '2 spots left', '1 spot left', 'Sold out 🔥', "Spot opened. You're in! 🎉"];
  const [i, setI] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref);
  useEffect(() => {
    if (!inView) return;
    const t = setInterval(() => setI((n) => (n + 1) % steps.length), 1400);
    return () => clearInterval(t);
  }, [inView, steps.length]);
  const ratio = [0.7, 0.8, 0.9, 1, 1][i];
  return (
    <div ref={ref} className="w-full max-w-xs">
      <div className="h-3 overflow-hidden rounded-full bg-surface-muted">
        <motion.div
          className={cn('h-full rounded-full', i >= 3 ? (i === 4 ? 'bg-primary' : 'bg-pink') : 'bg-orange')}
          animate={{ width: `${ratio * 100}%` }}
          transition={{ type: 'spring', bounce: 0.2 }}
        />
      </div>
      <AnimatePresence mode="wait">
        <motion.p
          key={i}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          className={cn('mt-4 font-display text-2xl font-extrabold', i === 4 && 'text-primary', i === 3 && 'text-pink')}
        >
          {steps[i]}
        </motion.p>
      </AnimatePresence>
    </div>
  );
}

/** Notifications stacking in. */
export function NotifyDemo() {
  const items = [
    { icon: <Bell />, title: 'Tomorrow: Tech Summit', body: 'Starts at 10:00 · Main Auditorium', tone: 'bg-surface-raised' },
    { icon: <Megaphone />, title: 'Venue changed', body: 'Moved to the Open Air Theatre', tone: 'bg-pink text-white' },
    {
      icon: <PartyPopper />,
      title: "You're off the waitlist",
      body: 'A spot opened for Hackathon',
      tone: 'bg-primary text-primary-foreground',
    },
  ];
  const [shown, setShown] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref);
  useEffect(() => {
    if (!inView) return;
    const t = setInterval(() => setShown((n) => (n >= items.length ? 0 : n + 1)), 1100);
    return () => clearInterval(t);
  }, [inView, items.length]);
  return (
    <div ref={ref} className="relative h-44 w-full max-w-xs">
      <AnimatePresence>
        {items.slice(0, shown).map((n, i) => (
          <motion.div
            key={n.title}
            initial={{ opacity: 0, y: -20, scale: 0.9 }}
            animate={{ opacity: 1, y: (shown - 1 - i) * 14, scale: 1 - (shown - 1 - i) * 0.05 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ type: 'spring', bounce: 0.3 }}
            style={{ zIndex: i }}
            className={cn(
              'absolute inset-x-0 top-0 flex items-center gap-3 rounded-2xl border border-border p-3 shadow-lifted [&_svg]:size-4',
              n.tone
            )}
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-black/10">{n.icon}</span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-bold">{n.title}</span>
              <span className="block truncate text-xs opacity-75">{n.body}</span>
            </span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

/** A group chat that types itself. */
export function ChatDemo() {
  const lines = [
    { me: false, text: 'is there food at this?? 🍕' },
    { me: false, text: 'asking for a friend (me)' },
    { me: true, text: 'organizer said pizza at 7' },
    { me: false, text: 'say less 🏃' },
  ];
  const [n, setN] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref);
  useEffect(() => {
    if (!inView) return;
    const t = setInterval(() => setN((v) => (v >= lines.length ? 0 : v + 1)), 1000);
    return () => clearInterval(t);
  }, [inView, lines.length]);
  return (
    <div ref={ref} className="flex h-48 w-full max-w-xs flex-col justify-end gap-2">
      <AnimatePresence>
        {lines.slice(0, n).map((l) => (
          <motion.div
            key={l.text}
            layout
            initial={{ opacity: 0, y: 12, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0 }}
            className={cn(
              'max-w-[80%] rounded-3xl px-4 py-2 text-sm',
              l.me
                ? 'self-end rounded-br-lg bg-primary font-medium text-primary-foreground'
                : 'self-start rounded-bl-lg bg-surface-raised'
            )}
          >
            {l.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

/** Numbers counting up when scrolled into view. */
export function CountUp({ to, suffix = '', className }: { to: number; suffix?: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!inView) return;
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const p = Math.min((now - start) / 1200, 1);
      setValue(Math.round(to * (1 - Math.pow(1 - p, 3))));
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [inView, to]);
  return (
    <span ref={ref} className={className}>
      {value}
      {suffix}
    </span>
  );
}
