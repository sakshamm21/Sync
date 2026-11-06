'use client';

import React, { useId } from 'react';
import { motion } from 'motion/react';
import { cn } from '@/lib/cn';

interface SegmentedProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: React.ReactNode; count?: number }[];
  className?: string;
  size?: 'sm' | 'md';
}

/** Pill tabs; the highlight slides between options. */
export function Segmented<T extends string>({ value, onChange, options, className, size = 'md' }: SegmentedProps<T>) {
  const id = useId();
  return (
    <div
      className={cn('inline-flex items-center gap-1 rounded-full border border-border bg-surface-muted p-1', className)}
      role="tablist"
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={cn(
              'relative whitespace-nowrap rounded-full font-semibold transition-colors',
              size === 'sm' ? 'px-3 py-1 text-xs' : 'px-4 py-1.5 text-sm',
              active ? 'text-primary-foreground' : 'text-muted hover:text-foreground'
            )}
          >
            {active && (
              <motion.span
                layoutId={`seg-${id}`}
                className="absolute inset-0 rounded-full bg-primary"
                transition={{ type: 'spring', bounce: 0.25, duration: 0.5 }}
              />
            )}
            <span className="relative flex items-center gap-1.5">
              {option.label}
              {option.count !== undefined && (
                <span
                  className={cn(
                    'rounded-full px-1.5 text-[10px] tabular-nums',
                    active ? 'bg-black/15' : 'bg-surface-raised text-subtle'
                  )}
                >
                  {option.count}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

interface ChipsProps<T extends string> {
  value: T | null;
  onChange: (value: T | null) => void;
  options: { value: T; label: string; emoji?: string }[];
  allLabel?: string;
}

/** Horizontally scrolling filter chips, with optional emoji. */
export function FilterChips<T extends string>({ value, onChange, options, allLabel = 'Everything' }: ChipsProps<T>) {
  const all = [{ value: null as T | null, label: allLabel, emoji: '✨' }, ...options];
  return (
    <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 py-1">
      {all.map((option) => {
        const active = option.value === value;
        return (
          <motion.button
            key={option.value ?? 'all'}
            whileTap={{ scale: 0.94 }}
            onClick={() => onChange(option.value)}
            className={cn(
              'flex shrink-0 items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-semibold transition-colors',
              active
                ? 'border-transparent bg-foreground text-background'
                : 'border-border bg-surface text-muted hover:border-border-strong hover:text-foreground'
            )}
          >
            {option.emoji && <span aria-hidden="true">{option.emoji}</span>}
            {option.label}
          </motion.button>
        );
      })}
    </div>
  );
}
