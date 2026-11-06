'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Check, Globe, Lock, MapPin } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useEventsSync } from '@/context/EventContext';
import { ApiError, errorMessage, eventsApi, type CategoryValue, type EventInput, type SyncEvent } from '@/lib/api';
import { CATEGORIES, CATEGORY_EMOJI, CATEGORY_LABELS, campusDateKey, fromDateTimeInput, toDateTimeInput } from '@/lib/format';
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
  isPublic: boolean;
}

function initialState(event: SyncEvent | undefined, canPublish: boolean, date?: Date): FormState {
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
    isPublic: canPublish,
  };
}

const parseTags = (value: string) =>
  [...new Set(value.split(',').map((t) => t.trim().replace(/^#/, '').toLowerCase()).filter(Boolean))].slice(0, 10);

function CreateEventDialog({ open, event, date, onClose }: { open: boolean; event?: SyncEvent; date?: Date; onClose: () => void }) {
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
      title={event ? <>Edit <em>event</em></> : <>Drop an <em>event</em></>}
      description={event ? 'Attendees are notified if the time or place changes.' : 'Share it with campus, or keep it on your own calendar.'}
    >
      {/* Remounting resets the form every time the dialog opens. */}
      {open && (
        <EventForm
          key={`${event?.id ?? 'new'}-${date?.getTime() ?? ''}`}
          event={event}
          date={date}
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
  onDone,
  onDirtyChange,
}: {
  event?: SyncEvent;
  date?: Date;
  onDone: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const { user } = useAuth();
  const { eventsChanged } = useEventsSync();
  const canPublish = user?.role === 'organizer' || user?.role === 'admin';
  const isEdit = Boolean(event);
  const isDraft = event?.status === 'draft';

  const [form, setForm] = useState<FormState>(() => initialState(event, canPublish, date));
  const [pristine] = useState(() => JSON.stringify(form));
  useEffect(() => {
    onDirtyChange(JSON.stringify(form) !== pristine);
  }, [form, pristine, onDirtyChange]);
  const [venueQuery, setVenueQuery] = useState('');
  const [mapOpen, setMapOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [saving, setSaving] = useState<'publish' | 'draft' | null>(null);
  const places = usePlaceSearch(venueQuery);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((prev) => ({ ...prev, [key]: value }));

  function typeVenue(value: string) {
    // Typing a new name drops coordinates picked earlier.
    setForm((prev) => ({ ...prev, venueName: value, venueAddress: '', latitude: undefined, longitude: undefined }));
    setVenueQuery(value);
  }

  function applyLocation(location: PickedLocation) {
    setForm((prev) => ({ ...prev, venueName: location.name, venueAddress: location.address, latitude: location.latitude, longitude: location.longitude }));
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
      // Editing keeps the current status unless the user explicitly saves a draft or publishes one.
      if (!isEdit || isDraft) body.status = asDraft ? 'draft' : 'published';
    }
    if (!isEdit) body.visibility = form.isPublic ? 'public' : 'private';

    setSaving(asDraft ? 'draft' : 'publish');
    setErrors({});
    try {
      if (isEdit) await eventsApi.update(event!.id, body);
      else await eventsApi.create(body);
      toast.success(isEdit ? 'Event updated' : asDraft ? 'Draft saved' : form.isPublic ? 'Event published' : 'Added to your calendar');
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
                  form.isPublic === option.value ? 'border-primary bg-primary-soft ring-4 ring-ring/15' : 'border-border hover:border-border-strong'
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
          <Input id="event-title" required autoFocus placeholder="e.g. Design Hackathon 2026" value={form.title} onChange={(e) => set('title', e.target.value)} />
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
                  form.category === cat ? 'border-transparent bg-foreground text-background' : 'border-border text-muted hover:border-border-strong hover:text-foreground'
                )}
              >
                {CATEGORY_EMOJI[cat]} {CATEGORY_LABELS[cat]}
              </button>
            ))}
          </div>
        </div>

        <Field label="Description" htmlFor="event-description">
          <Textarea id="event-description" rows={3} placeholder="What will people do, learn or experience?" value={form.description} onChange={(e) => set('description', e.target.value)} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Starts" htmlFor="event-starts">
            <Input id="event-starts" type="datetime-local" value={form.startsAt} onChange={(e) => changeStart(e.target.value)} required />
          </Field>
          <Field label="Ends" htmlFor="event-ends" error={errors.endsAt}>
            <Input id="event-ends" type="datetime-local" min={form.startsAt} value={form.endsAt} onChange={(e) => set('endsAt', e.target.value)} required />
          </Field>
        </div>

        <div>
          <label htmlFor="event-venue" className="mb-2 block font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted">Venue</label>
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
                      <button type="button" onClick={() => applyLocation(p)} className="w-full rounded-lg px-3 py-2 text-left transition hover:bg-surface-muted">
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
              <Check className="size-3.5" /> Pinned on the map{form.venueAddress ? ` · ${form.venueAddress.split(',').slice(0, 2).join(',')}` : ''}
            </p>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Online link" htmlFor="event-online" hint="For online or hybrid events." error={errors.onlineUrl}>
            <Input id="event-online" placeholder="https://meet.google.com/…" value={form.onlineUrl} onChange={(e) => set('onlineUrl', e.target.value)} />
          </Field>
          <Field label="Tags" htmlFor="event-tags" hint="Comma-separated. Helps people find it." error={errors.tags}>
            <Input id="event-tags" placeholder="ai, beginner-friendly, free food" value={form.tags} onChange={(e) => set('tags', e.target.value)} />
          </Field>
        </div>

        {form.isPublic && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Capacity" htmlFor="event-capacity" hint="When it fills up, new RSVPs join a waitlist." error={errors.capacity}>
              <Input id="event-capacity" type="number" min={1} placeholder="Unlimited" value={form.capacity} onChange={(e) => set('capacity', e.target.value)} />
            </Field>
            <Field label="Cover image URL" htmlFor="event-cover" hint="A wide photo looks best." error={errors.coverImageUrl}>
              <Input id="event-cover" placeholder="https://…" value={form.coverImageUrl} onChange={(e) => set('coverImageUrl', e.target.value)} />
            </Field>
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

      <Dialog open={mapOpen} onClose={() => setMapOpen(false)} size="xl" title="Pick a venue" description="Choose a venue already in use, or search any place.">
        <div className="p-4 sm:p-6">
          <VenueMap onPick={applyLocation} />
        </div>
      </Dialog>
    </form>
  );
}
