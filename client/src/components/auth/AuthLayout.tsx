'use client';

import React from 'react';
import { motion } from 'motion/react';
import { Logo } from '@/components/shell/Logo';
import ThemeToggle from '@/components/shell/ThemeToggle';

const STICKERS = [
  { text: "you're in ✓", className: 'bg-[#d4ff3a] text-black', style: { left: '8%', top: '14%' }, rotate: -9 },
  { text: '🔥 24 going', className: 'bg-[#ff4fd8] text-[#09090d]', style: { right: '10%', top: '24%' }, rotate: 7 },
  { text: 'waitlist → in 🎉', className: 'bg-[#3df5ff] text-black', style: { left: '14%', top: '40%' }, rotate: 4 },
  { text: 'tmrw · 10am', className: 'bg-white text-black', style: { right: '16%', top: '50%' }, rotate: -5 },
];

/** Split screen: form on the left, a poster-style brand panel on the right (large screens). */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_1.05fr]">
      <div className="flex flex-col px-6 py-6 sm:px-12">
        <div className="flex items-center justify-between">
          <Logo />
          <ThemeToggle />
        </div>
        <div className="flex flex-1 items-center justify-center py-12">{children}</div>
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-subtle">© {new Date().getFullYear()} sync</p>
      </div>

      <div className="relative m-3 hidden overflow-hidden rounded-[40px] bg-[#09090d] text-white lg:block">
        <div className="absolute -left-24 top-0 size-[30rem] rounded-full bg-[#d4ff3a]/25 blur-[110px]" />
        <div className="absolute -right-24 top-1/3 size-[28rem] rounded-full bg-[#ff4fd8]/25 blur-[110px]" />
        <div className="absolute bottom-0 left-1/4 size-[24rem] rounded-full bg-[#3df5ff]/20 blur-[110px]" />

        <svg viewBox="0 0 24 24" className="absolute right-12 top-10 size-16 animate-spin-slow text-[#d4ff3a]" aria-hidden="true">
          <path
            fill="currentColor"
            d="M12 1.5c.6 4.9 3.6 9.9 10.5 10.5-6.9.6-9.9 5.6-10.5 10.5C11.4 17.6 8.4 12.6 1.5 12 8.4 11.4 11.4 6.4 12 1.5Z"
          />
        </svg>

        {STICKERS.map((s, i) => (
          <motion.span
            key={s.text}
            className={`absolute rounded-full px-4 py-2 font-display text-base font-extrabold shadow-[0_14px_30px_-10px_rgb(0_0_0/0.7)] ${s.className}`}
            style={s.style}
            initial={{ opacity: 0, scale: 0.5, rotate: 0 }}
            animate={{ opacity: 1, scale: 1, rotate: s.rotate, y: [0, -8, 0] }}
            transition={{
              opacity: { delay: 0.2 + i * 0.12 },
              scale: { type: 'spring', bounce: 0.5, delay: 0.2 + i * 0.12 },
              rotate: { type: 'spring', bounce: 0.5, delay: 0.2 + i * 0.12 },
              y: { duration: 5 + i, repeat: Infinity, ease: 'easeInOut' },
            }}
          >
            {s.text}
          </motion.span>
        ))}

        <div className="absolute inset-x-12 bottom-12">
          <p className="font-display text-[clamp(4rem,7.5vw,7rem)] font-extrabold leading-[0.85] tracking-[-0.05em]">
            no more
            <br />
            <span className="font-serif font-normal italic text-[#d4ff3a]">fomo.</span>
          </p>
          <p className="mt-5 max-w-sm text-white/60">
            Everything happening on campus, one tap away. Your plans, reminders and group chats in one place.
          </p>
        </div>
      </div>
    </div>
  );
}
