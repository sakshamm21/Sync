'use client';

import React, { useState } from 'react';
import { ArrowLeft, MailCheck } from 'lucide-react';
import { authApi, errorMessage } from '@/lib/api';
import { Button, ButtonLink } from '@/components/ui/button';
import { Field, FormAlert, Input } from '@/components/ui/field';
import AuthCard from './AuthCard';

export default function ForgotPassword({ initialEmail = '', onBack }: { initialEmail?: string; onBack: () => void }) {
  const [email, setEmail] = useState(initialEmail);
  const [sent, setSent] = useState(false);
  const [devResetUrl, setDevResetUrl] = useState<string>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await authApi.forgotPassword(email);
      setDevResetUrl(result.devResetUrl);
      setSent(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <AuthCard
        title={
          <>
            link <em>sent</em>.
          </>
        }
        subtitle={`If an account exists for ${email}, a reset link is on its way. It expires in 30 minutes.`}
      >
        <div className="space-y-3">
          <div className="flex justify-center py-4 text-primary">
            <MailCheck className="size-12" strokeWidth={1.5} />
          </div>
          {devResetUrl && (
            <ButtonLink href={devResetUrl} variant="soft" className="w-full">
              Email isn&apos;t set up yet. Open your reset link
            </ButtonLink>
          )}
          <Button variant="secondary" onClick={onBack} className="w-full">
            <ArrowLeft /> Back to sign in
          </Button>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title={
        <>
          forgot it? <em>happens</em>.
        </>
      }
      subtitle="Enter your email and we'll send you a link to choose a new one."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Email" htmlFor="reset-email">
          <Input
            id="reset-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
          />
        </Field>
        <FormAlert message={error} />
        <Button type="submit" size="lg" loading={loading} className="w-full">
          Send reset link
        </Button>
        <Button variant="ghost" onClick={onBack} className="w-full">
          <ArrowLeft /> Back to sign in
        </Button>
      </form>
    </AuthCard>
  );
}
