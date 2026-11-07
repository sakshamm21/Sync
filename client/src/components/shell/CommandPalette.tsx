'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, CornerDownLeft, LogOut, Moon, Plus, Search, Settings, Sun } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useCreateEvent } from '@/components/events/CreateEventDialog';
import { eventsApi, type SyncEvent } from '@/lib/api';
import { CATEGORY_EMOJI, formatDay } from '@/lib/format';
import { cn } from '@/lib/cn';
import { PRIMARY_NAV, SECONDARY_NAV, visibleFor } from './nav';

interface Command {
  id: string;
  group: 'Events' | 'Go to' | 'Actions';
  label: string;
  hint?: string;
  icon: React.ReactNode;
  run: () => void;
}

const PaletteContext = createContext<{ openPalette: () => void } | null>(null);

export function usePalette() {
  const context = useContext(PaletteContext);
  if (!context) throw new Error('usePalette must be used inside CommandPaletteProvider');
  return context;
}

/** ⌘K / Ctrl+K: search events, jump anywhere, run actions. */
export function CommandPaletteProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const openPalette = useCallback(() => setOpen(true), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const value = useMemo(() => ({ openPalette }), [openPalette]);
  return (
    <PaletteContext.Provider value={value}>
      {children}
      <Palette open={open} onClose={() => setOpen(false)} />
    </PaletteContext.Provider>
  );
}

function Palette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const { user, logout } = useAuth();
  const { resolvedTheme, setTheme } = useTheme();
  const { openCreateEvent } = useCreateEvent();
  const [query, setQuery] = useState('');
  const [events, setEvents] = useState<SyncEvent[]>([]);
  const [active, setActive] = useState(0);
  const [mounted, setMounted] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    const timer = setTimeout(() => {
      eventsApi
        .list({ q: q || undefined, sort: q ? 'soonest' : 'popular', limit: 5 })
        .then(({ items }) => setEvents(items))
        .catch(() => setEvents([]));
    }, 180);
    return () => clearTimeout(timer);
  }, [query, open]);

  const go = (href: string) => () => {
    onClose();
    router.push(href);
  };

  const commands: Command[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pages = [
      ...PRIMARY_NAV,
      ...visibleFor(SECONDARY_NAV, user),
      { href: '/settings', label: 'Settings', icon: Settings },
    ].map<Command>((item) => ({
      id: item.href,
      group: 'Go to',
      label: item.label,
      icon: <item.icon />,
      run: go(item.href),
    }));
    const actions: Command[] = [
      {
        id: 'new',
        group: 'Actions',
        label: 'Create an event',
        icon: <Plus />,
        run: () => {
          onClose();
          openCreateEvent();
        },
      },
      {
        id: 'theme',
        group: 'Actions',
        label: resolvedTheme === 'dark' ? 'Switch to day mode' : 'Switch to after-dark mode',
        icon: resolvedTheme === 'dark' ? <Sun /> : <Moon />,
        run: () => {
          setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');
          onClose();
        },
      },
      {
        id: 'logout',
        group: 'Actions',
        label: 'Sign out',
        icon: <LogOut />,
        run: () => {
          onClose();
          logout();
          router.push('/authentication');
        },
      },
    ];
    const eventCommands = events.map<Command>((e) => ({
      id: e.id,
      group: 'Events',
      label: e.title,
      hint: formatDay(e.startsAt),
      icon: <span className="text-base leading-none">{CATEGORY_EMOJI[e.category]}</span>,
      run: go(`/events/${e.id}`),
    }));
    const match = (c: Command) => !q || c.label.toLowerCase().includes(q);
    return [...eventCommands, ...pages.filter(match), ...actions.filter(match)];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, events, user?.role, resolvedTheme]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, commands.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      commands[active]?.run();
    } else if (e.key === 'Escape') {
      onClose();
    }
  }

  if (!mounted) return null;
  const groups = (['Events', 'Go to', 'Actions'] as const)
    .map((g) => ({ g, items: commands.filter((c) => c.group === g) }))
    .filter((x) => x.items.length);

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[70] flex items-start justify-center p-4 pt-[12vh]">
          <motion.div
            className="absolute inset-0 bg-black/60 backdrop-blur-md"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
            initial={{ opacity: 0, y: -16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.98 }}
            transition={{ type: 'spring', bounce: 0.2, duration: 0.4 }}
            className="relative w-full max-w-xl overflow-hidden rounded-[28px] border border-border bg-surface shadow-overlay"
          >
            <div className="flex items-center gap-3 border-b border-border px-5">
              <Search className="size-5 text-primary" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Search events, jump anywhere…"
                aria-label="Search"
                className="h-16 flex-1 bg-transparent font-display text-lg font-semibold outline-none placeholder:text-subtle"
              />
              <kbd className="rounded-lg border border-border px-2 py-0.5 font-mono text-[11px] text-subtle">esc</kbd>
            </div>
            <div ref={listRef} className="max-h-[50vh] overflow-y-auto p-2">
              {commands.length === 0 && (
                <p className="px-4 py-10 text-center text-sm text-muted">Nothing matches. Try another word 👀</p>
              )}
              {groups.map(({ g, items }) => (
                <div key={g} className="mb-1">
                  <p className="px-3 pb-1 pt-2 font-mono text-[10px] uppercase tracking-[0.16em] text-subtle">{g}</p>
                  {items.map((c) => {
                    const index = commands.indexOf(c);
                    const isActive = index === active;
                    return (
                      <button
                        key={c.id}
                        data-index={index}
                        onMouseMove={() => setActive(index)}
                        onClick={c.run}
                        className={cn(
                          'flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm transition-colors [&_svg]:size-4',
                          isActive ? 'bg-primary text-primary-foreground' : 'text-foreground'
                        )}
                      >
                        <span
                          className={cn(
                            'flex size-8 items-center justify-center rounded-xl',
                            isActive ? 'bg-black/10' : 'bg-surface-muted text-muted'
                          )}
                        >
                          {c.icon}
                        </span>
                        <span className="flex-1 truncate font-semibold">{c.label}</span>
                        {c.hint && (
                          <span className={cn('font-mono text-[11px]', isActive ? 'text-primary-foreground/70' : 'text-subtle')}>
                            {c.hint}
                          </span>
                        )}
                        {isActive && (c.group === 'Actions' ? <CornerDownLeft /> : <ArrowRight />)}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}
