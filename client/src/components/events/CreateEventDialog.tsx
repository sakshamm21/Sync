'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Check, Globe, ImageUp, Lock, MapPin } from 'lucide-react';
import { uploadCover } from '@/lib/uploads';
import { useAuth } from '@/context/AuthContext';
import { useEventsSync } from '@/context/EventContext';
import { ApiError, errorMessage, eventsApi, metaApi, type CategoryValue, type EventInput, type SyncEvent } from '@/lib/api';
import {
  CATEGORIES,
  CATEGORY_EMOJI,
  CATEGORY_LABELS,
  campusDateKey,
  formatEventWhen,
  fromDateTimeInput,
  toDateTimeInput,
} from '@/lib/format';
import { ConfirmDialog, Dialog } from '@/components/ui/overlay';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/field';
import VenueMap, { type PickedLocation } from '@/components/map/VenueMap';
import { usePlaceSearch } from '@/components/map/usePlaceSearch';
import { cn } from '@/lib/cn';

// ---------------------------------------------------------------------------
// Launcher: any screen can open the dialog (top bar, calendar, organizer list).
// ---------------------------------------------------------------------------

interface OpenOptions {
  /** Edit this event instead of creating a new one. */
  event?: SyncEvent;
  /** Pre-fill the start date (e.g. a day clicked on the calendar). */
  date?: Date;
  /** Start a new event as a copy of this one ("Duplicate"). */
  copyFrom?: SyncEvent;
}

const CreateEventContext = createContext<{ openCreateEvent: (options?: OpenOptions) => void } | null>(null);

export function CreateEventProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<{ open: boolean } & OpenOptions>({ open: false });
  const openCreateEvent = useCallback((options: OpenOptions = {}) => setState({ open: true, ...options }), []);
  const value = useMemo(() => ({ openCreateEvent }), [openCreateEvent]);

  return (
    <CreateEventContext.Provider value={value}>
      {children}
      <CreateEventDialog
        open={state.open}
        event={state.event}
        date={state.date}
        copyFrom={state.copyFrom}
        onClose={() => setState((prev) => ({ ...prev, open: false }))}
      />
    </CreateEventContext.Provider>
  );
}

export function useCreateEvent() {
  const context = useContext(CreateEventContext);
  if (!context) throw new Error('useCreateEvent must be used within a CreateEventProvider');
  return context;
}

// ---------------------------------------------------------------------------
// The form
// ---------------------------------------------------------------------------

