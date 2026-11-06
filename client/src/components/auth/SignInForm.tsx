'use client';

import React, { useState } from 'react';
import { Eye, EyeOff, Sparkles } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { ApiError, errorMessage, type User } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Field, FormAlert, Input } from '@/components/ui/field';
import AuthCard, { linkClass } from './AuthCard';

interface SignInFormProps {
  onSwitchToRegister: () => void;
  onForgotPassword: (email: string) => void;
  onNeedsVerification: (email: string) => void;
  onSignedIn: (user: User) => void;
}

// Accounts created by the server's seed script. Shown only when enabled.
const DEMO_ACCOUNTS = [
  { label: 'Member', email: 'member@syncronify.dev' },
  { label: 'Organizer', email: 'organizer@syncronify.dev' },
  { label: 'Admin', email: 'admin@syncronify.dev' },
];
const DEMO_PASSWORD = 'syncronify123';
const showDemoAccounts = process.env.NEXT_PUBLIC_SHOW_DEMO_ACCOUNTS === 'true';

export default function SignInForm({ onSwitchToRegister, onForgotPassword, onNeedsVerification, onSignedIn }: SignInFormProps) {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      onSignedIn(await login(email, password));
    } catch (err) {
      if (err instanceof ApiError && err.code === 'EMAIL_NOT_VERIFIED') {
        onNeedsVerification(email);
        return;
      }
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthCard
      title={<>welcome <em>back</em>.</>}
      subtitle="Your plans missed you. Sign in to see what’s on."
      footer={
        <>
          New here?{' '}
          <button type="button" onClick={onSwitchToRegister} className={linkClass}>
            Make an account
          </button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <Field label="Email" htmlFor="email">
          <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@college.edu" required />
        </Field>
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label htmlFor="password" className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted">Password</label>
            <button type="button" onClick={() => onForgotPassword(email)} className="text-xs font-medium text-muted hover:text-foreground">
              Forgot password?
            </button>
          </div>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Your password"
              className="pr-11"
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              className="absolute right-1.5 top-1.5 flex size-8 items-center justify-center rounded-lg text-muted hover:bg-surface-muted hover:text-foreground"
            >
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </div>

        <FormAlert message={error} />

        <Button type="submit" size="lg" loading={loading} className="w-full">
          Sign in
        </Button>
      </form>

      {showDemoAccounts && (
        <div className="mt-8 rounded-2xl border border-border bg-surface-muted/60 p-4">
          <p className="flex items-center gap-1.5 text-xs font-medium text-muted">
            <Sparkles className="size-3.5 text-primary" /> Try a demo account
          </p>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {DEMO_ACCOUNTS.map((account) => (
              <Button
                key={account.email}
                variant="secondary"
                size="sm"
                onClick={() => {
                  setEmail(account.email);
                  setPassword(DEMO_PASSWORD);
                }}
              >
                {account.label}
              </Button>
            ))}
          </div>
          <p className="mt-3 text-xs text-subtle">
            These accounts are shared with everyone trying Sync, and the demo data resets every night.
          </p>
        </div>
      )}
    </AuthCard>
  );
}
