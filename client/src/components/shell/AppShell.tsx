'use client';

import React from 'react';
import { usePathname } from 'next/navigation';
import { motion } from 'motion/react';
import { Search } from 'lucide-react';
import { motionEase } from '@/components/ui/motion';
import { Logo } from './Logo';
import Dock from './Dock';
import NotificationBell from './NotificationBell';
import ThemeToggle from './ThemeToggle';
import UserMenu from './UserMenu';
import { CommandPaletteProvider, usePalette } from './CommandPalette';
import { AssistantButton, AssistantProvider } from '@/components/assistant/Assistant';

/** Soft colour fields behind everything; the grain overlay sits on top of them. */
export function AmbientGlow() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute -left-40 -top-48 size-[34rem] rounded-full bg-primary/[0.09] blur-[120px]" />
      <div className="absolute -right-40 top-1/4 size-[30rem] rounded-full bg-pink/[0.08] blur-[120px]" />
      <div className="absolute -bottom-40 left-1/3 size-[30rem] rounded-full bg-cyan/[0.06] blur-[120px]" />
    </div>
  );
}

function SearchTrigger() {
  const { openPalette } = usePalette();
  return (
    <button
      onClick={openPalette}
      className="group flex h-11 w-full max-w-sm items-center gap-3 rounded-full border border-border bg-surface/70 px-4 text-sm text-subtle backdrop-blur transition hover:border-border-strong hover:text-muted"
    >
      <Search className="size-4 transition group-hover:text-primary" />
      <span className="flex-1 text-left">Search or jump to…</span>
      <kbd className="hidden rounded-md border border-border bg-surface-muted px-1.5 font-mono text-[11px] sm:block">⌘K</kbd>
    </button>
  );
}

function MobileSearchButton() {
  const { openPalette } = usePalette();
  return (
    <button
      onClick={openPalette}
      aria-label="Search"
      className="flex size-10 items-center justify-center rounded-full text-muted hover:bg-surface-muted hover:text-foreground sm:hidden"
    >
      <Search className="size-5" />
    </button>
  );
}

/** Signed-in layout: top bar, animated content, floating dock, and the AI assistant panel. */
export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <CommandPaletteProvider>
      <AssistantProvider>
        <AmbientGlow />
        <header className="sticky top-0 z-30 bg-background/60 backdrop-blur-xl">
          <div className="mx-auto flex h-18 max-w-7xl items-center gap-4 px-4 sm:px-6 lg:px-8">
            <Logo href="/dashboard" />
            <div className="hidden flex-1 justify-center sm:flex">
              <SearchTrigger />
            </div>
            <div className="ml-auto flex items-center gap-1 sm:ml-0">
              <AssistantButton />
              <MobileSearchButton />
              <ThemeToggle />
              <NotificationBell />
              <UserMenu />
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-7xl px-4 pb-40 pt-6 sm:px-6 lg:px-8">
          <motion.div
            key={pathname}
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: motionEase }}
          >
            {children}
          </motion.div>
        </main>

        <Dock />
      </AssistantProvider>
    </CommandPaletteProvider>
  );
}