interface FormState {
  title: string;
  description: string;
  category: CategoryValue;
  startsAt: string;
  endsAt: string;
  venueName: string;
  venueAddress: string;
  latitude?: number;
  longitude?: number;
  onlineUrl: string;
  tags: string;
  coverImageUrl: string;
  capacity: string;
  /** Optional sign-up window, as campus wall-clock datetime-local values. */
  registrationOpensAt: string;
  registrationClosesAt: string;
  /** '' = move people in automatically; otherwise hours a freed seat is held. */
  waitlistClaimHours: string;
  /** Asked at RSVP time; choice options are typed comma-separated. */
  questions: { label: string; kind: 'text' | 'choice'; options: string; required: boolean }[];
  requiresApproval: boolean;
  /** '' = one-off; otherwise "week:4" / "fortnight:6" (only when creating). */
  repeat: string;
  /** Team event sizes as typed; both empty = individual sign-up. */
  teamMin: string;
  teamMax: string;
  isPublic: boolean;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** A copy keeps the weekday and time, moved forward whole weeks until it is in the future. */
function copyOf(event: SyncEvent, canPublish: boolean): FormState {
  const start = new Date(event.startsAt).getTime();
  const length = new Date(event.endsAt).getTime() - start;
  const weeks = Math.max(1, Math.ceil((Date.now() - start) / WEEK_MS));
  const nextStart = new Date(start + weeks * WEEK_MS);
  return {
    ...initialState(event, canPublish),
    startsAt: toDateTimeInput(nextStart),
    endsAt: toDateTimeInput(new Date(nextStart.getTime() + length)),
    isPublic: event.visibility === 'public' && canPublish,
  };
}

function initialState(event: SyncEvent | undefined, canPublish: boolean, date?: Date, copyFrom?: SyncEvent): FormState {
  if (copyFrom) return copyOf(copyFrom, canPublish);
  if (event) {
    return {
      title: event.title,
      description: event.description,
      category: event.category,
      startsAt: toDateTimeInput(new Date(event.startsAt)),
      endsAt: toDateTimeInput(new Date(event.endsAt)),
      venueName: event.venue?.name ?? '',
      venueAddress: event.venue?.address ?? '',
      latitude: event.venue?.latitude,
      longitude: event.venue?.longitude,
      onlineUrl: event.onlineUrl,
      tags: event.tags.join(', '),
      coverImageUrl: event.coverImageUrl,
      capacity: event.capacity ? String(event.capacity) : '',
      registrationOpensAt: event.registrationOpensAt ? toDateTimeInput(new Date(event.registrationOpensAt)) : '',
      registrationClosesAt: event.registrationClosesAt ? toDateTimeInput(new Date(event.registrationClosesAt)) : '',
      waitlistClaimHours: event.waitlistClaimHours ? String(event.waitlistClaimHours) : '',
      questions: (event.questions ?? []).map((q) => ({
        label: q.label,
        kind: q.kind,
        options: q.options.join(', '),
        required: q.required,
      })),
      requiresApproval: Boolean(event.requiresApproval),
      repeat: '',
      teamMin: event.teamSize ? String(event.teamSize.min) : '',
      teamMax: event.teamSize ? String(event.teamSize.max) : '',
      isPublic: event.visibility === 'public',
    };
  }
  let start = date ? new Date(date) : new Date(Date.now() + 24 * 60 * 60 * 1000);
  // No time picked (a day clicked on the calendar, or "new event"): default to 6 pm campus time.
  if (!date || start.getHours() === 0) start = fromDateTimeInput(`${campusDateKey(start)}T18:00`);
  return {
    title: '',
    description: '',
    category: 'tech',
    startsAt: toDateTimeInput(start),
    endsAt: toDateTimeInput(new Date(start.getTime() + 2 * 60 * 60 * 1000)),
    venueName: '',
    venueAddress: '',
    onlineUrl: '',
    tags: '',
    coverImageUrl: '',
    capacity: '',
    registrationOpensAt: '',
    registrationClosesAt: '',
    waitlistClaimHours: '',
    questions: [],
    requiresApproval: false,
    repeat: '',
    teamMin: '',
    teamMax: '',
    isPublic: canPublish,
  };
}

const parseTags = (value: string) =>
  [
    ...new Set(
      value
        .split(',')
        .map((t) => t.trim().replace(/^#/, '').toLowerCase())
        .filter(Boolean)
    ),
  ].slice(0, 10);

function CreateEventDialog({
  open,
  event,
  date,
  copyFrom,
  onClose,
}: {
  open: boolean;
  event?: SyncEvent;
  date?: Date;
  copyFrom?: SyncEvent;
  onClose: () => void;
}) {
  // Closing by Escape, the backdrop or the X asks first if anything was typed.
  const dirty = useRef(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const requestClose = () => (dirty.current ? setConfirmDiscard(true) : onClose());
  useEffect(() => {
    if (open) dirty.current = false;
  }, [open]);

  return (
    <>
      <ConfirmDialog
        open={confirmDiscard}
        onClose={() => setConfirmDiscard(false)}
        onConfirm={() => {
          dirty.current = false;
          onClose();
        }}
        title={event ? 'Discard your changes?' : 'Discard this event?'}
        description="What you've typed will be lost."
        confirmLabel="Discard"
      />
      <Dialog
        open={open}
        onClose={requestClose}
        size="lg"
        title={
          event ? (
            <>
              Edit <em>event</em>
            </>
          ) : (
            <>
              Drop an <em>event</em>
            </>
          )
        }
        description={
          event
            ? 'Attendees are notified if the time or place changes.'
            : 'Share it with campus, or keep it on your own calendar.'
        }
      >
        {/* Remounting resets the form every time the dialog opens. */}
        {open && (
          <EventForm
            key={`${event?.id ?? copyFrom?.id ?? 'new'}-${date?.getTime() ?? ''}`}
            event={event}
            date={date}
            copyFrom={copyFrom}
            onDirtyChange={(d) => {
              dirty.current = d;
            }}
            onDone={onClose}
          />
        )}
      </Dialog>
    </>
  );
}

function EventForm({
  event,
  date,
  copyFrom,
  onDone,
  onDirtyChange,
}: {
  event?: SyncEvent;
  date?: Date;
  copyFrom?: SyncEvent;
  onDone: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const { user } = useAuth();
  const { eventsChanged } = useEventsSync();
  const canPublish = user?.role === 'organizer' || user?.role === 'admin';
  const isEdit = Boolean(event);
  const isDraft = event?.status === 'draft';

  const [form, setForm] = useState<FormState>(() => initialState(event, canPublish, date, copyFrom));
  const [pristine] = useState(() => JSON.stringify(form));
  useEffect(() => {
    onDirtyChange(JSON.stringify(form) !== pristine);
  }, [form, pristine, onDirtyChange]);
  const [venueQuery, setVenueQuery] = useState('');
  const [mapOpen, setMapOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [saving, setSaving] = useState<'publish' | 'draft' | null>(null);
  const places = usePlaceSearch(venueQuery);
  // Photo upload shows only when the server has a storage token.
  const [uploadsOn, setUploadsOn] = useState(false);
  const [uploading, setUploading] = useState(false);
  useEffect(() => {
    metaApi
      .get()
      .then((meta) => setUploadsOn(Boolean(meta.uploads)))
      .catch(() => {});
  }, []);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((prev) => ({ ...prev, [key]: value }));

  function typeVenue(value: string) {
    // Typing a new name drops coordinates picked earlier.
    setForm((prev) => ({ ...prev, venueName: value, venueAddress: '', latitude: undefined, longitude: undefined }));
    setVenueQuery(value);
  }

  function applyLocation(location: PickedLocation) {
    setForm((prev) => ({
      ...prev,
      venueName: location.name,
      venueAddress: location.address,
      latitude: location.latitude,
      longitude: location.longitude,
    }));
    setVenueQuery('');
    places.clear();
    setMapOpen(false);
  }

  function changeStart(value: string) {
    const previousDuration = fromDateTimeInput(form.endsAt).getTime() - fromDateTimeInput(form.startsAt).getTime();
    const newEnd = new Date(fromDateTimeInput(value).getTime() + Math.max(previousDuration, 60 * 60 * 1000));
    setForm((prev) => ({ ...prev, startsAt: value, endsAt: toDateTimeInput(newEnd) }));
  }

  async function save(asDraft: boolean) {
    const body: EventInput = {
      title: form.title,
      description: form.description,
      category: form.category,
      tags: parseTags(form.tags),
      startsAt: fromDateTimeInput(form.startsAt).toISOString(),
      endsAt: fromDateTimeInput(form.endsAt).toISOString(),
      coverImageUrl: form.coverImageUrl.trim(),
      onlineUrl: form.onlineUrl.trim(),
      venue: {
        name: form.venueName.trim() || undefined,
        address: form.venueAddress || undefined,
        latitude: form.latitude,
        longitude: form.longitude,
      },
    };
    if (form.isPublic) {
      body.capacity = form.capacity ? Number(form.capacity) : null;
      body.registrationOpensAt = form.registrationOpensAt ? fromDateTimeInput(form.registrationOpensAt).toISOString() : null;
      body.waitlistClaimHours = form.waitlistClaimHours ? Number(form.waitlistClaimHours) : null;
      body.requiresApproval = form.requiresApproval;
      body.teamSize =
        form.teamMax || form.teamMin ? { min: Number(form.teamMin || 1), max: Number(form.teamMax || form.teamMin || 1) } : null;
      body.questions = form.questions
        .filter((q) => q.label.trim())
        .map((q) => ({
          label: q.label.trim(),
          kind: q.kind,
          required: q.required,
          options:
            q.kind === 'choice'
              ? q.options
                  .split(',')
                  .map((o) => o.trim())
                  .filter(Boolean)
              : [],
        }));
      body.registrationClosesAt = form.registrationClosesAt ? fromDateTimeInput(form.registrationClosesAt).toISOString() : null;
      // Editing keeps the current status unless the user explicitly saves a draft or publishes one.
      if (!isEdit || isDraft) body.status = asDraft ? 'draft' : 'published';
    }
    if (!isEdit) body.visibility = form.isPublic ? 'public' : 'private';
    if (!isEdit && form.repeat) {
      const [every, count] = form.repeat.split(':');
      body.repeat = { every: every as 'week' | 'fortnight', count: Number(count) };
    }

    setSaving(asDraft ? 'draft' : 'publish');
    setErrors({});
    try {
      const saved = isEdit ? await eventsApi.update(event!.id, body) : await eventsApi.create(body);
      toast.success(
        isEdit ? 'Event updated' : asDraft ? 'Draft saved' : form.isPublic ? 'Event published' : 'Added to your calendar'
      );
      // Saved anyway, but two groups turning up to one room is worth knowing about.
      for (const clash of saved.venueClashes ?? []) {
        toast.warning(`${form.venueName || 'That venue'} is also booked`, {
          description: `${clash.title}, ${formatEventWhen(clash)}. Check with the venue or the other organiser.`,
          duration: 10_000,
        });
      }
      eventsChanged();
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'VALIDATION_ERROR') {
        const fieldErrors: Record<string, string> = {};
        for (const d of err.details) fieldErrors[d.field.replace(/^body\./, '').split('.')[0]] ??= d.message;
        setErrors(fieldErrors);
      }
      toast.error(errorMessage(err));
    } finally {
      setSaving(null);
    }
  }

  const submitLabel = isEdit && !isDraft ? 'Save changes' : form.isPublic ? 'Publish event' : 'Add to my calendar';
  const pinned = form.latitude != null && form.longitude != null;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save(false);
      }}
    >
      <div className="space-y-6 px-6 py-6">
        {canPublish && !isEdit && (
          <div className="grid grid-cols-2 gap-2">
            {[
              { value: true, label: 'Public event', hint: 'Anyone can find it and RSVP', icon: Globe },
              { value: false, label: 'Personal', hint: 'Only on your calendar', icon: Lock },
            ].map((option) => (
              <button
                key={option.label}
                type="button"
                onClick={() => set('isPublic', option.value)}
                className={cn(
                  'flex items-start gap-3 rounded-3xl border p-4 text-left transition',
                  form.isPublic === option.value
                    ? 'border-primary bg-primary-soft ring-4 ring-ring/15'
                    : 'border-border hover:border-border-strong'
                )}
              >
                <option.icon className={cn('mt-0.5 size-4', form.isPublic === option.value ? 'text-primary' : 'text-muted')} />
                <span>
                  <span className="block text-sm font-medium">{option.label}</span>
                  <span className="block text-xs text-muted">{option.hint}</span>
                </span>
              </button>
            ))}
          </div>
        )}

        <Field label="Title" htmlFor="event-title" error={errors.title}>
          <Input
            id="event-title"
            required
            autoFocus
            placeholder="e.g. Design Hackathon 2026"
            value={form.title}
            onChange={(e) => set('title', e.target.value)}
          />
        </Field>

        <div>
          <p className="mb-2 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted">Category</p>
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => set('category', cat)}
                aria-pressed={form.category === cat}
                className={cn(
                  'rounded-full border px-3.5 py-1.5 text-sm font-medium transition',
                  form.category === cat
                    ? 'border-transparent bg-foreground text-background'
                    : 'border-border text-muted hover:border-border-strong hover:text-foreground'
                )}
              >
                {CATEGORY_EMOJI[cat]} {CATEGORY_LABELS[cat]}
              </button>
            ))}
          </div>
        </div>

        <Field label="Description" htmlFor="event-description">
          <Textarea
            id="event-description"
            rows={3}
            placeholder="What will people do, learn or experience?"
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Starts" htmlFor="event-starts">
            <Input
              id="event-starts"
              type="datetime-local"
              value={form.startsAt}
              onChange={(e) => changeStart(e.target.value)}
              required
            />
          </Field>
          <Field label="Ends" htmlFor="event-ends" error={errors.endsAt}>
            <Input
              id="event-ends"
              type="datetime-local"
              min={form.startsAt}
              value={form.endsAt}
              onChange={(e) => set('endsAt', e.target.value)}
              required
            />
          </Field>
        </div>

        <div>
          <label
            htmlFor="event-venue"
            className="mb-2 block font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted"
          >
            Venue
          </label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <MapPin className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-subtle" />
              <Input
                id="event-venue"
                placeholder="Search a place or type a room name"
                value={form.venueName}
                onChange={(e) => typeVenue(e.target.value)}
                autoComplete="off"
                className="pl-10"
              />
              {venueQuery.trim().length >= 3 && (places.results.length > 0 || places.searching) && (
                <ul className="absolute inset-x-0 top-full z-10 mt-1.5 max-h-56 overflow-y-auto rounded-xl border border-border bg-surface-raised p-1 shadow-lifted">
                  {places.searching && <li className="px-3 py-2 text-sm text-muted">Searching…</li>}
                  {places.results.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => applyLocation(p)}
                        className="w-full rounded-lg px-3 py-2 text-left transition hover:bg-surface-muted"
                      >
                        <span className="block text-sm font-medium">{p.name}</span>
                        <span className="block truncate text-xs text-muted">{p.address}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <Button variant="secondary" onClick={() => setMapOpen(true)} className="h-11">
              <MapPin /> Map
            </Button>
          </div>
          {pinned && (
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-success-soft px-2.5 py-1 text-xs font-medium text-success">
              <Check className="size-3.5" /> Pinned on the map
              {form.venueAddress ? ` · ${form.venueAddress.split(',').slice(0, 2).join(',')}` : ''}
            </p>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Online link" htmlFor="event-online" hint="For online or hybrid events." error={errors.onlineUrl}>
            <Input
              id="event-online"
              placeholder="https://meet.google.com/…"
              value={form.onlineUrl}
              onChange={(e) => set('onlineUrl', e.target.value)}
            />
          </Field>
          <Field label="Tags" htmlFor="event-tags" hint="Comma-separated. Helps people find it." error={errors.tags}>
            <Input
              id="event-tags"
              placeholder="ai, beginner-friendly, free food"
              value={form.tags}
              onChange={(e) => set('tags', e.target.value)}
            />
          </Field>
        </div>

        {form.isPublic && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Capacity"
              htmlFor="event-capacity"
              hint="When it fills up, new RSVPs join a waitlist."
              error={errors.capacity}
            >
              <Input
                id="event-capacity"
                type="number"
                min={1}
                placeholder="Unlimited"
                value={form.capacity}
                onChange={(e) => set('capacity', e.target.value)}
              />
            </Field>
            <Field
              label="Cover photo"
              htmlFor="event-cover"
              hint={uploadsOn ? 'Upload a photo (cropped to 1200×630) or paste a link.' : 'A wide photo looks best.'}
              error={errors.coverImageUrl}
            >
              <div className="flex gap-2">
                <Input
                  id="event-cover"
                  placeholder="https://…"
                  value={form.coverImageUrl}
                  onChange={(e) => set('coverImageUrl', e.target.value)}
                />
                {uploadsOn && (
                  <label
                    className={cn(
                      'flex h-12 shrink-0 cursor-pointer items-center gap-1.5 rounded-2xl border border-border bg-surface-muted px-4 text-sm font-semibold transition hover:border-border-strong',
                      uploading && 'pointer-events-none opacity-60'
                    )}
                  >
                    <ImageUp className="size-4" /> {uploading ? 'Uploading…' : 'Upload'}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="sr-only"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        if (!file) return;
                        setUploading(true);
                        try {
                          set('coverImageUrl', await uploadCover(file));
                        } catch (err) {
                          toast.error(errorMessage(err));
                        } finally {
                          setUploading(false);
                        }
                      }}
                    />
                  </label>
                )}
              </div>
            </Field>
            {!isEdit && (
              <Field
                label="Repeats"
                htmlFor="event-repeat"
                hint="Each date becomes its own event, so each can be edited or cancelled."
              >
                <select
                  id="event-repeat"
                  value={form.repeat}
                  onChange={(e) => set('repeat', e.target.value)}
                  className="h-12 w-full rounded-2xl border border-border bg-surface-muted px-4 text-[15px] outline-none focus:border-primary focus:ring-4 focus:ring-ring/25"
                >
                  <option value="">Doesn&apos;t repeat</option>
                  <option value="week:4">Weekly, 4 dates</option>
                  <option value="week:8">Weekly, 8 dates</option>
                  <option value="week:12">Weekly, 12 dates</option>
                  <option value="fortnight:4">Every two weeks, 4 dates</option>
                  <option value="fortnight:8">Every two weeks, 8 dates</option>
                </select>
              </Field>
            )}
            <Field
              label="When a spot opens up"
              htmlFor="event-claim"
              hint="Holding the spot for someone to confirm cuts no-shows."
            >
              <select
                id="event-claim"
                value={form.waitlistClaimHours}
                onChange={(e) => set('waitlistClaimHours', e.target.value)}
                className="h-12 w-full rounded-2xl border border-border bg-surface-muted px-4 text-[15px] outline-none focus:border-primary focus:ring-4 focus:ring-ring/25"
              >
                <option value="">Move the next person in automatically</option>
                <option value="2">Hold it 2 hours for them to confirm</option>
                <option value="6">Hold it 6 hours for them to confirm</option>
                <option value="12">Hold it 12 hours for them to confirm</option>
                <option value="24">Hold it 24 hours for them to confirm</option>
              </select>
            </Field>
            <Field
              label="Registration opens"
              htmlFor="event-reg-opens"
              hint="Optional. Leave empty to open now."
              error={errors.registrationOpensAt}
            >
              <Input
                id="event-reg-opens"
                type="datetime-local"
                value={form.registrationOpensAt}
                onChange={(e) => set('registrationOpensAt', e.target.value)}
              />
            </Field>
            <Field
              label="Registration closes"
              htmlFor="event-reg-closes"
              hint="Optional. Leave empty to stay open until it starts."
              error={errors.registrationClosesAt}
            >
              <Input
                id="event-reg-closes"
                type="datetime-local"
                value={form.registrationClosesAt}
                onChange={(e) => set('registrationClosesAt', e.target.value)}
              />
            </Field>
          </div>
        )}

        {form.isPublic && (
          <div className="space-y-3 rounded-2xl border border-border p-4">
            <div className="flex items-start justify-between gap-4">
              <span>
                <span className="block text-sm font-medium">Approve each RSVP</span>
                <span className="block text-sm text-muted">For selective workshops: people request a place and you decide.</span>
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={form.requiresApproval}
                aria-label="Approve each RSVP"
                onClick={() => set('requiresApproval', !form.requiresApproval)}
                className={cn(
                  'relative h-6 w-11 shrink-0 rounded-full transition',
                  form.requiresApproval ? 'bg-primary' : 'bg-border-strong'
                )}
              >
                <span
                  className={cn(
                    'absolute top-0.5 size-5 rounded-full bg-white shadow transition-all',
                    form.requiresApproval ? 'left-[22px]' : 'left-0.5'
                  )}
                />
              </button>
            </div>

            <div className="grid gap-3 pt-2 sm:grid-cols-2">
              <Field label="Smallest team" htmlFor="team-min" hint="Leave both empty for individual sign-up.">
                <Input
                  id="team-min"
                  type="number"
                  min={1}
                  max={20}
                  value={form.teamMin}
                  onChange={(e) => set('teamMin', e.target.value)}
                />
              </Field>
              <Field label="Largest team" htmlFor="team-max">
                <Input
                  id="team-max"
                  type="number"
                  min={1}
                  max={20}
                  value={form.teamMax}
                  onChange={(e) => set('teamMax', e.target.value)}
                />
              </Field>
            </div>

            <p className="pt-2 text-sm font-medium">Questions at RSVP</p>
            {form.questions.map((q, i) => {
              const update = (patch: Partial<FormState['questions'][number]>) =>
                set(
                  'questions',
                  form.questions.map((x, j) => (j === i ? { ...x, ...patch } : x))
                );
              return (
                <div key={i} className="grid gap-2 sm:grid-cols-[1fr_8rem]">
                  <Input
                    aria-label={`Question ${i + 1}`}
                    placeholder="e.g. Roll number"
                    value={q.label}
                    onChange={(e) => update({ label: e.target.value })}
                  />
                  <select
                    aria-label={`Question ${i + 1} type`}
                    value={q.kind}
                    onChange={(e) => update({ kind: e.target.value as 'text' | 'choice' })}
                    className="h-12 rounded-2xl border border-border bg-surface-muted px-3 text-sm outline-none focus:border-primary"
                  >
                    <option value="text">Text</option>
                    <option value="choice">Choice</option>
                  </select>
                  {q.kind === 'choice' && (
                    <Input
                      aria-label={`Question ${i + 1} options`}
                      placeholder="Options, comma-separated: S, M, L"
                      value={q.options}
                      onChange={(e) => update({ options: e.target.value })}
                      className="sm:col-span-2"
                    />
                  )}
                  <div className="flex items-center justify-between sm:col-span-2">
                    <label className="flex items-center gap-2 text-xs text-muted">
                      <input type="checkbox" checked={q.required} onChange={(e) => update({ required: e.target.checked })} />{' '}
                      Required
                    </label>
                    <button
                      type="button"
                      className="text-xs text-muted hover:text-danger"
                      onClick={() =>
                        set(
                          'questions',
                          form.questions.filter((_, j) => j !== i)
                        )
                      }
                    >
                      Remove
                    </button>
                  </div>
                </div>
              );
            })}
            {form.questions.length < 5 && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => set('questions', [...form.questions, { label: '', kind: 'text', options: '', required: false }])}
              >
                Add a question
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="sticky bottom-0 flex flex-wrap items-center justify-end gap-2 border-t border-border bg-surface/95 px-6 py-4 backdrop-blur">
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        {form.isPublic && (!isEdit || isDraft) && (
          <Button variant="secondary" loading={saving === 'draft'} disabled={saving !== null} onClick={() => save(true)}>
            Save draft
          </Button>
        )}
        <Button type="submit" loading={saving === 'publish'} disabled={saving !== null}>
          {submitLabel}
        </Button>
      </div>

      <Dialog
        open={mapOpen}
        onClose={() => setMapOpen(false)}
        size="xl"
        title="Pick a venue"
        description="Choose a venue already in use, or search any place."
      >
        <div className="p-4 sm:p-6">
          <VenueMap onPick={applyLocation} />
        </div>
      </Dialog>
    </form>
  );
}
