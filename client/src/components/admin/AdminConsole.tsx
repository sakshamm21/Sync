'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import {
  CalendarDays,
  Check,
  Flag,
  Inbox,
  Megaphone,
  Search,
  ShieldCheck,
  Ticket,
  UserCheck,
  UserX,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import {
  adminApi,
  errorMessage,
  type AuditEntry,
  type EventReport,
  type OrganizerApplication,
  type PageMeta,
  type PlatformStats,
  type Role,
  type User,
  type UserStatus,
} from '@/lib/api';
import { ROLE_LABELS, formatDateTime, formatDay, formatRelative } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Select, Textarea } from '@/components/ui/field';
import { ConfirmDialog } from '@/components/ui/overlay';
import { Avatar, Badge, Card, EmptyState, PageHeader, StatCard } from '@/components/ui/surface';
import { Segmented } from '@/components/ui/tabs';
import { Stagger, StaggerItem } from '@/components/ui/motion';

type Tab = 'overview' | 'users' | 'applications' | 'reports' | 'audit';

const REPORT_LABELS: Record<EventReport['reason'], string> = {
  misleading: 'Misleading details',
  inappropriate: 'Inappropriate',
  spam: 'Spam',
  duplicate: 'Duplicate',
  other: 'Something else',
};

function Overview({ onOpen }: { onOpen: (tab: Tab) => void }) {
  const [stats, setStats] = useState<PlatformStats | null>(null);
  useEffect(() => {
    adminApi
      .stats()
      .then(setStats)
      .catch((err) => toast.error(errorMessage(err)));
  }, []);

  if (!stats)
    return (
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="h-28 animate-pulse rounded-2xl bg-surface-muted" />
        ))}
      </div>
    );

  const cards = [
    { label: 'Members', value: stats.users.byRole.member, icon: <Users /> },
    { label: 'Organizers', value: stats.users.byRole.organizer, icon: <Megaphone /> },
    { label: 'Admins', value: stats.users.byRole.admin, icon: <ShieldCheck /> },
    { label: 'Suspended', value: stats.users.suspended, icon: <UserX /> },
    { label: 'Upcoming events', value: stats.events.upcoming, icon: <CalendarDays /> },
    { label: 'Public events', value: stats.events.total, icon: <CalendarDays />, hint: 'All time' },
    { label: 'Registrations', value: stats.registrations, icon: <Ticket /> },
    { label: 'Pending requests', value: stats.pendingApplications, icon: <Inbox /> },
    { label: 'Open reports', value: stats.openReports, icon: <Flag /> },
  ];

  return (
    <div className="space-y-6">
      {stats.pendingApplications > 0 && (
        <button
          onClick={() => onOpen('applications')}
          className="flex w-full items-center justify-between gap-4 rounded-2xl border border-warning/30 bg-warning-soft p-4 text-left transition hover:brightness-[0.98]"
        >
          <span className="flex items-center gap-3 text-sm font-medium">
            <Inbox className="size-5 text-warning" />
            {stats.pendingApplications} organizer request{stats.pendingApplications === 1 ? '' : 's'} waiting for review
          </span>
          <span className="text-sm font-medium text-warning">Review →</span>
        </button>
      )}
      <Stagger className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {cards.map((c) => (
          <StaggerItem key={c.label} className="h-full">
            <StatCard label={c.label} value={c.value} icon={c.icon} hint={c.hint} />
          </StaggerItem>
        ))}
      </Stagger>
    </div>
  );
}

