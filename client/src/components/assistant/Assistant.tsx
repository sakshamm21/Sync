'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowUp, RotateCcw, Sparkles, X } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { assistantApi, errorMessage, type AssistantMessage, type SyncEvent } from '@/lib/api';
import { CATEGORY_EMOJI, CATEGORY_GRADIENTS, formatEventWhen, formatVenue } from '@/lib/format';
import { cn } from '@/lib/cn';
import Markdown from './Markdown';

/** A turn in the panel: what the API sees, plus the event cards and any error shown under it. */
interface Turn extends AssistantMessage {
  events?: SyncEvent[];
  failed?: boolean;
}

/** The server accepts up to 20 messages; older turns are dropped from what is sent. */
const HISTORY_LIMIT = 20;
const STORAGE_KEY = 'sync.assistant';

const SUGGESTIONS = [
  { emoji: '🗓️', text: "What's happening this weekend?" },
  { emoji: '🎟️', text: "What's on my calendar this week?" },
  { emoji: '✨', text: 'Recommend something for me' },
  { emoji: '💻', text: 'Any tech events coming up?' },
];

const AssistantContext = createContext<{ openAssistant: () => void; enabled: boolean } | null>(null);

function useAssistant() {
  const context = useContext(AssistantContext);
  if (!context) throw new Error('useAssistant must be used inside AssistantProvider');
  return context;
}

function loadTurns(): Turn[] {
  try {
    const saved = window.sessionStorage.getItem(STORAGE_KEY);
    return saved ? (JSON.parse(saved) as Turn[]) : [];
  } catch {
    return [];
  }
}

function saveTurns(turns: Turn[]) {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(turns));
  } catch {
    // Storage can be unavailable (private mode); the chat then lasts until reload.
  }
}

/** "Ask Sync" panel, opened from the header button or ⌘J / Ctrl+J. Only active when the server has an AI key. */
export function AssistantProvider({ children }: { children: React.ReactNode }) {
  const { assistant: enabled } = useAuth();
  const [open, setOpen] = useState(false);
  const openAssistant = useCallback(() => setOpen(true), []);

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);

  const value = useMemo(() => ({ openAssistant, enabled }), [openAssistant, enabled]);
  return (
    <AssistantContext.Provider value={value}>
      {children}
      {enabled && <AssistantPanel open={open} onClose={() => setOpen(false)} />}
    </AssistantContext.Provider>
  );
}

/** Header button. Renders nothing when the assistant is off. */
export function AssistantButton() {
  const { openAssistant, enabled } = useAssistant();
  if (!enabled) return null;
  return (
    <button
      onClick={openAssistant}
      aria-label="Ask Sync, the AI assistant"
      title="Ask Sync (Ctrl+J)"
      className="group flex h-10 items-center gap-2 rounded-full border border-border bg-surface/70 px-3 text-sm font-semibold text-foreground backdrop-blur transition hover:border-primary/60 sm:px-4"
    >
      <Sparkles className="size-4 text-primary transition-transform group-hover:rotate-12 group-hover:scale-110" />
      <span className="hidden lg:inline">Ask Sync</span>
    </button>
  );
}

function EventChip({ event, onNavigate }: { event: SyncEvent; onNavigate: () => void }) {
  const status =
    event.viewer.registration === 'going' ? "You're in" : event.viewer.registration === 'waitlisted' ? 'Waitlisted' : event.viewer.isOwner ? 'Yours' : null;
  return (
    <Link
      href={`/events/${event.id}`}
      onClick={onNavigate}
      className="group flex items-center gap-3 rounded-2xl border border-border bg-surface p-2.5 pr-3.5 transition hover:border-primary/60 hover:bg-surface-raised"
    >
      <span className={cn('relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br text-2xl', CATEGORY_GRADIENTS[event.category])}>
        {event.coverImageUrl ? <img src={event.coverImageUrl} alt="" className="size-full object-cover" /> : <span aria-hidden="true">{CATEGORY_EMOJI[event.category]}</span>}
      </span>
      <span className="min-w-0 flex-1">
        <span className="line-clamp-1 font-display text-sm font-bold leading-tight transition-colors group-hover:text-primary">{event.title}</span>
        <span className="mt-0.5 block truncate font-mono text-[10px] uppercase tracking-wider text-muted">{formatEventWhen(event)}</span>
        <span className="block truncate text-xs text-subtle">{formatVenue(event)}</span>
      </span>
      {status && <span className="shrink-0 rounded-full bg-primary-soft px-2 py-0.5 text-[11px] font-semibold text-primary-soft-foreground">{status}</span>}
    </Link>
  );
}

function TypingDots() {
  return (
    <div className="flex w-fit items-center gap-1.5 rounded-3xl rounded-bl-lg bg-surface-muted px-4 py-3.5" aria-label="Sync is thinking">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="size-1.5 rounded-full bg-muted"
          animate={{ y: [0, -4, 0], opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15 }}
        />
      ))}
    </div>
  );
}

function AssistantPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useAuth();
  const [mounted, setMounted] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setMounted(true);
    setTurns(loadTurns());
  }, []);
  useEffect(() => {
    if (mounted) saveTurns(turns);
  }, [turns, mounted]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const focus = setTimeout(() => inputRef.current?.focus(), 150);
    return () => {
      document.removeEventListener('keydown', onKey);
      clearTimeout(focus);
    };
  }, [open, onClose]);

  // Keep the newest message in view.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns, busy, open]);

  // On phones the panel covers the page, so following a link should close it.
  const closeOnSmallScreens = useCallback(() => {
    if (window.matchMedia('(max-width: 639px)').matches) onClose();
  }, [onClose]);

  const send = async (text: string) => {
    const question = text.trim();
    if (!question || busy) return;
    const history = [...turns.filter((t) => !t.failed), { role: 'user' as const, content: question }];
    setTurns(history);
    setDraft('');
    setBusy(true);
    try {
      const { reply, events } = await assistantApi.chat(history.slice(-HISTORY_LIMIT).map(({ role, content }) => ({ role, content })));
      setTurns((current) => [...current, { role: 'assistant', content: reply, events }]);
    } catch (err) {
      setTurns((current) => [...current, { role: 'assistant', content: errorMessage(err), failed: true }]);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  };

  const retry = () => {
    const lastQuestion = [...turns].reverse().find((t) => t.role === 'user');
    if (!lastQuestion) return;
    setTurns((current) => current.slice(0, current.lastIndexOf(lastQuestion)));
    void send(lastQuestion.content);
  };

  if (!mounted) return null;
  const firstName = user?.name.split(' ')[0] ?? 'there';

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex justify-end sm:p-4">
          <motion.div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm sm:bg-black/20"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.aside
            role="dialog"
            aria-modal="true"
            aria-label="Ask Sync"
            className="relative flex h-full w-full flex-col overflow-hidden border-border bg-surface shadow-overlay sm:max-w-[440px] sm:rounded-[32px] sm:border"
            initial={{ opacity: 0, x: 60 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 60 }}
            transition={{ type: 'spring', bounce: 0.15, duration: 0.45 }}
          >
            <header className="flex items-center gap-3 border-b border-border px-5 py-4">
              <span className="flex size-10 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
                <Sparkles className="size-5" />
              </span>
              <div className="flex-1">
                <h2 className="font-display text-lg font-extrabold leading-none">Ask Sync</h2>
                <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
                  AI assistant<span className="max-sm:hidden"> · reads live events</span>
                </p>
              </div>
              {turns.length > 0 && (
                <button
                  onClick={() => setTurns([])}
                  aria-label="Start a new chat"
                  title="New chat"
                  disabled={busy}
                  className="flex size-9 items-center justify-center rounded-full text-muted transition hover:bg-surface-muted hover:text-foreground disabled:opacity-40"
                >
                  <RotateCcw className="size-4" />
                </button>
              )}
              <button
                onClick={onClose}
                aria-label="Close"
                className="flex size-9 items-center justify-center rounded-full bg-surface-muted text-muted transition hover:rotate-90 hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </header>

            <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-5 py-5" aria-live="polite">
              {turns.length === 0 && (
                <div className="pt-6">
                  <p className="font-display text-3xl font-extrabold leading-tight">
                    Hey {firstName} <span aria-hidden="true">👋</span>
                    <br />
                    <span className="font-serif font-normal italic text-primary">what&apos;s the plan?</span>
                  </p>
                  <p className="mt-3 text-sm text-muted">
                    Ask about events, your schedule, or anything else. I look things up in Sync, so answers match what&apos;s really on.
                  </p>
                  <div className="mt-6 grid gap-2">
                    {SUGGESTIONS.map((s) => (
                      <button
                        key={s.text}
                        onClick={() => void send(s.text)}
                        className="flex items-center gap-3 rounded-2xl border border-border bg-surface-muted/60 px-4 py-3 text-left text-sm font-medium transition hover:border-primary/60 hover:bg-surface-muted"
                      >
                        <span aria-hidden="true">{s.emoji}</span>
                        {s.text}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {turns.map((turn, i) =>
                turn.role === 'user' ? (
                  <div key={i} className="ml-auto w-fit max-w-[85%] whitespace-pre-wrap rounded-3xl rounded-br-lg bg-primary px-4 py-2.5 text-[15px] text-primary-foreground">
                    {turn.content}
                  </div>
                ) : (
                  <div key={i} className="max-w-[92%] space-y-2.5">
                    <div
                      className={cn(
                        'rounded-3xl rounded-bl-lg px-4 py-3 text-[15px] leading-relaxed',
                        turn.failed ? 'bg-danger-soft text-danger' : 'bg-surface-muted text-foreground/90'
                      )}
                    >
                      <Markdown onNavigate={closeOnSmallScreens}>{turn.content}</Markdown>
                      {turn.failed && i === turns.length - 1 && (
                        <button onClick={retry} className="mt-2 text-sm font-semibold underline underline-offset-2">
                          Try again
                        </button>
                      )}
                    </div>
                    {turn.events?.map((event) => <EventChip key={event.id} event={event} onNavigate={closeOnSmallScreens} />)}
                  </div>
                )
              )}

              {busy && <TypingDots />}
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                void send(draft);
              }}
              className="border-t border-border p-3"
            >
              <div className="flex items-end gap-2 rounded-3xl border border-border bg-surface-muted p-1.5 pl-4 transition focus-within:border-primary focus-within:ring-4 focus-within:ring-ring/25">
                <textarea
                  ref={inputRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void send(draft);
                    }
                  }}
                  rows={1}
                  maxLength={2000}
                  placeholder="Ask about events, your week…"
                  aria-label="Message Sync"
                  className="max-h-32 min-h-10 flex-1 resize-none bg-transparent py-2.5 text-[15px] outline-none placeholder:text-subtle [field-sizing:content]"
                />
                <button
                  type="submit"
                  disabled={!draft.trim() || busy}
                  aria-label="Send"
                  className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition hover:bg-primary-hover active:scale-95 disabled:opacity-35"
                >
                  <ArrowUp className="size-5" strokeWidth={2.5} />
                </button>
              </div>
              <p className="mt-2 text-center text-[11px] text-subtle">Sync can make mistakes. Check the event page before you go.</p>
            </form>
          </motion.aside>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}
