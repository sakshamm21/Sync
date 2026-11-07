import { Check, Hourglass } from 'lucide-react';
import type { SyncEvent } from '@/lib/api';
import { CATEGORY_EMOJI, CATEGORY_GRADIENTS, CATEGORY_LABELS } from '@/lib/format';
import { Sticker } from '@/components/ui/surface';
import { cn } from '@/lib/cn';

export function statusOf(event: SyncEvent) {
  if (event.status === 'cancelled') return { label: 'Cancelled', className: 'bg-danger text-white' };
  if (event.status === 'draft') return { label: 'Draft', className: 'bg-black text-white' };
  if (event.viewer.registration === 'going')
    return { label: "You're in", icon: <Check />, className: 'bg-primary text-primary-foreground' };
  if (event.viewer.registration === 'waitlisted')
    return { label: 'Waitlisted', icon: <Hourglass />, className: 'bg-warning text-black' };
  if (event.isPast) return { label: 'Ended', className: 'bg-black text-white' };
  if (event.spotsLeft === 0) return { label: 'Sold out 🔥', className: 'bg-pink text-white' };
  if (event.spotsLeft != null && event.spotsLeft <= 5)
    return { label: `${event.spotsLeft} left`, className: 'bg-orange text-black' };
  return null;
}

/** Event photo, or a loud gradient with a giant emoji, plus tilted stickers. */
export default function EventCover({
  event,
  className,
  stickers = true,
}: {
  event: SyncEvent;
  className?: string;
  stickers?: boolean;
}) {
  const status = statusOf(event);
  return (
    <div className={cn('relative overflow-hidden bg-surface-muted', className)}>
      {event.coverImageUrl ? (
        <img
          src={event.coverImageUrl}
          alt=""
          loading="lazy"
          className="size-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.06]"
        />
      ) : (
        <div
          className={cn(
            'relative size-full bg-gradient-to-br transition-transform duration-700 ease-out group-hover:scale-[1.06]',
            CATEGORY_GRADIENTS[event.category]
          )}
        >
          <span
            aria-hidden="true"
            className="absolute -bottom-6 -right-2 text-[7rem] leading-none opacity-90 drop-shadow-2xl transition-transform duration-700 group-hover:rotate-[-8deg]"
          >
            {CATEGORY_EMOJI[event.category]}
          </span>
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_15%,rgba(255,255,255,0.45),transparent_45%)]" />
        </div>
      )}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-black/10" />

      {stickers && (
        <>
          <Sticker rotate={-5} className="absolute left-3 top-3">
            <span aria-hidden="true">{CATEGORY_EMOJI[event.category]}</span>
            {CATEGORY_LABELS[event.category]}
          </Sticker>
          {status && (
            <Sticker rotate={4} className={cn('absolute right-3 top-3 border-transparent', status.className)}>
              {status.icon}
              {status.label}
            </Sticker>
          )}
        </>
      )}
    </div>
  );
}
