'use client';

/**
 * The notification centre: the full history (the bell shows the latest 12),
 * filtered by kind, plus a per-kind choice of whether it also comes by email.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Bell, CheckCheck } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { errorMessage, meApi, notificationsApi, type AppNotification, type NotificationType } from '@/lib/api';
import { formatRelative } from '@/lib/format';
import { NOTIFICATION_ICONS } from '@/components/shell/NotificationBell';
import { Button } from '@/components/ui/button';
import { Card, EmptyState, PageHeader } from '@/components/ui/surface';
import { FilterChips } from '@/components/ui/tabs';
import { cn } from '@/lib/cn';

const LABELS: Record<NotificationType, string> = {
  event_reminder: 'Reminders',
  event_updated: 'Event changes',
  event_cancelled: 'Cancellations',
  waitlist_promoted: 'Waitlist',
  announcement: 'Announcements',
  staff_invited: 'Team invites',
  club_new_event: 'Clubs you follow',
  waitlist_offer: 'Spots held for you',
  registration_decision: 'Join requests',
  organizer_approved: 'Organizer approved',
  organizer_rejected: 'Organizer not approved',
};
const TYPES = Object.keys(LABELS) as NotificationType[];
const PAGE_SIZE = 20;

function EmailSettings() {
  const { user, setUser } = useAuth();
  const [saving, setSaving] = useState<NotificationType | null>(null);
  if (!user) return null;
  const muted = new Set(user.preferences.mutedEmailTypes ?? []);
  const emailOn = user.preferences.emailNotifications;

  async function toggle(type: NotificationType) {
    const next = new Set(muted);
    if (next.has(type)) next.delete(type);
    else next.add(type);
    setSaving(type);
    try {
      setUser(await meApi.update({ preferences: { mutedEmailTypes: [...next] } }));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(null);
    }
  }

  return (
    <Card className="p-5">
      <h2 className="font-semibold">Also send by email</h2>
      <p className="mb-4 mt-0.5 text-sm text-muted">
        {emailOn ? (
          'Everything shows up here. Choose which kinds also land in your inbox.'
        ) : (
          <>
            Email is off for your account. Turn it on in{' '}
            <Link href="/settings" className="underline">
              Settings
            </Link>
            .
          </>
        )}
      </p>
      <AutoAcceptSwitch />
      <ul className="space-y-1">
        {TYPES.map((type) => {
          const on = emailOn && !muted.has(type);
          return (
            <li key={type} className="flex items-center justify-between gap-3 rounded-xl px-2 py-2">
              <span className="text-sm">{LABELS[type]}</span>
              <button
                type="button"
                role="switch"
                aria-checked={on}
                aria-label={`Email me ${LABELS[type].toLowerCase()}`}
                disabled={!emailOn || saving === type}
                onClick={() => toggle(type)}
                className={cn(
                  'relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-50',
                  on ? 'bg-primary' : 'bg-border-strong'
                )}
              >
                <span
                  className={cn(
                    'absolute top-0.5 size-5 rounded-full bg-white shadow transition-all',
                    on ? 'left-[22px]' : 'left-0.5'
                  )}
                />
              </button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/** "Take any seat automatically": skip the claim step when an event holds freed spots. */
function AutoAcceptSwitch() {
  const { user, setUser } = useAuth();
  const [saving, setSaving] = useState(false);
  if (!user) return null;
  const on = Boolean(user.preferences.autoAcceptWaitlist);
  return (
    <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-border p-3">
      <span className="text-sm">
        <span className="block font-medium">Take any waitlist spot automatically</span>
        <span className="block text-muted">Skip the &ldquo;claim your spot&rdquo; step on events that hold spots.</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label="Take any waitlist spot automatically"
        disabled={saving}
        onClick={async () => {
          setSaving(true);
          try {
            setUser(await meApi.update({ preferences: { autoAcceptWaitlist: !on } }));
          } catch (err) {
            toast.error(errorMessage(err));
          } finally {
            setSaving(false);
          }
        }}
        className={cn(
          'relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-50',
          on ? 'bg-primary' : 'bg-border-strong'
        )}
      >
        <span
          className={cn('absolute top-0.5 size-5 rounded-full bg-white shadow transition-all', on ? 'left-[22px]' : 'left-0.5')}
        />
      </button>
    </div>
  );
}

