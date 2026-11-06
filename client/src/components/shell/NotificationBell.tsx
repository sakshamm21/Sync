'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { AnimatePresence, motion } from 'motion/react';
import {
  Bell,
  CalendarClock,
  CalendarX2,
  CheckCheck,
  Megaphone,
  PartyPopper,
  ShieldCheck,
  ShieldX,
  RefreshCw,
  Users,
  Sparkles,
  Ticket,
  UserCheck,
} from 'lucide-react';
import { useAuth, usePolling, useSocketEvent } from '@/context/AuthContext';
import { notificationsApi, type AppNotification, type NotificationType } from '@/lib/api';
import { formatRelative } from '@/lib/format';
import { Popover } from '@/components/ui/overlay';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

const POLL_MS = 30_000;

export const NOTIFICATION_ICONS: Record<NotificationType, React.ComponentType<{ className?: string }>> = {
  event_updated: RefreshCw,
  event_cancelled: CalendarX2,
  event_reminder: CalendarClock,
  waitlist_promoted: PartyPopper,
  announcement: Megaphone,
  organizer_approved: ShieldCheck,
  organizer_rejected: ShieldX,
  staff_invited: Users,
  club_new_event: Sparkles,
  waitlist_offer: Ticket,
  registration_decision: UserCheck,
};

export default function NotificationBell() {
  const { realtime, refreshUser } = useAuth();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  // Ids already shown, so polling only announces genuinely new notifications.
  const seen = useRef<Set<string> | null>(null);

  const announce = useCallback(
    (notification: AppNotification) => {
      toast(notification.title, { description: notification.body || undefined });
      // An approved organiser application changes the user's role.
      if (notification.type === 'organizer_approved') refreshUser().catch(() => {});
    },
    [refreshUser]
  );

  const load = useCallback(async () => {
    try {
      const { items: latest, meta } = await notificationsApi.list({ limit: 12 });
      if (seen.current) latest.filter((n) => !seen.current!.has(n.id)).forEach(announce);
      seen.current = new Set(latest.map((n) => n.id));
      setItems(latest);
      setUnread(meta.unread);
    } catch {
      // The bell is non-critical; keep the last known state.
    }
  }, [announce]);

  useEffect(() => {
    load();
  }, [load]);

  usePolling(load, POLL_MS, realtime === 'polling');

  useSocketEvent<AppNotification>('notification:new', (notification) => {
    seen.current?.add(notification.id);
    setItems((prev) => [notification, ...prev].slice(0, 12));
    setUnread((n) => n + 1);
    announce(notification);
  });

  async function markRead(notification: AppNotification) {
    if (notification.readAt) return;
    setItems((prev) => prev.map((n) => (n.id === notification.id ? { ...n, readAt: new Date().toISOString() } : n)));
    setUnread((n) => Math.max(n - 1, 0));
    await notificationsApi.markRead(notification.id).catch(load);
  }

  async function markAllRead() {
    setItems((prev) => prev.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })));
    setUnread(0);
    await notificationsApi.markAllRead().catch(load);
  }

  return (
    <Popover
      className="w-[22rem] max-w-[calc(100vw-1.5rem)]"
      trigger={({ toggle }) => (
        <Button
          variant="ghost"
          size="icon"
          onClick={toggle}
          aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
          className="relative"
        >
          <Bell />
          <AnimatePresence>
            {unread > 0 && (
              <motion.span
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0 }}
                className="absolute right-1.5 top-1.5 flex min-w-4 items-center justify-center rounded-full bg-pink px-1 text-[10px] font-bold leading-4 text-[#09090d] ring-2 ring-background"
              >
                {unread > 9 ? '9+' : unread}
              </motion.span>
            )}
          </AnimatePresence>
        </Button>
      )}
    >
      {(close) => (
        <div>
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <p className="font-display text-lg font-extrabold">Notifications</p>
            {unread > 0 && (
              <button
                onClick={markAllRead}
                className="flex items-center gap-1 text-xs font-medium text-primary hover:text-primary-hover"
              >
                <CheckCheck className="size-3.5" /> Mark all read
              </button>
            )}
          </div>
          <ul className="max-h-[26rem] overflow-y-auto p-1.5">
            {items.length === 0 && (
              <li className="px-4 py-10 text-center text-sm text-muted">
                <Bell className="mx-auto mb-2 size-6 text-subtle" />
                All caught up ✌️
              </li>
            )}
            {items.map((n) => {
              const Icon = NOTIFICATION_ICONS[n.type] ?? Bell;
              const content = (
                <div className="flex gap-3">
                  <span
                    className={cn(
                      'mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full',
                      n.readAt ? 'bg-surface-muted text-muted' : 'bg-primary-soft text-primary-soft-foreground'
                    )}
                  >
                    <Icon className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={cn('text-sm', n.readAt ? 'text-muted' : 'font-medium text-foreground')}>{n.title}</p>
                    {n.body && <p className="mt-0.5 line-clamp-2 text-xs text-muted">{n.body}</p>}
                    <p className="mt-1 text-[11px] text-subtle">{formatRelative(n.createdAt)}</p>
                  </div>
                  {!n.readAt && <span className="mt-2 size-2 shrink-0 rounded-full bg-pink" />}
                </div>
              );
              const className = 'block w-full rounded-2xl px-3 py-2.5 text-left transition hover:bg-surface-muted';
              return (
                <li key={n.id}>
                  {n.event ? (
                    <Link
                      href={`/events/${n.event}`}
                      onClick={() => {
                        markRead(n);
                        close();
                      }}
                      className={className}
                    >
                      {content}
                    </Link>
                  ) : (
                    <button type="button" onClick={() => markRead(n)} className={className}>
                      {content}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          <Link
            href="/notifications"
            onClick={close}
            className="block border-t border-border px-4 py-3 text-center text-sm font-medium text-primary hover:text-primary-hover"
          >
            All notifications and email settings
          </Link>
        </div>
      )}
    </Popover>
  );
}
