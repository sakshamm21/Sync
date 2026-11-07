'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { AnimatePresence, motion } from 'motion/react';
import { CalendarDays, Pencil, Pin, Plus, Search, Trash2 } from 'lucide-react';
import { errorMessage, meApi, notesApi, type Note, type NoteTag, type SyncEvent } from '@/lib/api';
import { NOTE_TAGS, NOTE_TAG_EMOJI, NOTE_TAG_LABELS, formatRelative } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { Dialog } from '@/components/ui/overlay';
import { EmptyState, PageHeader } from '@/components/ui/surface';
import { FilterChips } from '@/components/ui/tabs';
import { cn } from '@/lib/cn';

interface Draft {
  id?: string;
  title: string;
  content: string;
  tag: NoteTag;
  event: string | null;
}

const EMPTY_DRAFT: Draft = { title: '', content: '', tag: 'plan', event: null };
const DAY_MS = 24 * 60 * 60 * 1000;

// Sticky-note paper colours, one per tag; text is always ink black.
const STICKY_COLORS: Record<NoteTag, string> = {
  plan: 'bg-[#d4ff3a]',
  speaker: 'bg-[#ff9be6]',
  logistics: 'bg-[#8ff3ff]',
  ideas: 'bg-[#ffd23d]',
  personal: 'bg-[#c8b5ff]',
};
const STICKY_TILT = [-2.5, 1.8, -1.2, 2.4, -1.8, 1.2];

const sortNotes = (list: Note[]) =>
  [...list].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt));

