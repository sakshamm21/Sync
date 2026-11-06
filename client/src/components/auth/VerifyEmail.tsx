'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ArrowLeft, Info } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { ApiError, errorMessage, type User } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { FormAlert } from '@/components/ui/field';
import { cn } from '@/lib/cn';
import AuthCard, { linkClass } from './AuthCard';

interface VerifyEmailProps {
  email: string;
  /** Present only when the server can't send email (development / demo). */
  devCode?: string;
  /** Send a fresh code on mount (e.g. when an unverified user tries to sign in). */
  sendOnMount?: boolean;
  onVerified: (user: User) => void;
  onBack: () => void;
}

const RESEND_SECONDS = 30;
const LENGTH = 6;

/** Six single-digit boxes that behave like one input (typing, backspace, paste). */
function CodeInput({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length: LENGTH }, (_, i) => value[i] ?? '');

  const setAt = (index: number, digit: string) => {
    const next = digits.slice();
    next[index] = digit;
    onChange(next.join('').slice(0, LENGTH));
  };

  return (
    <div
      className="flex justify-between gap-2"
      onPaste={(e) => {
        const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, LENGTH);
        if (pasted) {
          e.preventDefault();
          onChange(pasted);
          refs.current[Math.min(pasted.length, LENGTH - 1)]?.focus();
        }
      }}
    >
      {digits.map((digit, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          aria-label={`Digit ${i + 1}`}
          maxLength={1}
          disabled={disabled}
          value={digit}
          autoFocus={i === 0}
          onChange={(e) => {
            const d = e.target.value.replace(/\D/g, '').slice(-1);
            setAt(i, d);
            if (d && i < LENGTH - 1) refs.current[i + 1]?.focus();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Backspace' && !digit && i > 0) refs.current[i - 1]?.focus();
          }}
          className={cn(
            'h-16 w-12 rounded-2xl border border-border bg-surface-muted text-center font-display text-3xl font-extrabold tabular-nums outline-none transition sm:w-14',
            'focus:-translate-y-1 focus:border-primary focus:ring-4 focus:ring-ring/25',
            digit && 'border-primary bg-primary-soft'
          )}
        />
      ))}
    </div>
  );
}

export default function VerifyEmail({ email, devCode: initialDevCode, sendOnMount, onVerified, onBack }: VerifyEmailProps) {
  const { verifyEmail, resendVerification } = useAuth();
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState(initialDevCode);
  const [cooldown, setCooldown] = useState(sendOnMount ? 0 : RESEND_SECONDS);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function resend(silent = false) {
    try {
      const result = await resendVerification(email);
      setDevCode(result.devCode);
      setCooldown(RESEND_SECONDS);
      if (!silent) toast.success('A new code is on its way.');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'RESEND_COOLDOWN') {
        setCooldown(RESEND_SECONDS);
        if (silent) return;
      }
      setError(errorMessage(err));
    }
  }

  useEffect(() => {
    if (sendOnMount) resend(true);
    // Only on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit(value: string) {
    setError(null);
    setLoading(true);
    try {
      onVerified(await verifyEmail(email, value));
    } catch (err) {
      if (err instanceof ApiError && err.code === 'ALREADY_VERIFIED') {
        toast.info('Your email is already verified. Please sign in.');
        onBack();
        return;
      }
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  const updateCode = (value: string) => {
    setCode(value);
    if (value.length === LENGTH) submit(value);
  };

  return (
    <AuthCard
      title={
        <>
          check your <em>inbox</em>.
        </>
      }
      subtitle={
        <>
          Enter the 6-digit code we sent to <span className="font-medium text-foreground">{email}</span>.
        </>
      }
      footer={
        cooldown > 0 ? (
          <>Didn&apos;t get it? You can resend in {cooldown}s</>
        ) : (
          <>
            Didn&apos;t get it?{' '}
            <button type="button" onClick={() => resend()} className={linkClass}>
              Resend code
            </button>
          </>
        )
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(code);
        }}
        className="space-y-5"
      >
        {devCode && (
          <div className="flex gap-3 rounded-2xl border border-primary/20 bg-primary-soft p-4 text-sm text-primary-soft-foreground">
            <Info className="mt-0.5 size-4 shrink-0" />
            <div>
              Email delivery isn&apos;t set up yet, so here&apos;s your code:{' '}
              <button
                type="button"
                onClick={() => updateCode(devCode)}
                className="font-mono font-semibold tracking-widest underline underline-offset-4"
              >
                {devCode}
              </button>
            </div>
          </div>
        )}

        <CodeInput value={code} onChange={updateCode} disabled={loading} />
        <FormAlert message={error} />

        <Button type="submit" size="lg" loading={loading} disabled={code.length !== LENGTH} className="w-full">
          Verify and continue
        </Button>
        <Button variant="ghost" onClick={onBack} className="w-full">
          <ArrowLeft /> Back to sign in
        </Button>
      </form>
    </AuthCard>
  );
}
