'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import confetti from 'canvas-confetti';
import { Check, Hourglass, Settings2, Plus } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useEventsSync } from '@/context/EventContext';
import { errorMessage, eventsApi, type SyncEvent } from '@/lib/api';
import { Button, ButtonLink } from '@/components/ui/button';

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
  setTimeout(() => confetti({ particleCount: 40, spread: 110, startVelocity: 25, origin, colors: BRAND_CONFETTI, shapes: ['star'], zIndex: 80 }), 180);
}

/** One button for every registration state: RSVP, join waitlist, going, waitlisted, manage. */
export default function RsvpButton({ event, onChange, size = 'sm', className }: RsvpButtonProps) {
  const { user } = useAuth();
  const router = useRouter();
  const { eventsChanged } = useEventsSync();
  const [pending, setPending] = useState(false);
  const buttonRef = useRef<HTMLDivElement>(null);

  if (event.visibility === 'private') return null;

  if (event.viewer.canManage) {
    return (
      <ButtonLink href={`/organizer/events/${event.id}`} variant="secondary" size={size} className={className}>
        <Settings2 /> Manage
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

  async function toggle() {
    if (!user) {
      router.push(`/authentication?next=${encodeURIComponent(`/events/${event.id}`)}`);
      return;
    }
    setPending(true);
    try {
          if (registration) {
            onChange(await eventsApi.unregister(event.id));
            eventsChanged();
            toast(registration === 'going' ? 'Plans cancelled. Your spot went back in the pool.' : 'You left the waitlist');
            return;
          }

          // Registering can report a clash with something already in the calendar.
          // It is a warning, not a block: the RSVP still goes through.
          const result = await eventsApi.register(event.id);
          onChange(result);
          eventsChanged();
          if (result.viewer.registration === 'going') {
            celebrate(buttonRef.current);
            toast.success("You're in! 🎉", { description: "It's on your schedule. We'll nudge you the day before." });
          } else {
            toast("You're on the waitlist ⏳", { description: "It's packed rn. If a spot opens, you're in automatically." });
          }
          for (const clash of result.clashes) {
            toast.warning(`Heads up, clashes with ${clash.title}`, {
              description: "Both are on your calendar — you can drop one whenever.",
              action: { label: 'View', onClick: () => router.push(`/events/${clash.id}`) },
            });
          }
        } catch (err) {
          toast.error(errorMessage(err));
        } finally {
          setPending(false);
        }
      }

  if (registration) {
    return (
      <div ref={buttonRef} className={className}>
        <Button variant="soft" size={size} loading={pending} onClick={toggle} title="Click to cancel" className="group/rsvp w-full">
          {!pending && (registration === 'going' ? <Check /> : <Hourglass />)}
          <span className="group-hover/rsvp:hidden">{registration === 'going' ? "You're in" : 'Waitlisted'}</span>
          <span className="hidden group-hover/rsvp:inline">{registration === 'going' ? 'Cancel plans' : 'Leave waitlist'}</span>
        </Button>
      </div>
    );
  }

  return (
    <div ref={buttonRef} className={className}>
      <Button variant={event.spotsLeft === 0 ? 'secondary' : 'primary'} size={size} loading={pending} onClick={toggle} className="w-full">
        {!pending && <Plus />}
        {event.spotsLeft === 0 ? 'Join waitlist' : "I'm in"}
      </Button>
    </div>
  );
}
