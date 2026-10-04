'use client';

import { useEffect } from 'react';
import { EmptyState } from '@/components/ui/surface';
import { ButtonLink } from '@/components/ui/button';

/** Shown when an event page fails to render. */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // In production this is where a monitoring tool would be called.
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto max-w-3xl px-4 py-24">
      <EmptyState
        emoji="🫠"
        title="This page didn't load"
        description="Something went wrong on our side. Try again, and if it keeps happening let us know."
        action={
          <div className="flex gap-3">
            <ButtonLink href="/explore" variant="secondary">
              Explore events
            </ButtonLink>
            <ButtonLink href="/">Go home</ButtonLink>
          </div>
        }
      />
      <div className="mt-6 flex justify-center">
        <button onClick={reset} className="text-sm text-muted underline-offset-2 hover:text-foreground hover:underline">
          Try again
        </button>
      </div>
    </main>
  );
}