function People() {
  const { user: me } = useAuth();
  const [query, setQuery] = useState('');
  const [role, setRole] = useState<Role | ''>('');
  const [status, setStatus] = useState<UserStatus | ''>('');
  const [page, setPage] = useState(1);
  const [users, setUsers] = useState<User[] | null>(null);
  const [meta, setMeta] = useState<PageMeta | null>(null);
  const [suspending, setSuspending] = useState<User | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      adminApi
        .users({ q: query.trim() || undefined, role: role || undefined, status: status || undefined, page, limit: 20 })
        .then(({ items, meta: m }) => {
          setUsers(items);
          setMeta(m);
        })
        .catch((err) => toast.error(errorMessage(err)));
    }, 250);
    return () => clearTimeout(timer);
  }, [query, role, status, page]);

  async function update(target: User, change: { role?: Role; status?: UserStatus }) {
    try {
      const updated = await adminApi.updateUser(target.id, change);
      setUsers((prev) => prev?.map((u) => (u.id === updated.id ? updated : u)) ?? prev);
      toast.success(
        change.status === 'suspended'
          ? `${target.name} suspended`
          : change.status === 'active'
            ? `${target.name} reinstated`
            : `${target.name} is now ${ROLE_LABELS[updated.role]}`
      );
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-border p-4 md:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
          <input
            type="search"
            placeholder="Search name, email or organization"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
            aria-label="Search people"
            className="h-11 w-full rounded-xl border border-border bg-surface-muted pl-9 pr-3 text-sm outline-none transition focus:border-primary focus:bg-surface focus:ring-4 focus:ring-ring/20"
          />
        </div>
        <Select
          value={role}
          onChange={(e) => {
            setRole(e.target.value as Role | '');
            setPage(1);
          }}
          aria-label="Filter by role"
          className="md:w-40"
        >
          <option value="">All roles</option>
          {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </Select>
        <Select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as UserStatus | '');
            setPage(1);
          }}
          aria-label="Filter by status"
          className="md:w-40"
        >
          <option value="">Any status</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
        </Select>
      </div>

      {users === null ? (
        <div className="space-y-px">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="h-16 animate-pulse bg-surface-muted/60" />
          ))}
        </div>
      ) : users.length === 0 ? (
        <p className="p-12 text-center text-sm text-muted">No one matches.</p>
      ) : (
        <ul className="divide-y divide-border">
          {users.map((u) => {
            const isMe = u.id === me?.id;
            return (
              <li key={u.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <Avatar name={u.name} src={u.avatarUrl} size={38} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {u.name} {isMe && <span className="text-muted">(you)</span>}
                    </p>
                    <p className="truncate text-xs text-muted">
                      {u.email}
                      {u.organization && ` · ${u.organization}`} · joined {formatDay(u.createdAt)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {u.status === 'suspended' && <Badge tone="danger">Suspended</Badge>}
                  {!u.emailVerified && <Badge>Unverified</Badge>}
                  <Select
                    value={u.role}
                    disabled={isMe}
                    onChange={(e) => update(u, { role: e.target.value as Role })}
                    aria-label={`Role for ${u.name}`}
                    className="h-9 w-36 text-xs"
                  >
                    {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </option>
                    ))}
                  </Select>
                  {!isMe &&
                    (u.status === 'active' ? (
                      <Button variant="ghost" size="sm" onClick={() => setSuspending(u)} className="hover:text-danger">
                        <UserX /> Suspend
                      </Button>
                    ) : (
                      <Button variant="soft" size="sm" onClick={() => update(u, { status: 'active' })}>
                        <UserCheck /> Reinstate
                      </Button>
                    ))}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {meta && meta.totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm text-muted">
          <span>
            Page {meta.page} of {meta.totalPages}
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <Button variant="secondary" size="sm" disabled={page >= meta.totalPages} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(suspending)}
        onClose={() => setSuspending(null)}
        onConfirm={async () => {
          if (suspending) await update(suspending, { status: 'suspended' });
        }}
        title={`Suspend ${suspending?.name ?? ''}?`}
        description="They'll be signed out immediately and can't sign in until reinstated."
        confirmLabel="Suspend"
      />
    </Card>
  );
}

function Applications() {
  const [filter, setFilter] = useState<OrganizerApplication['status']>('pending');
  const [items, setItems] = useState<OrganizerApplication[] | null>(null);
  const [rejecting, setRejecting] = useState<OrganizerApplication | null>(null);
  const [note, setNote] = useState('');

  const load = useCallback(() => {
    setItems(null);
    adminApi
      .applications({ status: filter, limit: 50 })
      .then(({ items: list }) => setItems(list))
      .catch((err) => toast.error(errorMessage(err)));
  }, [filter]);
  useEffect(load, [load]);

  async function review(application: OrganizerApplication, approve: boolean, reviewNote = '') {
    try {
      await (approve ? adminApi.approve(application.id) : adminApi.reject(application.id, reviewNote));
      toast.success(approve ? 'Approved' : 'Request declined', {
        description: approve ? 'They can publish events now.' : undefined,
      });
      setItems((prev) => prev?.filter((a) => a.id !== application.id) ?? null);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <div className="space-y-4">
      <Segmented
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'pending', label: 'Pending' },
          { value: 'approved', label: 'Approved' },
          { value: 'rejected', label: 'Declined' },
        ]}
      />
      {!items ? (
        <div className="grid gap-4 md:grid-cols-2">
          {[0, 1].map((i) => (
            <div key={i} className="h-44 animate-pulse rounded-2xl bg-surface-muted" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          emoji={filter === 'pending' ? '📭' : '🗂️'}
          title={filter === 'pending' ? 'Inbox zero' : `No ${filter === 'rejected' ? 'declined' : filter} requests`}
          description={filter === 'pending' ? 'No organizer requests are waiting.' : undefined}
        />
      ) : (
        <Stagger key={filter} className="grid gap-4 md:grid-cols-2">
          {items.map((a) => {
            const applicant = typeof a.user === 'string' ? null : a.user;
            return (
              <StaggerItem key={a.id}>
                <Card className="flex h-full flex-col p-5">
                  <div className="flex items-start gap-3">
                    <Avatar name={applicant?.name ?? '?'} src={applicant?.avatarUrl} size={40} />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">{a.organization}</p>
                      <p className="truncate text-sm text-muted">
                        {applicant?.name} · {applicant?.email}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs text-subtle">{formatRelative(a.createdAt)}</span>
                  </div>
                  {a.reason && <p className="mt-4 whitespace-pre-wrap rounded-xl bg-surface-muted p-3 text-sm">{a.reason}</p>}
                  <div className="mt-auto pt-4">
                    {a.status === 'pending' ? (
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => review(a, true)}>
                          <Check /> Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setNote('');
                            setRejecting(a);
                          }}
                        >
                          <X /> Decline
                        </Button>
                      </div>
                    ) : (
                      <p className="text-xs text-muted">
                        {a.status === 'approved' ? 'Approved' : 'Declined'} by {a.reviewedBy?.name ?? 'an admin'}
                        {a.reviewedAt ? ` on ${formatDay(a.reviewedAt)}` : ''}
                        {a.reviewNote ? ` · “${a.reviewNote}”` : ''}
                      </p>
                    )}
                  </div>
                </Card>
              </StaggerItem>
            );
          })}
        </Stagger>
      )}

      <ConfirmDialog
        open={Boolean(rejecting)}
        onClose={() => setRejecting(null)}
        onConfirm={async () => {
          if (rejecting) await review(rejecting, false, note);
        }}
        title={`Decline ${rejecting?.organization ?? ''}?`}
        description="They'll be notified and can apply again."
        confirmLabel="Decline request"
      >
        <label htmlFor="decline-note" className="mb-1.5 block text-sm font-medium">
          Note to the applicant (optional)
        </label>
        <Textarea
          id="decline-note"
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Please apply with your club email address."
        />
      </ConfirmDialog>
    </div>
  );
}

/** Reports raised by members. Closing one as `reviewed` cancels the event. */
function Reports() {
  const [filter, setFilter] = useState<EventReport['status']>('open');
  const [items, setItems] = useState<EventReport[] | null>(null);
  const [cancelling, setCancelling] = useState<EventReport | null>(null);
  const [reason, setReason] = useState('');

  const load = useCallback(() => {
    adminApi
      .reports({ status: filter, limit: 20 })
      .then((page) => setItems(page.items))
      .catch((err) => {
        toast.error(errorMessage(err));
        setItems([]);
      });
  }, [filter]);

  useEffect(load, [load]);

  async function resolve(id: string, status: 'reviewed' | 'dismissed', why = '') {
    try {
      await adminApi.resolveReport(id, status, why);
      toast.success(status === 'reviewed' ? 'Event cancelled. Attendees and the organiser have been told.' : 'Report dismissed.');
      load();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-semibold">Reported events</h2>
          <p className="mt-0.5 text-xs text-muted">Marking a report reviewed cancels the event and notifies its attendees.</p>
        </div>
        <Segmented<EventReport['status']>
          size="sm"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'open', label: 'Open' },
            { value: 'reviewed', label: 'Reviewed' },
            { value: 'dismissed', label: 'Dismissed' },
          ]}
        />
      </div>

      {items === null ? (
        <div className="space-y-2 p-4">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-surface-muted" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="px-4 py-12 text-center text-sm text-muted">
          {filter === 'open' ? 'Nothing reported. 🎉' : 'No reports here.'}
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((report) => (
            <li key={report.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Badge tone={report.status === 'open' ? 'warning' : 'neutral'}>{REPORT_LABELS[report.reason]}</Badge>
                    <span className="text-xs text-muted">
                      by {report.reporter?.name ?? 'someone'} · {formatRelative(report.createdAt)}
                    </span>
                  </div>
                  {report.event ? (
                    <Link href={`/events/${report.event.id}`} className="mt-1.5 block font-medium hover:underline">
                      {report.event.title}
                    </Link>
                  ) : (
                    <p className="mt-1.5 text-sm text-muted">The event has since been deleted.</p>
                  )}
                  {report.details && <p className="mt-1 text-sm text-muted">{report.details}</p>}
                </div>

                {report.status === 'open' && (
                  <div className="flex shrink-0 gap-2">
                    <Button size="sm" variant="ghost" onClick={() => resolve(report.id, 'dismissed')}>
                      <X /> Dismiss
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setReason('');
                        setCancelling(report);
                      }}
                    >
                      <Check /> Cancel event
                    </Button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={Boolean(cancelling)}
        onClose={() => setCancelling(null)}
        onConfirm={async () => {
          if (cancelling) await resolve(cancelling.id, 'reviewed', reason);
        }}
        title={`Cancel “${cancelling?.event?.title ?? 'this event'}”?`}
        description="Everyone registered and the organiser are notified in the app and by email. This can't be undone."
        confirmLabel="Cancel event"
      >
        <label htmlFor="report-reason" className="mb-1.5 block text-sm font-medium">
          Reason, sent to attendees and the organiser (optional)
        </label>
        <Textarea
          id="report-reason"
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. This event breaks the campus events policy."
        />
      </ConfirmDialog>
    </Card>
  );
}

/** Every admin action, newest first: who did what to whom. */
function AuditLog() {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);

  useEffect(() => {
    adminApi
      .auditLog({ page, limit: 30 })
      .then(({ items, meta }) => {
        setEntries((prev) => (page === 1 ? items : [...(prev ?? []), ...items]));
        setHasMore(meta.page < meta.totalPages);
      })
      .catch((err) => toast.error(errorMessage(err)));
  }, [page]);

  if (!entries) return <div className="h-64 animate-pulse rounded-3xl bg-surface-muted" />;
  if (!entries.length)
    return (
      <EmptyState emoji="🗂️" title="No admin actions yet" description="Suspensions, approvals and takedowns will show up here." />
    );
  return (
    <Card className="overflow-hidden">
      <ul className="divide-y divide-border">
        {entries.map((e) => (
          <li key={e.id} className="flex items-center gap-3 px-4 py-3">
            <Avatar name={e.actor?.name ?? '?'} src={e.actor?.avatarUrl} size={32} />
            <div className="min-w-0 flex-1">
              <p className="text-sm">
                <span className="font-medium">{e.actor?.name ?? 'Deleted admin'}</span> · {e.summary}
              </p>
              <p className="text-xs text-muted">{formatDateTime(e.createdAt)}</p>
            </div>
          </li>
        ))}
      </ul>
      {hasMore && (
        <div className="border-t border-border p-3 text-center">
          <Button variant="secondary" size="sm" onClick={() => setPage((p) => p + 1)}>
            Load more
          </Button>
        </div>
      )}
    </Card>
  );
}

export default function AdminConsole() {
  const router = useRouter();
  const params = useSearchParams();
  const requested = params.get('tab') as Tab | null;
  const tab: Tab =
    requested === 'users' || requested === 'applications' || requested === 'reports' || requested === 'audit'
      ? requested
      : 'overview';
  const setTab = (next: Tab) => router.replace(next === 'overview' ? '/admin' : `/admin?tab=${next}`, { scroll: false });

  return (
    <>
      <PageHeader
        kicker="Platform admin"
        title={
          <>
            Admin <em>HQ</em>
          </>
        }
        description="People, organizer approvals and what’s happening across the platform."
      />
      <Segmented<Tab>
        value={tab}
        onChange={setTab}
        className="mb-6"
        options={[
          { value: 'overview', label: 'Overview' },
          { value: 'users', label: 'People' },
          { value: 'applications', label: 'Organizer requests' },
          { value: 'reports', label: 'Reports' },
          { value: 'audit', label: 'Audit log' },
        ]}
      />
      {tab === 'overview' && <Overview onOpen={setTab} />}
      {tab === 'users' && <People />}
      {tab === 'applications' && <Applications />}
      {tab === 'reports' && <Reports />}
      {tab === 'audit' && <AuditLog />}
    </>
  );
}