export default function NotesBoard() {
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [search, setSearch] = useState('');
  const [tag, setTag] = useState<NoteTag | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [linkableEvents, setLinkableEvents] = useState<SyncEvent[]>([]);
  const isEditing = draft !== null;

  useEffect(() => {
    const timer = setTimeout(() => {
      notesApi
        .list({ q: search.trim() || undefined, tag: tag ?? undefined, limit: 50 })
        .then(({ items }) => setNotes(items))
        .catch((err) => toast.error(errorMessage(err)));
    }, 250);
    return () => clearTimeout(timer);
  }, [search, tag]);

  // Events the user can attach notes to, loaded when the editor opens.
  useEffect(() => {
    if (!isEditing) return;
    const now = Date.now();
    meApi
      .calendar({ from: new Date(now - 7 * DAY_MS).toISOString(), to: new Date(now + 180 * DAY_MS).toISOString() })
      .then(setLinkableEvents)
      .catch(() => setLinkableEvents([]));
  }, [isEditing]);

  async function saveDraft(e: React.FormEvent) {
    e.preventDefault();
    if (!draft?.title.trim()) return;
    setSaving(true);
    try {
      const body = { title: draft.title, content: draft.content, tag: draft.tag, event: draft.event };
      const saved = draft.id ? await notesApi.update(draft.id, body) : await notesApi.create(body);
      setNotes((prev) => sortNotes([saved, ...(prev ?? []).filter((n) => n.id !== saved.id)]));
      setDraft(null);
      toast.success(draft.id ? 'Note updated' : 'Note added');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function togglePin(note: Note) {
    try {
      const saved = await notesApi.update(note.id, { pinned: !note.pinned });
      setNotes((prev) => sortNotes((prev ?? []).map((n) => (n.id === saved.id ? saved : n))));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function remove(note: Note) {
    setNotes((prev) => prev?.filter((n) => n.id !== note.id) ?? prev);
    try {
      await notesApi.remove(note.id);
      toast('Note deleted');
    } catch (err) {
      toast.error(errorMessage(err));
      setNotes((prev) => sortNotes([note, ...(prev ?? [])]));
    }
  }

  return (
    <>
      <PageHeader
        kicker="Agendas, checklists, 3am ideas"
        title={
          <>
            Notes &amp; <em>ideas</em>
          </>
        }
        description="Stick them to an event so they’re there when you need them."
        actions={
          <Button onClick={() => setDraft(EMPTY_DRAFT)}>
            <Plus /> New note
          </Button>
        }
      />

      <div className="mb-6 space-y-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-primary" />
          <input
            type="search"
            placeholder="Search notes"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search notes"
            className="h-12 w-full rounded-full border border-border bg-surface pl-11 pr-4 text-[15px] outline-none transition hover:border-border-strong focus:border-primary focus:ring-4 focus:ring-ring/25"
          />
        </div>
        <FilterChips<NoteTag>
          value={tag}
          onChange={setTag}
          allLabel="All notes"
          options={NOTE_TAGS.map((t) => ({ value: t, label: NOTE_TAG_LABELS[t], emoji: NOTE_TAG_EMOJI[t] }))}
        />
      </div>

      {notes === null ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-56 animate-pulse rounded-md bg-surface-muted" />
          ))}
        </div>
      ) : notes.length === 0 ? (
        <EmptyState
          emoji="📝"
          title={search || tag ? 'No matching notes' : 'No notes yet'}
          description="Keep agendas, logistics and ideas next to the events they're for."
          action={
            !search &&
            !tag && (
              <Button onClick={() => setDraft(EMPTY_DRAFT)}>
                <Plus /> Write your first note
              </Button>
            )
          }
        />
      ) : (
        <motion.div layout className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
          <AnimatePresence initial={false}>
            {notes.map((note, i) => (
              <motion.article
                key={note.id}
                layout
                initial={{ opacity: 0, scale: 0.9, rotate: 0 }}
                animate={{ opacity: 1, scale: 1, rotate: STICKY_TILT[i % STICKY_TILT.length] }}
                exit={{ opacity: 0, scale: 0.9 }}
                whileHover={{ rotate: 0, y: -6, scale: 1.02 }}
                transition={{ type: 'spring', bounce: 0.3, duration: 0.45 }}
                className={cn(
                  'group relative flex min-h-56 flex-col rounded-[6px] p-6 text-black shadow-[0_18px_30px_-14px_rgb(0_0_0/0.55)]',
                  STICKY_COLORS[note.tag]
                )}
              >
                {note.pinned && (
                  <span
                    aria-hidden="true"
                    className="absolute -top-3 left-1/2 h-6 w-20 -translate-x-1/2 rotate-[-3deg] bg-white/55 backdrop-blur-sm"
                  />
                )}
                <div className="flex items-start justify-between gap-2">
                  <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-black/60">
                    {NOTE_TAG_EMOJI[note.tag]} {NOTE_TAG_LABELS[note.tag]}
                  </span>
                  <div className="-mr-2 -mt-2 flex opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                    {[
                      {
                        label: note.pinned ? 'Unpin' : 'Pin',
                        icon: <Pin className={cn(note.pinned && 'fill-current')} />,
                        onClick: () => togglePin(note),
                      },
                      {
                        label: 'Edit',
                        icon: <Pencil />,
                        onClick: () =>
                          setDraft({
                            id: note.id,
                            title: note.title,
                            content: note.content,
                            tag: note.tag,
                            event: note.event?.id ?? null,
                          }),
                      },
                      { label: 'Delete', icon: <Trash2 />, onClick: () => remove(note) },
                    ].map((a) => (
                      <button
                        key={a.label}
                        aria-label={a.label}
                        onClick={a.onClick}
                        className="flex size-8 items-center justify-center rounded-full text-black/60 transition hover:bg-black/10 hover:text-black [&_svg]:size-4"
                      >
                        {a.icon}
                      </button>
                    ))}
                  </div>
                </div>
                <h3 className="mt-3 text-2xl font-extrabold leading-tight">{note.title}</h3>
                {note.content && (
                  <p className="mt-2 line-clamp-6 whitespace-pre-wrap font-serif text-lg leading-snug text-black/75">
                    {note.content}
                  </p>
                )}
                <div className="mt-auto flex items-center justify-between gap-2 pt-5 text-xs text-black/60">
                  {note.event ? (
                    <Link
                      href={`/events/${note.event.id}`}
                      className="flex min-w-0 items-center gap-1.5 font-semibold text-black underline-offset-4 hover:underline"
                    >
                      <CalendarDays className="size-3.5 shrink-0" />
                      <span className="truncate">{note.event.title}</span>
                    </Link>
                  ) : (
                    <span className="font-mono uppercase tracking-wider">edited {formatRelative(note.updatedAt)}</span>
                  )}
                </div>
              </motion.article>
            ))}
          </AnimatePresence>
        </motion.div>
      )}

      <Dialog
        open={isEditing}
        onClose={() => setDraft(null)}
        title={draft?.id ? 'Edit note' : 'New note'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button type="submit" form="note-form" loading={saving}>
              Save note
            </Button>
          </>
        }
      >
        {draft && (
          <form id="note-form" onSubmit={saveDraft} className="space-y-4 p-6">
            <Field label="Title" htmlFor="note-title">
              <Input
                id="note-title"
                required
                autoFocus
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Tag" htmlFor="note-tag">
                <Select id="note-tag" value={draft.tag} onChange={(e) => setDraft({ ...draft, tag: e.target.value as NoteTag })}>
                  {NOTE_TAGS.map((t) => (
                    <option key={t} value={t}>
                      {NOTE_TAG_LABELS[t]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Linked event" htmlFor="note-event">
                <Select
                  id="note-event"
                  value={draft.event ?? ''}
                  onChange={(e) => setDraft({ ...draft, event: e.target.value || null })}
                >
                  <option value="">None</option>
                  {linkableEvents.map((ev) => (
                    <option key={ev.id} value={ev.id}>
                      {ev.title}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label="Note" htmlFor="note-content">
              <Textarea
                id="note-content"
                rows={8}
                value={draft.content}
                onChange={(e) => setDraft({ ...draft, content: e.target.value })}
              />
            </Field>
          </form>
        )}
      </Dialog>
    </>
  );
}
