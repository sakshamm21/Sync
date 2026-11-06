'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion } from 'motion/react';
import { Ellipsis, Plus } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useCreateEvent } from '@/components/events/CreateEventDialog';
import { Popover } from '@/components/ui/overlay';
import { cn } from '@/lib/cn';
import { PRIMARY_NAV, SECONDARY_NAV, isActive, visibleFor, type NavItem } from './nav';

function DockLink({ item }: { item: NavItem }) {
  const pathname = usePathname();
  const active = isActive(pathname, item.href);
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-label={item.label}
      aria-current={active ? 'page' : undefined}
      className="group relative flex size-12 items-center justify-center rounded-full"
    >
      {active && (
        <motion.span layoutId="dock-active" className="absolute inset-0 rounded-full bg-primary" transition={{ type: 'spring', bounce: 0.3, duration: 0.5 }} />
      )}
      <motion.span whileHover={{ y: -2, scale: 1.08 }} whileTap={{ scale: 0.9 }} className="relative">
        <Icon className={cn('size-5 transition-colors', active ? 'text-primary-foreground' : 'text-muted group-hover:text-foreground')} strokeWidth={active ? 2.4 : 2} />
      </motion.span>
      <span className="pointer-events-none absolute -top-10 whitespace-nowrap rounded-full bg-foreground px-2.5 py-1 text-xs font-semibold text-background opacity-0 transition group-hover:-translate-y-0.5 group-hover:opacity-100 max-md:hidden">
        {item.label}
      </span>
    </Link>
  );
}

/** Floating navigation dock with a raised create button. */
export default function Dock() {
  const { user } = useAuth();
  const { openCreateEvent } = useCreateEvent();
  const pathname = usePathname();
  const secondary = visibleFor(SECONDARY_NAV, user);
  const secondaryActive = secondary.some((item) => isActive(pathname, item.href));
  const [first, second, ...rest] = PRIMARY_NAV;

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-4 z-40 mx-auto flex w-fit items-center gap-1 rounded-full border border-border bg-surface-raised/80 p-1.5 shadow-overlay backdrop-blur-2xl"
    >
      <DockLink item={first} />
      <DockLink item={second} />

      <motion.button
        onClick={() => openCreateEvent()}
        aria-label="New event"
        whileHover={{ rotate: 90, scale: 1.06 }}
        whileTap={{ scale: 0.9 }}
        transition={{ type: 'spring', bounce: 0.4 }}
        className="mx-1 flex size-12 items-center justify-center rounded-full bg-foreground text-background shadow-lifted"
      >
        <Plus className="size-6" strokeWidth={2.5} />
      </motion.button>

      {rest.map((item) => (
        <DockLink key={item.href} item={item} />
      ))}

      <span className="mx-1 hidden h-6 w-px bg-border md:block" />
      <div className="hidden items-center gap-1 md:flex">
        {secondary.map((item) => (
          <DockLink key={item.href} item={item} />
        ))}
      </div>

      <div className="md:hidden">
        <Popover
          side="top"
          className="w-52 p-1.5"
          trigger={({ toggle, open }) => (
            <button
              onClick={toggle}
              aria-label="More"
              aria-expanded={open}
              className={cn('relative flex size-12 items-center justify-center rounded-full', secondaryActive ? 'bg-primary text-primary-foreground' : 'text-muted')}
            >
              <Ellipsis className="size-5" />
            </button>
          )}
        >
          {(close) =>
            secondary.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={close}
                className={cn(
                  'flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-semibold transition hover:bg-surface-muted',
                  isActive(pathname, item.href) && 'text-primary'
                )}
              >
                <item.icon className="size-4" />
                {item.label}
              </Link>
            ))
          }
        </Popover>
      </div>
    </nav>
  );
}
