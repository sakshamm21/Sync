'use client';

import React, { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { toast } from 'sonner';
import { Check, Clock, Megaphone, Monitor, Moon, Sun, XCircle } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useEventsSync } from '@/context/EventContext';
import { errorMessage, meApi, metaApi, organizerApi, type CategoryValue, type OrganizerApplication } from '@/lib/api';
import { CATEGORIES, CATEGORY_EMOJI, CATEGORY_LABELS, ROLE_LABELS, formatDay } from '@/lib/format';
import { Button, ButtonLink } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/field';
import { Avatar, Badge, Card, PageHeader } from '@/components/ui/surface';
import { Segmented } from '@/components/ui/tabs';
import { ConfirmDialog } from '@/components/ui/overlay';
import { currentPushSubscription, pushSupported, subscribeToPush, useInstallPrompt } from '@/lib/device';
import { cn } from '@/lib/cn';

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <Card className="grid gap-6 p-6 sm:p-8 md:grid-cols-[16rem_1fr]">
      <div>
        <h2 className="font-display text-xl font-extrabold">{title}</h2>
        <p className="mt-1 text-sm text-muted">{description}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </Card>
  );
}

function ProfileSection() {
  const { user, setUser } = useAuth();
  const { eventsChanged } = useEventsSync();
  const [name, setName] = useState(user?.name ?? '');
  const [bio, setBio] = useState(user?.bio ?? '');
  const [avatarUrl, setAvatarUrl] = useState(user?.avatarUrl ?? '');
  const [interests, setInterests] = useState<CategoryValue[]>(user?.interests ?? []);
  const [emailNotifications, setEmailNotifications] = useState(user?.preferences.emailNotifications ?? true);
  const [saving, setSaving] = useState(false);

  const toggleInterest = (value: CategoryValue) =>
    setInterests((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      setUser(await meApi.update({ name, bio, avatarUrl: avatarUrl.trim(), interests, preferences: { emailNotifications } }));
      eventsChanged(); // Recommendations depend on interests.
      toast.success('Profile saved');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-6">
      <Section title="Profile" description="How you appear to organizers and other attendees.">
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <Avatar name={name || user?.name || '?'} src={avatarUrl.trim() || undefined} size={64} />
            <Field label="Profile picture URL" htmlFor="profile-avatar" className="flex-1">
              <Input
                id="profile-avatar"
                type="url"
                placeholder="https://…"
                value={avatarUrl}
                onChange={(e) => setAvatarUrl(e.target.value)}
              />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" htmlFor="profile-name">
              <Input id="profile-name" value={name} onChange={(e) => setName(e.target.value)} required />
            </Field>
            <Field label="Email" htmlFor="profile-email" hint="Used to sign in. It can't be changed.">
              <Input id="profile-email" value={user?.email ?? ''} disabled />
            </Field>
          </div>
          <Field label="About you" htmlFor="profile-bio">
            <Textarea
              id="profile-bio"
              rows={2}
              maxLength={500}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="A line about you"
            />
          </Field>
        </div>
      </Section>

      <Section title="Your vibes" description="Pick what you’re into. It powers “Picked for you” on Home.">
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((c) => {
            const on = interests.includes(c);
            return (
              <button
                key={c}
                type="button"
                aria-pressed={on}
                onClick={() => toggleInterest(c)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition',
                  on
                    ? 'border-transparent bg-primary text-primary-foreground'
                    : 'border-border text-muted hover:border-border-strong hover:text-foreground'
                )}
              >
                {on ? <Check className="size-3.5" /> : <span aria-hidden="true">{CATEGORY_EMOJI[c]}</span>}
                {CATEGORY_LABELS[c]}
              </button>
            );
          })}
        </div>
      </Section>

      <Section title="Notifications" description="In-app notifications are always on.">
        <label className="flex cursor-pointer items-start justify-between gap-4 rounded-xl border border-border p-4">
          <span>
            <span className="block text-sm font-medium">Email me too</span>
            <span className="block text-sm text-muted">
              Reminders, changes and announcements for events you&apos;re attending.
            </span>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={emailNotifications}
            onClick={() => setEmailNotifications((v) => !v)}
            className={cn(
              'relative h-6 w-11 shrink-0 rounded-full transition',
              emailNotifications ? 'bg-primary' : 'bg-border-strong'
            )}
          >
            <span
              className={cn(
                'absolute top-0.5 size-5 rounded-full bg-white shadow transition-all',
                emailNotifications ? 'left-[22px]' : 'left-0.5'
              )}
            />
          </button>
        </label>
      </Section>

      <div className="flex justify-end">
        <Button type="submit" loading={saving}>
          Save changes
        </Button>
      </div>
    </form>
  );
}