export default function NotificationsPage() {
  const [type, setType] = useState<NotificationType | null>(null);
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [unread, setUnread] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async (pageNumber: number, kind: NotificationType | null) => {
    const { items: batch, meta } = await notificationsApi.list({ type: kind ?? undefined, page: pageNumber, limit: PAGE_SIZE });
    setItems((prev) => (pageNumber === 1 ? batch : [...(prev ?? []), ...batch]));
    setHasMore(meta.page < meta.totalPages);
    setUnread(meta.unread);
    setPage(pageNumber);
  }, []);

  useEffect(() => {
    setItems(null);
    load(1, type).catch((err) => {
      toast.error(errorMessage(err));
      setItems([]);
    });
  }, [type, load]);

  async function markRead(n: AppNotification) {
    if (n.readAt) return;
    setItems((prev) => prev?.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)) ?? prev);
    setUnread((u) => Math.max(u - 1, 0));
    await notificationsApi.markRead(n.id).catch(() => {});
  }

  async function markAllRead() {
    setItems((prev) => prev?.map((x) => ({ ...x, readAt: x.readAt ?? new Date().toISOString() })) ?? prev);
    setUnread(0);
    await notificationsApi.markAllRead().catch((err) => toast.error(errorMessage(err)));
  }

  return (
    <>
      <PageHeader
        kicker="Everything we've told you"
        title={
          <>
            Your <em>notifications</em>
          </>
        }
        actions={
          unread > 0 && (
            <Button variant="secondary" onClick={markAllRead}>
              <CheckCheck /> Mark all read
            </Button>
          )
        }
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-4">
          <FilterChips<NotificationType>
            value={type}
            onChange={setType}
            allLabel="All"
            options={TYPES.map((t) => ({ value: t, label: LABELS[t] }))}
          />
          {items === null ? (
            <div className="h-72 animate-pulse rounded-3xl bg-surface-muted" />
          ) : items.length === 0 ? (
            <EmptyState
              emoji="🔔"
              title="Nothing here yet"
              description="Reminders, changes and announcements will show up here."
            />
          ) : (
            <Card className="overflow-hidden">
              <ul className="divide-y divide-border">
                {items.map((n) => {
                  const Icon = NOTIFICATION_ICONS[n.type] ?? Bell;
                  const body = (
                    <div className="flex gap-3 px-4 py-3">
                      <span
                        className={cn(
                          'mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full',
                          n.readAt ? 'bg-surface-muted text-muted' : 'bg-primary-soft text-primary-soft-foreground'
                        )}
                      >
                        <Icon className="size-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className={cn('text-sm', n.readAt ? 'text-muted' : 'font-medium')}>{n.title}</p>
                        {n.body && <p className="mt-0.5 text-sm text-muted">{n.body}</p>}
                        <p className="mt-1 text-xs text-subtle">
                          {LABELS[n.type]} · {formatRelative(n.createdAt)}
                        </p>
                      </div>
                      {!n.readAt && <span className="mt-2 size-2 shrink-0 rounded-full bg-pink" aria-label="Unread" />}
                    </div>
                  );
                  return (
                    <li key={n.id} className="transition hover:bg-surface-muted">
                      {n.event ? (
                        <Link href={`/events/${n.event}`} onClick={() => markRead(n)} className="block">
                          {body}
                        </Link>
                      ) : (
                        <button type="button" onClick={() => markRead(n)} className="block w-full text-left">
                          {body}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}
          {hasMore && (
            <div className="flex justify-center">
              <Button
                variant="secondary"
                loading={loadingMore}
                onClick={async () => {
                  setLoadingMore(true);
                  try {
                    await load(page + 1, type);
                  } catch (err) {
                    toast.error(errorMessage(err));
                  } finally {
                    setLoadingMore(false);
                  }
                }}
              >
                Load more
              </Button>
            </div>
          )}
        </div>
        <EmailSettings />
      </div>
    </>
  );
}
