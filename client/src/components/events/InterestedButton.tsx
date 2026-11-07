'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Star } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { errorMessage, eventsApi, type SyncEvent } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

/**
 * "Interested": a bookmark for events you might go to. It takes no seat, gets
 * a gentle in-app nudge the day before, and adds to the event's social proof.
 * Hidden once you've RSVPed or if you help run the event.
 */
export default function InterestedButton({
  event,
  onChange,
  className,
}: {
  event: SyncEvent;
  onChange: (e: SyncEvent) => void;
  className?: string;
}) {
  // While the session is being restored, `user` is still null: wait rather than
  // treating a signed-in person as a visitor and sending them to sign in.
  const { user, status: authStatus } = useAuth();
  const router = useRouter();
  const [pending, setPending] = useState(false);

  if (event.visibility !== 'public' || event.status !== 'published' || event.isPast) return null;
  if (event.viewer.registration || event.viewer.isOrganizer || event.viewer.canCheckIn) return null;
  const on = Boolean(event.viewer.interested);

  async function toggle() {
    if (!user) {
      router.push(`/authentication?next=${encodeURIComponent(`/events/${event.id}`)}`);
      return;
    }
    setPending(true);
    try {
      onChange(await eventsApi.setInterested(event.id, !on));
      if (!on) toast('Saved as interested', { description: "We'll nudge you the day before." });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <Button
      variant="secondary"
      size="lg"
      loading={pending}
      disabled={authStatus === 'loading'}
      onClick={toggle}
      aria-pressed={on}
      className={cn('w-full', className)}
    >
      {!pending && <Star className={cn(on && 'fill-current text-primary')} />}
      {on ? 'Interested' : "I'm interested"}
      {event.interestedCount ? <span className="text-muted">· {event.interestedCount}</span> : null}
    </Button>
  );
}