function AppearanceSection() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return (
    <Section title="Appearance" description="Match your system, or pick a theme.">
      {mounted && (
        <Segmented
          value={(theme as 'system' | 'light' | 'dark') ?? 'system'}
          onChange={setTheme}
          options={[
            {
              value: 'system',
              label: (
                <>
                  <Monitor className="size-4" /> System
                </>
              ),
            },
            {
              value: 'light',
              label: (
                <>
                  <Sun className="size-4" /> Light
                </>
              ),
            },
            {
              value: 'dark',
              label: (
                <>
                  <Moon className="size-4" /> Dark
                </>
              ),
            },
          ]}
        />
      )}
    </Section>
  );
}

function OrganizerSection() {
  const { user } = useAuth();
  const [application, setApplication] = useState<OrganizerApplication | null | undefined>(undefined);
  const [organization, setOrganization] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (user?.role !== 'member') return;
    organizerApi
      .latestApplication()
      .then(setApplication)
      .catch(() => setApplication(null));
  }, [user?.role]);

  if (!user) return null;

  if (user.role !== 'member') {
    return (
      <Section title="Organizer access" description="Publish public events and manage attendees.">
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border p-4">
          <div>
            <Badge tone="primary">{ROLE_LABELS[user.role]}</Badge>
            <p className="mt-2 text-sm text-muted">
              You can publish public events{user.organization ? ` for ${user.organization}` : ''}.
            </p>
          </div>
          <ButtonLink href="/organizer" variant="secondary">
            <Megaphone /> Organizer console
          </ButtonLink>
        </div>
      </Section>
    );
  }

  async function apply(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      setApplication(await organizerApi.apply({ organization, reason }));
      toast.success('Application sent', { description: "We'll notify you once an admin reviews it." });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  const pending = application?.status === 'pending';

  return (
    <Section
      title="Host your own events"
      description="Organizers publish public events, manage RSVPs and waitlists, check people in and send announcements."
    >
      <div className="space-y-4">
        {application && (
          <div
            className={cn(
              'flex gap-3 rounded-xl border p-4 text-sm',
              application.status === 'pending' && 'border-warning/30 bg-warning-soft',
              application.status === 'approved' && 'border-success/30 bg-success-soft',
              application.status === 'rejected' && 'border-border bg-surface-muted'
            )}
          >
            {application.status === 'pending' ? (
              <Clock className="mt-0.5 size-4 shrink-0 text-warning" />
            ) : application.status === 'approved' ? (
              <Check className="mt-0.5 size-4 shrink-0 text-success" />
            ) : (
              <XCircle className="mt-0.5 size-4 shrink-0 text-muted" />
            )}
            <p>
              {application.status === 'pending' &&
                `Your application for ${application.organization} (sent ${formatDay(application.createdAt)}) is being reviewed.`}
              {application.status === 'approved' && 'Approved! Organizer tools are now in the sidebar.'}
              {application.status === 'rejected' &&
                `Your application for ${application.organization} wasn't approved.${application.reviewNote ? ` Reviewer's note: “${application.reviewNote}”` : ''} You can apply again.`}
            </p>
          </div>
        )}
        {!pending && application !== undefined && (
          <form onSubmit={apply} className="space-y-4">
            <Field label="Club or organization" htmlFor="org-name">
              <Input
                id="org-name"
                value={organization}
                onChange={(e) => setOrganization(e.target.value)}
                required
                minLength={2}
                placeholder="e.g. Robotics Club"
              />
            </Field>
            <Field label="What will you host?" htmlFor="org-reason" hint="Optional, but it helps the review.">
              <Textarea id="org-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
            <Button type="submit" loading={submitting}>
              Apply to be an organizer
            </Button>
          </form>
        )}
      </div>
    </Section>
  );
}

function PasswordSection() {
  const { startSession } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [saving, setSaving] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      startSession(await meApi.changePassword({ currentPassword, newPassword }));
      setCurrentPassword('');
      setNewPassword('');
      toast.success('Password changed', { description: 'Your other devices have been signed out.' });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section title="Password" description="Changing it signs you out everywhere else.">
      <form onSubmit={save} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Current password" htmlFor="current-password">
            <Input
              id="current-password"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
            />
          </Field>
          <Field label="New password" htmlFor="new-password" hint="8 or more characters.">
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
            />
          </Field>
        </div>
        <Button type="submit" variant="secondary" loading={saving}>
          Update password
        </Button>
      </form>
    </Section>
  );
}

