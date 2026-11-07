'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from './button';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Fill most of the viewport (maps). */
  tall?: boolean;
}

const widths = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-2xl', xl: 'max-w-5xl' };

/**
 * Open dialogs, innermost last. Only the top one reacts to Escape and Tab, so
 * closing a dialog opened from another (the map picker inside the event form)
 * doesn't close both.
 */
const dialogStack: string[] = [];

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Bottom sheet on phones, centred card on larger screens. Escape closes the
 * top dialog; focus stays inside it and returns to the opener on close; body
 * scroll is locked.
 */
export function Dialog({ open, onClose, title, description, children, footer, size = 'md', tall }: DialogProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const id = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    dialogStack.push(id);
    const opener = document.activeElement as HTMLElement | null;
    const isTop = () => dialogStack[dialogStack.length - 1] === id;

    const onKey = (e: KeyboardEvent) => {
      if (!isTop()) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const items = [...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Move focus in once the panel has mounted.
    const focusTimer = window.setTimeout(() => {
      const panel = panelRef.current;
      if (panel && !panel.contains(document.activeElement)) (panel.querySelector<HTMLElement>('[autofocus]') ?? panel).focus();
    }, 50);

    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', onKey);
      const at = dialogStack.lastIndexOf(id);
      if (at >= 0) dialogStack.splice(at, 1);
      if (!dialogStack.length) document.body.style.overflow = previous;
      opener?.focus?.();
    };
  }, [open, id]);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
          <motion.div
            className="absolute inset-0 bg-black/60 backdrop-blur-md"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
          />
          <motion.div
            ref={panelRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? `${id}-title` : undefined}
            aria-describedby={description ? `${id}-desc` : undefined}
            className={cn(
              'relative flex w-full flex-col overflow-hidden rounded-t-[32px] outline-none border border-border bg-surface shadow-overlay sm:rounded-[32px]',
              widths[size],
              tall ? 'h-[92vh]' : 'max-h-[92vh]'
            )}
            initial={{ opacity: 0, y: 60, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 40, scale: 0.97 }}
            transition={{ type: 'spring', bounce: 0.2, duration: 0.5 }}
          >
            {(title || description) && (
              <div className="flex items-start justify-between gap-4 px-6 pb-4 pt-6 sm:px-8">
                <div>
                  {title && <h2 id={`${id}-title`} className="text-2xl font-extrabold [&_em]:font-serif [&_em]:font-normal [&_em]:italic [&_em]:text-primary">{title}</h2>}
                  {description && <p id={`${id}-desc`} className="mt-1 text-sm text-muted">{description}</p>}
                </div>
                <button
                  onClick={onClose}
                  aria-label="Close"
                  className="-mr-2 flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-muted text-muted transition hover:rotate-90 hover:text-foreground"
                >
                  <X className="size-5" />
                </button>
              </div>
            )}
            <div className="flex-1 overflow-y-auto">{children}</div>
            {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-6 py-4 sm:px-8">{footer}</div>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}

interface PopoverProps {
  trigger: (props: { open: boolean; toggle: () => void }) => React.ReactNode;
  children: (close: () => void) => React.ReactNode;
  align?: 'left' | 'right';
  side?: 'bottom' | 'top';
  className?: string;
}

/** Small anchored panel (menus, notification list). Closes on outside click and Escape. */
export function Popover({ trigger, children, align = 'right', side = 'bottom', className }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: side === 'bottom' ? -8 : 8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: side === 'bottom' ? -8 : 8, scale: 0.95 }}
            transition={{ type: 'spring', bounce: 0.25, duration: 0.35 }}
            className={cn(
              'absolute z-50 rounded-3xl border border-border bg-surface-raised/95 shadow-overlay backdrop-blur-xl',
              side === 'bottom' ? 'top-full mt-2 origin-top' : 'bottom-full mb-3 origin-bottom',
              align === 'right' ? 'right-0' : 'left-0',
              className
            )}
          >
            {children(() => setOpen(false))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function MenuItem({ icon, children, className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon?: React.ReactNode }) {
  return (
    <button
      type="button"
      className={cn('flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm font-medium transition hover:bg-surface-muted [&_svg]:size-4 [&_svg]:text-muted', className)}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
}

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  description?: React.ReactNode;
  confirmLabel: string;
  tone?: 'danger' | 'primary';
  /** Extra inputs (e.g. a message to attendees). */
  children?: React.ReactNode;
}

/** Replaces window.confirm with an on-brand, accessible dialog. */
export function ConfirmDialog({ open, onClose, onConfirm, title, description, confirmLabel, tone = 'danger', children }: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    setBusy(true);
    try {
      await onConfirm();
      onClose();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="sm"
      title={title}
      description={description}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Never mind
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} loading={busy} onClick={confirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children && <div className="px-6 pb-6 sm:px-8">{children}</div>}
    </Dialog>
  );
}
