import React from 'react';
import { cn } from '@/lib/cn';

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-[28px] border border-border bg-surface', className)} {...props} />;
}

/** Small uppercase monospace label, used above headings and for metadata. */
export function Kicker({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-muted', className)} {...props} />;
}

type BadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'pink' | 'cyan';
const badgeTones: Record<BadgeTone, string> = {
  neutral: 'bg-surface-muted text-muted border-border',
  primary: 'bg-primary text-primary-foreground border-transparent',
  success: 'bg-success-soft text-success border-transparent',
  warning: 'bg-warning-soft text-warning border-transparent',
  danger: 'bg-danger-soft text-danger border-transparent',
  pink: 'bg-pink text-white border-transparent',
  cyan: 'bg-cyan text-black border-transparent',
};

export function Badge({ tone = 'neutral', className, ...props }: React.HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold [&_svg]:size-3',
        badgeTones[tone],
        className
      )}
      {...props}
    />
  );
}

/** A tilted, slightly raised label that looks stuck onto the card. */
export function Sticker({ className, rotate = -4, ...props }: React.HTMLAttributes<HTMLSpanElement> & { rotate?: number }) {
  return (
    <span
      style={{ rotate: `${rotate}deg` }}
      className={cn(
        'inline-flex items-center gap-1 rounded-full border border-black/10 bg-white px-3 py-1 text-xs font-bold text-black shadow-[0_6px_16px_-6px_rgb(0_0_0/0.5)] [&_svg]:size-3.5',
        className
      )}
      {...props}
    />
  );
}

const avatarGradients = [
  'from-lime to-cyan',
  'from-pink to-orange',
  'from-cyan to-primary',
  'from-orange to-lime',
  'from-primary to-pink',
];

export function Avatar({ name, src, size = 36, className }: { name: string; src?: string; size?: number; className?: string }) {
  const initials = name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  const gradient = avatarGradients[(name.charCodeAt(0) || 0) % avatarGradients.length];
  const style = { width: size, height: size, fontSize: Math.max(size * 0.38, 11) };
  return src ? (
    <img src={src} alt="" style={style} className={cn('rounded-full object-cover ring-2 ring-background', className)} />
  ) : (
    <span
      style={style}
      className={cn(
        'inline-flex items-center justify-center rounded-full bg-gradient-to-br font-display font-bold text-black ring-2 ring-background',
        gradient,
        className
      )}
    >
      {initials || '?'}
    </span>
  );
}

export function EmptyState({
  emoji = '🫥',
  title,
  description,
  action,
  className,
}: {
  emoji?: string;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-[28px] border border-dashed border-border-strong px-6 py-16 text-center',
        className
      )}
    >
      <span className="mb-4 text-5xl" style={{ rotate: '-8deg' }} aria-hidden="true">
        {emoji}
      </span>
      <p className="font-display text-xl font-bold">{title}</p>
      {description && <p className="mt-1.5 max-w-sm text-sm text-muted">{description}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

/** Big display title with a mono kicker; wrap a word in <em> for the serif accent. */
export function PageHeader({
  kicker,
  title,
  description,
  actions,
}: {
  kicker?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-10 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {kicker && <Kicker className="mb-3">{kicker}</Kicker>}
        <h1 className="text-5xl font-extrabold leading-[0.95] sm:text-6xl [&_em]:font-serif [&_em]:font-normal [&_em]:italic [&_em]:text-primary">
          {title}
        </h1>
        {description && <p className="mt-3 max-w-xl text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Scoreboard number: huge display figure with a label. */
export function StatCard({
  label,
  value,
  icon,
  hint,
  accent,
}: {
  label: string;
  value: React.ReactNode;
  icon?: React.ReactNode;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <Card
      className={cn('relative h-full overflow-hidden p-5', accent && 'border-transparent bg-primary text-primary-foreground')}
    >
      <div className="flex items-center justify-between">
        <Kicker className={cn(accent && 'text-primary-foreground/70')}>{label}</Kicker>
        {icon && <span className={cn('[&_svg]:size-4', accent ? 'text-primary-foreground/70' : 'text-subtle')}>{icon}</span>}
      </div>
      <p className="mt-4 font-display text-5xl font-extrabold tabular-nums tracking-tight">{value}</p>
      {hint && <p className={cn('mt-1 text-xs', accent ? 'text-primary-foreground/70' : 'text-subtle')}>{hint}</p>}
    </Card>
  );
}

/** Section heading with an optional link on the right. */
export function SectionTitle({ title, action, emoji }: { title: React.ReactNode; action?: React.ReactNode; emoji?: string }) {
  return (
    <div className="mb-5 flex items-end justify-between gap-4">
      <h2 className="flex items-center gap-2 text-2xl font-extrabold sm:text-3xl [&_em]:font-serif [&_em]:font-normal [&_em]:italic [&_em]:text-primary">
        {emoji && <span aria-hidden="true">{emoji}</span>}
        {title}
      </h2>
      {action}
    </div>
  );
}
