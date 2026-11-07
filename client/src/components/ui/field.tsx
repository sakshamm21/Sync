import React from 'react';
import { cn } from '@/lib/cn';

const control =
  'w-full rounded-2xl border border-border bg-surface-muted px-4 text-[15px] text-foreground placeholder:text-subtle ' +
  'transition-[border-color,box-shadow,background-color] duration-150 outline-none ' +
  'hover:border-border-strong focus:border-primary focus:bg-surface focus:ring-4 focus:ring-ring/25 ' +
  'aria-[invalid=true]:border-danger disabled:opacity-55';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref
) {
  return <input ref={ref} className={cn(control, 'h-12', className)} {...props} />;
});

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return <textarea ref={ref} className={cn(control, 'min-h-24 resize-y py-3 leading-relaxed', className)} {...props} />;
  }
);

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, ...props },
  ref
) {
  return <select ref={ref} className={cn(control, 'h-12 cursor-pointer pr-9', className)} {...props} />;
});

function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn('mb-2 block font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted', className)}
      {...props}
    />
  );
}

interface FieldProps {
  label?: React.ReactNode;
  htmlFor?: string;
  hint?: React.ReactNode;
  error?: string;
  className?: string;
  children: React.ReactNode;
}

/** Label + control + hint/error, consistently spaced. */
export function Field({ label, htmlFor, hint, error, className, children }: FieldProps) {
  return (
    <div className={className}>
      {label && <Label htmlFor={htmlFor}>{label}</Label>}
      {children}
      {error ? (
        <p className="mt-1.5 text-xs font-medium text-danger">{error}</p>
      ) : (
        hint && <p className="mt-1.5 text-xs text-subtle">{hint}</p>
      )}
    </div>
  );
}

/** Inline form-level message. */
export function FormAlert({ message, tone = 'danger' }: { message?: string | null; tone?: 'danger' | 'success' | 'info' }) {
  if (!message) return null;
  const tones = {
    danger: 'bg-danger-soft text-danger border-danger/25',
    success: 'bg-success-soft text-success border-success/25',
    info: 'bg-primary-soft text-primary-soft-foreground border-primary/25',
  };
  return (
    <p role="alert" className={cn('rounded-2xl border px-4 py-3 text-sm', tones[tone])}>
      {message}
    </p>
  );
}
