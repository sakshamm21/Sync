import Link from 'next/link';
import { cn } from '@/lib/cn';

/** A four-point spark on an acid disc. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex size-9 items-center justify-center rounded-full bg-primary text-primary-foreground', className)}>
      <svg viewBox="0 0 24 24" className="size-[58%] transition-transform duration-700 group-hover:rotate-[135deg]" aria-hidden="true">
        <path fill="currentColor" d="M12 1.5c.6 4.9 3.6 9.9 10.5 10.5-6.9.6-9.9 5.6-10.5 10.5C11.4 17.6 8.4 12.6 1.5 12 8.4 11.4 11.4 6.4 12 1.5Z" />
      </svg>
    </span>
  );
}

export function Logo({ href = '/', className }: { href?: string; className?: string }) {
  return (
    <Link href={href} className={cn('group inline-flex items-center gap-2', className)} aria-label="Sync home">
      <LogoMark />
      <span className="font-display text-xl font-extrabold tracking-tight">
        sync<span className="text-primary">.</span>
      </span>
    </Link>
  );
}