/** A subscription link calendar apps keep refreshing, so moved or cancelled events update by themselves. */
function CalendarFeedSection() {
  const [feed, setFeed] = useState<{ url: string; webcalUrl: string } | null>(null);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    meApi
      .calendarFeed()
      .then(setFeed)
      .catch(() => setFeed(null));
  }, []);

  async function copy() {
    if (!feed) return;
    await navigator.clipboard.writeText(feed.url);
    toast.success('Link copied', { description: 'Paste it into "Subscribe to calendar" / "From URL".' });
  }

  return (
    <Section
      title="Calendar subscription"
      description="Everything you're going to, your plans and events you run, in Google, Apple or Outlook Calendar. Changes show up there by themselves."
    >
      {!feed ? (
        <div className="h-10 animate-pulse rounded-xl bg-surface-muted" />
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <ButtonLink href={feed.webcalUrl} variant="primary">
              Subscribe
            </ButtonLink>
            <ButtonLink
              href={`https://calendar.google.com/calendar/render?cid=${encodeURIComponent(feed.webcalUrl)}`}
              target="_blank"
              rel="noopener noreferrer"
              variant="secondary"
            >
              Add to Google Calendar
            </ButtonLink>
            <Button variant="secondary" onClick={copy}>
              Copy link
            </Button>
          </div>
          <p className="text-xs text-muted">
            Keep this link private: anyone with it can see your schedule.{' '}
            <button
              className="font-medium text-foreground underline underline-offset-2"
              disabled={resetting}
              onClick={async () => {
                setResetting(true);
                try {
                  setFeed(await meApi.calendarFeed(true));
                  toast.success('New link made', { description: 'The old link has stopped working.' });
                } catch (err) {
                  toast.error(errorMessage(err));
                } finally {
                  setResetting(false);
                }
              }}
            >
              Make a new link
            </button>
          </p>
        </div>
      )}
    </Section>
  );
}

