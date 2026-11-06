import React from 'react';
import Link from 'next/link';
import { LoaderCircle } from 'lucide-react';
import { cn } from '@/lib/cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'outline' | 'danger' | 'soft' | 'inverse';
type Size = 'sm' | 'md' | 'lg' | 'xl' | 'icon' | 'icon-sm';

const variants: Record<Variant, string> = {
  primary: 'bg-primary text-primary-foreground font-semibold hover:bg-primary-hover hover:shadow-[0_8px_30px_-6px_var(--glow)]',
  secondary: 'bg-surface-muted text-foreground border border-border hover:border-border-strong hover:bg-surface-raised',
  outline: 'border border-border-strong text-foreground hover:bg-surface-muted',
  ghost: 'text-muted hover:text-foreground hover:bg-surface-muted',
  soft: 'bg-primary-soft text-primary-soft-foreground hover:brightness-110',
  danger: 'bg-danger text-white font-semibold hover:brightness-110',
  inverse: 'bg-foreground text-background font-semibold hover:opacity-90',
};

const sizes: Record<Size, string> = {
  sm: 'h-8 px-3.5 text-xs gap-1.5',
  md: 'h-10 px-5 text-sm gap-2',
  lg: 'h-12 px-6 text-[15px] gap-2',
  xl: 'h-14 px-8 text-base gap-2.5',
  icon: 'size-10',
  'icon-sm': 'size-8',
};

function buttonClasses({
  variant = 'primary',
  size = 'md',
  className,
}: { variant?: Variant; size?: Size; className?: string } = {}) {
  return cn(
    'inline-flex items-center justify-center rounded-full font-medium whitespace-nowrap select-none',
    'transition-[background-color,border-color,color,box-shadow,transform,filter,opacity] duration-200',
    'active:scale-[0.96] disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-4 [&_svg]:shrink-0',
    variants[variant],
    sizes[size],
    className
  );
}

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

export function Button({ variant, size, loading, className, children, disabled, type = 'button', ...props }: ButtonProps) {
  return (
    <button type={type} disabled={disabled || loading} className={buttonClasses({ variant, size, className })} {...props}>
      {loading && <LoaderCircle className="animate-spin" />}
      {children}
    </button>
  );
}

interface ButtonLinkProps extends React.ComponentProps<typeof Link> {
  variant?: Variant;
  size?: Size;
}

export function ButtonLink({ variant, size, className, ...props }: ButtonLinkProps) {
  return <Link className={buttonClasses({ variant, size, className })} {...props} />;
}
