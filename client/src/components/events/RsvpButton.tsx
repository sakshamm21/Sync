'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import confetti from 'canvas-confetti';
import { CalendarPlus, Check, Hourglass, Settings2, Plus, ScanLine, X } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useEventsSync } from '@/context/EventContext';
import { errorMessage, eventsApi, type SyncEvent } from '@/lib/api';
import { Button, ButtonLink } from '@/components/ui/button';
import { Dialog } from '@/components/ui/overlay';
import { cn } from '@/lib/cn';
import { TicketQr } from '@/components/events/QrTicket';
import { SITE_URL, googleCalendarUrl } from '@/lib/calendarLinks';
import { formatDay, formatTime } from '@/lib/format';

interface RsvpButtonProps {
  event: SyncEvent;
  onChange: (event: SyncEvent) => void;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

const BRAND_CONFETTI = ['#d4ff3a', '#ff4fd8', '#3df5ff', '#ff7a1a', '#8b5cff'];

/** Confetti bursting from the button that was clicked. */
function celebrate(from: HTMLElement | null) {
  if (typeof window === 'undefined' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const rect = from?.getBoundingClientRect();
  const origin = rect
    ? { x: (rect.left + rect.width / 2) / window.innerWidth, y: (rect.top + rect.height / 2) / window.innerHeight }
    : { x: 0.5, y: 0.6 };
  confetti({ particleCount: 90, spread: 75, startVelocity: 38, origin, colors: BRAND_CONFETTI, scalar: 0.9, zIndex: 80 });
  setTimeout(
    () =>
      confetti({
        particleCount: 40,
        spread: 110,
        startVelocity: 25,
        origin,
        colors: BRAND_CONFETTI,
        shapes: ['star'],
        zIndex: 80,
      }),
    180
  );
}

/** One button for every registration state: RSVP, join waitlist, going, waitlisted, manage. */
export default function RsvpButton({ event, onChange, size = 'sm', className }: RsvpButtonProps) {
  // While the session is being restored, `user` is still null: wait rather than
  // treating a signed-in person as a visitor and sending them to sign in.
  const { user, status: authStatus } = useAuth();
  const router = useRouter();
  const { eventsChanged } = useEventsSync();
  const [pending, setPending] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [confirmingLeave, setConfirmingLeave] = useState(false);
  const [questionsOpen, setQuestionsOpen] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const buttonRef = useRef<HTMLDivElement>(null);

  if (event.visibility === 'private') return null;

  if (event.viewer.canManage) {
    return (
      <ButtonLink href={`/organizer/events/${event.id}`} variant="secondary" size={size} className={className}>
        <Settings2 /> Manage
      </ButtonLink>
    );
  }
  // Door staff run the event rather than attend it.
  if (event.viewer.canCheckIn) {
    return (
      <ButtonLink href={`/organizer/events/${event.id}`} variant="secondary" size={size} className={className}>
        <ScanLine /> Door check-in
      </ButtonLink>
    );
  }
  if (event.status === 'cancelled' || event.isPast) {
    return (
      <Button variant="secondary" size={size} disabled className={className}>
        {event.status === 'cancelled' ? 'Cancelled' : 'Ended'}
      </Button>
    );
  }

  const registration = event.viewer.registration;

  async function register(answers: { question: string; answer: string }[] = []) {
    if (!user) {
      router.push(`/authentication?next=${encodeURIComponent(`/events/${event.id}`)}`);
      return;
    }
    // Events with questions ask them first, in a sheet.
    if (event.questions?.length && !questionsOpen) {
      setQuestionsOpen(true);
      return;
    }
    setPending(true);
    try {
      // Registering can report a clash with something already in the calendar.
      // It is a warning, not a block: the RSVP still goes through.
      const result = await eventsApi.register(event.id, answers);
      onChange(result);
      eventsChanged();
      setQuestionsOpen(false);
      if (result.viewer.registration === 'pending') {
        toast('Request sent', { description: "The organiser will approve or decline it. We'll let you know." });
      } else if (result.viewer.registration === 'going') {
        celebrate(buttonRef.current);
        toast.success("You're in! 🎉", { description: "It's on your schedule. We'll nudge you the day before." });
      } else {
        toast("You're on the waitlist ⏳", { description: "It's packed rn. If a spot opens, you're in automatically." });
      }
      for (const clash of result.clashes) {
        toast.warning(`Heads up, clashes with ${clash.title}`, {
          description: 'Both are on your calendar — you can drop one whenever.',
          action: { label: 'View', onClick: () => router.push(`/events/${clash.id}`) },
        });
      }
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setPending(false);
    }
  }

  async function leave() {
    try {
      onChange(await eventsApi.unregister(event.id));
      eventsChanged();
      setSheetOpen(false);
      toast(registration === 'going' ? 'Plans cancelled. Your spot went to the next person.' : 'You left the waitlist');
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function addToCalendar() {
    try {
      await eventsApi.downloadCalendarFile(event);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  // A seat is being held: the main action is to claim it, before it passes on.
  if (registration === 'offered') {
    return (
      <div ref={buttonRef} className={cn('space-y-2', className)}>
        <Button
          size={size}
          loading={pending}
          className="w-full"
          onClick={async () => {
            setPending(true);
            try {
              onChange(await eventsApi.claim(event.id));
              eventsChanged();
              celebrate(buttonRef.current);
              toast.success("You're in! 🎉", { description: 'The spot is yours.' });
            } catch (err) {
              toast.error(errorMessage(err));
            } finally {
              setPending(false);
            }
          }}
        >
          {!pending && <Check />} Claim your spot
        </Button>
        {event.viewer.offerExpiresAt && (
          <p className="text-center text-xs text-muted">
            Held for you until {formatDay(event.viewer.offerExpiresAt)}, {formatTime(event.viewer.offerExpiresAt)}.{' '}
            <button type="button" className="underline underline-offset-2" onClick={() => void leave()}>
              No thanks
            </button>
          </p>
        )}
      </div>
    );
  }

  if (registration) {
    // A single tap used to cancel (the "Cancel plans" label only showed on
    // hover, which phones don't have). Now it opens a sheet; cancelling is a
    // deliberate second step.
    const contested = event.spotsLeft === 0;
    return (
      <div ref={buttonRef} className={className}>
        <Button variant="soft" size={size} onClick={() => setSheetOpen(true)} className="w-full" aria-haspopup="dialog">
          {registration === 'going' ? <Check /> : <Hourglass />}
          {registration === 'going' ? "You're in" : registration === 'pending' ? 'Requested' : 'Waitlisted'}
        </Button>
        <Dialog
          open={sheetOpen}
          onClose={() => {
            setSheetOpen(false);
            setConfirmingLeave(false);
          }}
          size="sm"
          title={registration === 'going' ? "You're in" : registration === 'pending' ? 'Request sent' : "You're on the waitlist"}
          description={event.title}
        >
          <div className="space-y-3 px-6 pb-6 sm:px-8">
            {registration === 'going' && event.visibility === 'public' && (
              <div className="flex justify-center py-2">
                <TicketQr event={event} />
              </div>
            )}
            {registration === 'pending' && (
              <p className="text-sm text-muted">
                The organiser approves each place for this event. We&apos;ll let you know either way.
              </p>
            )}
            {registration === 'waitlisted' && (
              <p className="text-sm text-muted">
                {event.viewer.waitlistPosition ? (
                  <strong className="text-foreground">You&apos;re #{event.viewer.waitlistPosition} in line. </strong>
                ) : null}
                If a spot opens you&apos;ll be moved in automatically and notified.
              </p>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" className="w-full" onClick={addToCalendar}>
                <CalendarPlus /> Download .ics
              </Button>
              <ButtonLink
                variant="secondary"
                className="w-full"
                href={googleCalendarUrl(event, SITE_URL)}
                target="_blank"
                rel="noopener noreferrer"
              >
                <CalendarPlus /> Google Calendar
              </ButtonLink>
            </div>
            {confirmingLeave ? (
              <div className="space-y-3 rounded-2xl bg-danger-soft p-4">
                <p className="text-sm text-danger">
                  {registration === 'going'
                    ? contested
                      ? "This event is full. Your spot goes to the next person on the waitlist and you'll have to queue to get back in."
                      : 'Your spot goes back in the pool.'
                    : "You'll lose your place in the queue."}
                </p>
                <div className="flex gap-2">
                  <Button variant="ghost" className="flex-1" onClick={() => setConfirmingLeave(false)}>
                    Keep it
                  </Button>
                  <Button variant="danger" className="flex-1" onClick={leave}>
                    {registration === 'going' ? 'Cancel my spot' : 'Leave waitlist'}
                  </Button>
                </div>
              </div>
            ) : (
              <Button variant="ghost" className="w-full text-danger" onClick={() => setConfirmingLeave(true)}>
                <X /> {registration === 'going' ? 'Cancel my spot' : 'Leave the waitlist'}
              </Button>
            )}
          </div>
        </Dialog>
      </div>
    );
  }

  // Outside the organiser's sign-up window: say when, rather than failing on tap.
  const now = Date.now();
  if (event.registrationOpensAt && new Date(event.registrationOpensAt).getTime() > now) {
    return (
      <Button variant="secondary" size={size} disabled className={className}>
        Opens {formatDay(event.registrationOpensAt)}, {formatTime(event.registrationOpensAt)}
      </Button>
    );
  }
  if (event.registrationClosesAt && new Date(event.registrationClosesAt).getTime() <= now) {
    return (
      <Button variant="secondary" size={size} disabled className={className}>
        Registration closed
      </Button>
    );
  }

  const questionsSheet = event.questions?.length ? (
    <Dialog
      open={questionsOpen}
      onClose={() => setQuestionsOpen(false)}
      size="sm"
      title={event.requiresApproval ? 'Request a place' : 'A few questions'}
      description={event.title}
    >
      <form
        className="space-y-4 px-6 pb-6 sm:px-8"
        onSubmit={(e) => {
          e.preventDefault();
          void register(Object.entries(answers).map(([question, answer]) => ({ question, answer })));
        }}
      >
        {event.questions.map((q) => (
          <label key={q.id} className="block space-y-1.5">
            <span className="text-sm font-medium">
              {q.label}
              {q.required && <span className="text-danger"> *</span>}
            </span>
            {q.kind === 'choice' ? (
              <select
                required={q.required}
                value={answers[q.id] ?? ''}
                onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                className="h-11 w-full rounded-xl border border-border bg-surface-muted px-3 text-sm outline-none focus:border-primary"
              >
                <option value="">Choose…</option>
                {q.options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            ) : (
              <input
                required={q.required}
                maxLength={1000}
                value={answers[q.id] ?? ''}
                onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                className="h-11 w-full rounded-xl border border-border bg-surface-muted px-3 text-sm outline-none focus:border-primary"
              />
            )}
          </label>
        ))}
        <Button type="submit" loading={pending} className="w-full">
          {event.requiresApproval ? 'Send request' : "I'm in"}
        </Button>
      </form>
    </Dialog>
  ) : null;

  return (
    <div ref={buttonRef} className={className}>
      <Button
        disabled={authStatus === 'loading'}
        variant={event.spotsLeft === 0 ? 'secondary' : 'primary'}
        size={size}
        loading={pending}
        onClick={() => register()}
        className="w-full"
      >
        {!pending && <Plus />}
        {event.requiresApproval ? 'Request a place' : event.spotsLeft === 0 ? 'Join waitlist' : "I'm in"}
      </Button>
      {questionsSheet}
    </div>
  );
}
