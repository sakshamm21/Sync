import { EmptyState } from '@/components/ui/surface';
import { ButtonLink } from '@/components/ui/button';

/** Shown when an event link is broken, private or has been deleted. */
export default function NotFound() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-24">
      <EmptyState
        emoji="🔍"
        title="Event not found"
        description="This event may have been deleted, made private, or the link is wrong."
        action={<ButtonLink href="/explore">See what's on</ButtonLink>}
      />
    </main>
  );
}