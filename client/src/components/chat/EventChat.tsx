'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { AnimatePresence, motion } from 'motion/react';
import { Megaphone, SendHorizontal, MessagesSquare } from 'lucide-react';
import { useAuth, usePolling, useSocketEvent } from '@/context/AuthContext';
import { errorMessage, eventsApi, type ChatMessage } from '@/lib/api';
import { ROLE_LABELS, formatTime } from '@/lib/format';
import { Avatar } from '@/components/ui/surface';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

interface EventChatProps {
  eventId: string;
  /** Organisers can broadcast announcements that also notify attendees. */
  canAnnounce?: boolean;
  className?: string;
}

const TYPING_TIMEOUT_MS = 3000;
const POLL_MS = 4000;

/** Kept in step with the server's list in chat.service.ts. */
const REACTION_CHOICES = ['👍', '❤️', '😂', '🎉', '😮', '🙏'];

export default function EventChat({ eventId, canAnnounce = false, className }: EventChatProps) {
  const { user, socket, realtime } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [announcement, setAnnouncement] = useState(false);
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [reactingTo, setReactingTo] = useState<string | null>(null);
  const [pins, setPins] = useState<ChatMessage[]>([]);
  const loadPins = useCallback(() => {
    eventsApi
      .pinned(eventId)
      .then(setPins)
      .catch(() => setPins([]));
  }, [eventId]);
  useEffect(loadPins, [loadPins]);
  useSocketEvent<{ event: string }>('message:pinned', (p) => {
    if (p.event === eventId) loadPins();
  });

  async function togglePin(msg: ChatMessage) {
    const pinned = !pins.some((p) => p.id === msg.id);
    try {
      await eventsApi.pin(eventId, msg.id, pinned);
      loadPins();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }
  const [audience, setAudience] = useState<'all' | 'going' | 'waitlisted'>('all');
  const [sending, setSending] = useState(false);
  const [typing, setTyping] = useState<Record<string, string>>({});
  const feedRef = useRef<HTMLDivElement>(null);
  const lastTypingSent = useRef(0);

  const scrollToBottom = () =>
    requestAnimationFrame(() => feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: 'smooth' }));

  useEffect(() => {
    setLoading(true);
    setMessages([]);
    eventsApi
      .messages(eventId)
      .then(({ items, hasMore: more }) => {
        setMessages(items);
        setHasMore(more);
        void eventsApi.markChatRead(eventId).catch(() => {});
        requestAnimationFrame(() => feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight }));
      })
      .catch((err) => toast.error(errorMessage(err)))
      .finally(() => setLoading(false));
  }, [eventId]);

  // Join the event's realtime room while open (and again after reconnects).
  useEffect(() => {
    if (!socket) return;
    const join = () => socket.emit('event:join', eventId, () => {});
    join();
    socket.on('connect', join);
    return () => {
      socket.off('connect', join);
      socket.emit('event:leave', eventId);
    };
  }, [socket, eventId]);

  const appendMessages = (incoming: ChatMessage[]) => {
    if (!incoming.length) return;
    // The chat is open, so what arrives is read.
    void eventsApi.markChatRead(eventId).catch(() => {});
    setMessages((prev) => [...prev, ...incoming.filter((m) => !prev.some((p) => p.id === m.id))]);
    scrollToBottom();
  };

  // Without a socket (serverless hosting), fetch anything newer than the last message.
  usePolling(
    () => {
      const last = messages[messages.length - 1];
      eventsApi
        .messages(eventId, last ? { after: last.id } : {})
        .then(({ items }) => appendMessages(items))
        .catch(() => {});
    },
    POLL_MS,
    realtime === 'polling' && !loading
  );

  const markRemoved = (id: string) =>
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, text: '', removedAt: new Date().toISOString() } : m)));

  async function remove(msg: ChatMessage) {
    try {
      await eventsApi.removeMessage(eventId, msg.id);
      markRemoved(msg.id);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  const setReactions = (id: string, reactions: { emoji: string; user: string }[]) =>
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, reactions } : m)));

  async function react(msg: ChatMessage, emoji: string) {
    setReactingTo(null);
    try {
      const r = await eventsApi.react(eventId, msg.id, emoji);
      setReactions(r.id, r.reactions);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  useSocketEvent<{ id: string; event: string; reactions: { emoji: string; user: string }[] }>('message:reactions', (p) => {
    if (p.event === eventId) setReactions(p.id, p.reactions);
  });

  async function report(msg: ChatMessage) {
    try {
      await eventsApi.reportMessage(eventId, msg.id);
      toast.success('Reported', { description: 'The Sync team will take a look.' });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  useSocketEvent<{ id: string; event: string }>('message:removed', ({ id, event }) => {
    if (event === eventId) markRemoved(id);
  });

  useSocketEvent<ChatMessage>('message:new', (message) => {
    if (message.event !== eventId) return;
    appendMessages([message]);
    setTyping((prev) => {
      const { [message.sender.id]: _, ...rest } = prev;
      return rest;
    });
  });

  useSocketEvent<{ eventId: string; user: { id: string; name: string } }>('event:typing', ({ eventId: id, user: who }) => {
    if (id !== eventId) return;
    setTyping((prev) => ({ ...prev, [who.id]: who.name }));
    setTimeout(() => {
      setTyping((prev) => {
        const { [who.id]: _, ...rest } = prev;
        return rest;
      });
    }, TYPING_TIMEOUT_MS);
  });

  async function loadOlder() {
    const oldest = messages[0];
    if (!oldest) return;
    try {
      const { items, hasMore: more } = await eventsApi.messages(eventId, { before: oldest.id });
      setMessages((prev) => [...items.filter((m) => !prev.some((p) => p.id === m.id)), ...prev]);
      setHasMore(more);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  function handleTyping(value: string) {
    setText(value);
    const now = Date.now();
    if (socket && now - lastTypingSent.current > TYPING_TIMEOUT_MS / 2) {
      socket.emit('event:typing', eventId);
      lastTypingSent.current = now;
    }
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setSending(true);
    try {
      const sent = await eventsApi.sendMessage(eventId, {
        text: text.trim(),
        announcement,
        ...(announcement ? { audience } : {}),
        ...(replyingTo ? { replyTo: replyingTo.id } : {}),
      });
      appendMessages([sent]);
      setText('');
      setReplyingTo(null);
      setAnnouncement(false);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSending(false);
    }
  }

  const typingNames = Object.values(typing);

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      {pins.length > 0 && (
        <div className="space-y-1 border-b border-border bg-surface-muted px-4 py-2 sm:px-6">
          {pins.map((p) => (
            <p key={p.id} className="truncate text-xs">
              <span className="mr-1.5 font-semibold">📌 {p.sender.name}:</span>
              {p.text}
            </p>
          ))}
        </div>
      )}
      <div ref={feedRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-5 sm:px-6">
        {hasMore && (
          <div className="flex justify-center">
            <Button variant="ghost" size="sm" onClick={loadOlder}>
              Load earlier messages
            </Button>
          </div>
        )}
        {loading &&
          [0, 1, 2].map((i) => (
            <div key={i} className={cn('flex gap-2', i % 2 && 'justify-end')}>
              <div className="h-12 w-2/3 animate-pulse rounded-2xl bg-surface-muted sm:w-1/2" />
            </div>
          ))}
        {!loading && messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center py-12 text-center text-muted">
            <MessagesSquare className="mb-3 size-8 text-subtle" />
            <p className="font-display text-lg font-bold text-foreground">It&apos;s quiet in here 👀</p>
            <p className="mt-1 text-sm">Say hi, ask the organizer something, find your crew.</p>
          </div>
        )}
        <AnimatePresence initial={false}>
          {messages.map((msg) => {
            if (msg.removedAt) {
              return (
                <p key={msg.id} className="text-center text-xs italic text-muted">
                  Message removed
                </p>
              );
            }
            if (msg.isAnnouncement) {
              return (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  style={{ rotate: '-0.6deg' }}
                  className="rounded-3xl bg-pink p-4 text-[#09090d]"
                >
                  <p className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-black/70">
                    <Megaphone className="size-3.5" /> Announcement · {msg.sender.name} · {formatTime(msg.createdAt)}
                  </p>
                  <p className="mt-1.5 whitespace-pre-wrap font-display text-lg font-bold leading-snug">{msg.text}</p>
                </motion.div>
              );
            }
            const isMe = msg.sender.id === user?.id;
            return (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 8, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.2 }}
                className={cn('flex items-end gap-2.5', isMe && 'flex-row-reverse')}
              >
                {!isMe && <Avatar name={msg.sender.name} src={msg.sender.avatarUrl} size={28} />}
                <div className={cn('max-w-[78%]', isMe && 'items-end text-right')}>
                  {!isMe && (
                    <p className="mb-1 flex items-center gap-1.5 text-xs text-muted">
                      <span className="font-medium text-foreground">{msg.sender.name}</span>
                      {msg.sender.role !== 'member' && (
                        <span className="rounded-full bg-primary-soft px-1.5 text-[10px] font-medium text-primary-soft-foreground">
                          {ROLE_LABELS[msg.sender.role]}
                        </span>
                      )}
                    </p>
                  )}
                  {msg.replyTo && (
                    <p className="mb-1 truncate border-l-2 border-border-strong pl-2 text-left text-xs text-muted">
                      ↩ {msg.replyTo.sender?.name ?? 'Someone'}: {msg.replyTo.removedAt ? 'Message removed' : msg.replyTo.text}
                    </p>
                  )}
                  <div
                    className={cn(
                      'inline-block whitespace-pre-wrap break-words rounded-3xl px-4 py-2.5 text-left text-[15px] leading-relaxed',
                      isMe ? 'rounded-br-lg bg-primary font-medium text-primary-foreground' : 'rounded-bl-lg bg-surface-muted'
                    )}
                  >
                    {msg.text}
                  </div>
                  {msg.reactions && msg.reactions.length > 0 && (
                    <div className={cn('mt-1 flex flex-wrap gap-1', isMe && 'justify-end')}>
                      {Object.entries(
                        msg.reactions.reduce<Record<string, { n: number; mine: boolean }>>((acc, r) => {
                          const cur = acc[r.emoji] ?? { n: 0, mine: false };
                          acc[r.emoji] = { n: cur.n + 1, mine: cur.mine || r.user === user?.id };
                          return acc;
                        }, {})
                      ).map(([emoji, { n, mine }]) => (
                        <button
                          key={emoji}
                          type="button"
                          aria-pressed={mine}
                          aria-label={`${emoji} ${n}`}
                          onClick={() => react(msg, emoji)}
                          className={cn(
                            'rounded-full border px-2 py-0.5 text-xs',
                            mine ? 'border-primary bg-primary-soft' : 'border-border bg-surface'
                          )}
                        >
                          {emoji} {n}
                        </button>
                      ))}
                    </div>
                  )}
                  {reactingTo === msg.id && (
                    <div className={cn('mt-1 flex gap-1', isMe && 'justify-end')}>
                      {REACTION_CHOICES.map((emoji) => (
                        <button
                          key={emoji}
                          type="button"
                          aria-label={`React ${emoji}`}
                          onClick={() => react(msg, emoji)}
                          className="rounded-full bg-surface-muted px-2 py-1 text-base hover:scale-110"
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  )}
                  <p className={cn('mt-1 flex items-center gap-2 text-[11px] text-subtle', isMe && 'justify-end')}>
                    <span>{formatTime(msg.createdAt)}</span>
                    <button type="button" className="hover:text-foreground" onClick={() => setReplyingTo(msg)}>
                      Reply
                    </button>
                    {canAnnounce && (
                      <button type="button" className="hover:text-foreground" onClick={() => togglePin(msg)}>
                        {pins.some((p) => p.id === msg.id) ? 'Unpin' : 'Pin'}
                      </button>
                    )}
                    <button
                      type="button"
                      className="hover:text-foreground"
                      onClick={() => setReactingTo((cur) => (cur === msg.id ? null : msg.id))}
                    >
                      React
                    </button>
                    {(isMe || canAnnounce) && (
                      <button type="button" className="hover:text-danger" onClick={() => remove(msg)}>
                        Remove
                      </button>
                    )}
                    {!isMe && (
                      <button type="button" className="hover:text-foreground" onClick={() => report(msg)}>
                        Report
                      </button>
                    )}
                  </p>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      <div className="h-6 px-6 text-xs text-muted">
        {typingNames.length > 0 && (
          <span className="inline-flex items-center gap-1.5">
            <span className="flex gap-0.5">
              {[0, 1, 2].map((i) => (
                <motion.span
                  key={i}
                  className="size-1 rounded-full bg-muted"
                  animate={{ opacity: [0.3, 1, 0.3] }}
                  transition={{ duration: 1, repeat: Infinity, delay: i * 0.15 }}
                />
              ))}
            </span>
            {typingNames.join(', ')} {typingNames.length === 1 ? 'is' : 'are'} typing
          </span>
        )}
      </div>

      <form onSubmit={handleSend} className="border-t border-border p-3 sm:p-4">
        {canAnnounce && (
          <label className="mb-2 flex w-fit cursor-pointer items-center gap-2 text-xs text-muted">
            <input
              type="checkbox"
              checked={announcement}
              onChange={(e) => setAnnouncement(e.target.checked)}
              className="size-3.5 accent-[var(--primary)]"
            />
            <Megaphone className="size-3.5" /> Send as an announcement (notifies people by email and push)
          </label>
        )}
        {canAnnounce && announcement && (
          <label className="mb-2 flex w-fit items-center gap-2 text-xs text-muted">
            To
            <select
              value={audience}
              onChange={(e) => setAudience(e.target.value as typeof audience)}
              aria-label="Who the announcement goes to"
              className="rounded-lg border border-border bg-surface-muted px-2 py-1 text-xs text-foreground outline-none focus:border-primary"
            >
              <option value="all">Everyone registered</option>
              <option value="going">Only people going</option>
              <option value="waitlisted">Only the waitlist</option>
            </select>
          </label>
        )}
        {replyingTo && (
          <div className="mb-2 flex items-center gap-2 rounded-xl bg-surface-muted px-3 py-1.5 text-xs text-muted">
            <span className="min-w-0 flex-1 truncate">
              Replying to {replyingTo.sender.name}: {replyingTo.text}
            </span>
            <button type="button" onClick={() => setReplyingTo(null)} className="hover:text-foreground">
              Cancel
            </button>
          </div>
        )}
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder={announcement ? 'Write an announcement…' : 'Message everyone at this event…'}
            value={text}
            maxLength={2000}
            onChange={(e) => handleTyping(e.target.value)}
            aria-label="Message"
            className="h-12 flex-1 rounded-full border border-border bg-surface-muted px-5 text-[15px] outline-none transition focus:border-primary focus:bg-surface focus:ring-4 focus:ring-ring/25"
          />
          <Button type="submit" size="icon" loading={sending} disabled={!text.trim()} aria-label="Send" className="size-12">
            {!sending && <SendHorizontal />}
          </Button>
        </div>
      </form>
    </div>
  );
}