/** Notifications on this phone or laptop, and installing Sync like an app. */
function DeviceSection() {
  const [publicKey, setPublicKey] = useState<string | null | undefined>(undefined);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const { available: canInstall, install } = useInstallPrompt();

  useEffect(() => {
    metaApi
      .get()
      .then((meta) => setPublicKey(meta.pushPublicKey ?? null))
      .catch(() => setPublicKey(null));
    currentPushSubscription()
      .then((s) => setSubscribed(Boolean(s)))
      .catch(() => {});
  }, []);

  async function toggle() {
    setBusy(true);
    try {
      if (subscribed) {
        const sub = await currentPushSubscription();
        if (sub) {
          await meApi.removePushSubscription(sub.endpoint);
          await sub.unsubscribe();
        }
        setSubscribed(false);
        toast('Notifications off on this device');
      } else {
        await meApi.addPushSubscription(await subscribeToPush(publicKey!));
        setSubscribed(true);
        toast.success('Notifications on', { description: 'Reminders and updates will pop up here, even with Sync closed.' });
      }
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const pushAvailable = Boolean(publicKey) && pushSupported();
  return (
    <Section
      title="This device"
      description="Get reminders and updates as phone or desktop notifications, and add Sync to your home screen."
    >
      <div className="flex flex-wrap gap-2">
        {pushAvailable && (
          <Button variant={subscribed ? 'secondary' : 'primary'} loading={busy} onClick={toggle}>
            {subscribed ? 'Turn off notifications' : 'Turn on notifications'}
          </Button>
        )}
        {canInstall && (
          <Button variant="secondary" onClick={install}>
            Install app
          </Button>
        )}
      </div>
      {publicKey !== undefined && !pushAvailable && (
        <p className="text-sm text-muted">
          {publicKey
            ? 'This browser can’t show push notifications. On iPhone, add Sync to your Home Screen first.'
            : 'Push notifications aren’t set up on this server yet.'}
        </p>
      )}
    </Section>
  );
}

function SessionsSection() {
  const { logout } = useAuth();
  const [confirming, setConfirming] = useState(false);

  return (
    <Section title="Devices" description="Lost a phone or signed in on a shared computer? End every session at once.">
      <Button variant="secondary" onClick={() => setConfirming(true)}>
        Sign out of all devices
      </Button>
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={async () => {
          try {
            await meApi.signOutEverywhere();
            toast.success('Signed out everywhere');
            logout();
          } catch (err) {
            toast.error(errorMessage(err));
          }
        }}
        title="Sign out of all devices?"
        description="Every device signed in to this account, including this one, will need to sign in again."
        confirmLabel="Sign out everywhere"
      />
    </Section>
  );
}

/** Download everything we hold, or delete the account for good. */
function DataSection() {
  const { logout } = useAuth();
  const [downloading, setDownloading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [password, setPassword] = useState('');

  return (
    <Section title="Your data" description="Download a copy of everything Sync holds about you, or delete your account.">
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          loading={downloading}
          onClick={async () => {
            setDownloading(true);
            try {
              await meApi.downloadData();
            } catch (err) {
              toast.error(errorMessage(err));
            } finally {
              setDownloading(false);
            }
          }}
        >
          Download my data
        </Button>
        <Button variant="ghost" className="text-danger" onClick={() => setDeleting(true)}>
          Delete my account
        </Button>
      </div>
      <ConfirmDialog
        open={deleting}
        onClose={() => {
          setDeleting(false);
          setPassword('');
        }}
        onConfirm={async () => {
          try {
            await meApi.deleteAccount(password);
            toast.success('Your account has been deleted');
            logout();
          } catch (err) {
            toast.error(errorMessage(err));
            throw err;
          }
        }}
        title="Delete your account?"
        description="Your tickets, plans, notes, messages and ratings are deleted, and events you're hosting that haven't happened yet are cancelled (attendees are told). This can't be undone."
        confirmLabel="Delete for good"
      >
        <Field label="Your password" htmlFor="delete-password">
          <Input
            id="delete-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
      </ConfirmDialog>
    </Section>
  );
}

export default function SettingsView() {
  return (
    <>
      <PageHeader
        kicker="Profile, vibes & account"
        title={
          <>
            Your <em>settings</em>
          </>
        }
      />
      <div className="space-y-6">
        <ProfileSection />
        <AppearanceSection />
        <OrganizerSection />
        <DeviceSection />
        <CalendarFeedSection />
        <PasswordSection />
        <SessionsSection />
        <DataSection />
      </div>
    </>
  );
}
