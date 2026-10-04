/** Shown while an event page streams in. */
export default function Loading() {
  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-7xl px-4 pt-4 sm:px-6 lg:px-8">
        <div className="h-[52vh] min-h-[360px] w-full animate-pulse rounded-[40px] bg-surface-muted" />
      </div>
      <div className="mx-auto mt-10 grid max-w-7xl gap-10 px-4 sm:px-6 lg:grid-cols-[1fr_24rem] lg:px-8">
        <div className="space-y-4">
          <div className="h-8 w-1/3 animate-pulse rounded bg-surface-muted" />
          <div className="h-4 w-full animate-pulse rounded bg-surface-muted" />
          <div className="h-4 w-4/5 animate-pulse rounded bg-surface-muted" />
        </div>
        <div className="hidden lg:block">
          <div className="h-72 animate-pulse rounded-[28px] bg-surface-muted" />
        </div>
      </div>
    </div>
  );
}