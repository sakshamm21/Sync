'use client';

import React, { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import AuthLayout from '@/components/auth/AuthLayout';
import AuthCard from '@/components/auth/AuthCard';
import { Button, ButtonLink } from '@/components/ui/button';
import { Field, FormAlert, Input } from '@/components/ui/field';
import { useAuth } from '@/context/AuthContext';
import { authApi, errorMessage } from '@/lib/api';
import { APP_HOME } from '@/lib/format';

function ResetPasswordForm() {
  const token = useSearchParams().get('token') ?? '';
  const router = useRouter();
  const { startSession } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!token) {
    return (
      <AuthCard title="This link is incomplete" subtitle="Open the reset link from your email, or request a new one.">
        <ButtonLink href="/authentication" size="lg" className="w-full">
          Back to sign in
        </ButtonLink>
      </AuthCard>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError('The passwords do not match.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      startSession(await authApi.resetPassword({ token, password }));
      toast.success('Password updated. You are signed in.');
      router.replace(APP_HOME);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthCard title="Choose a new password" subtitle="Other devices will be signed out.">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="New password" htmlFor="new-password" hint="Use 8 or more characters.">
          <Input
            id="new-password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoFocus
          />
        </Field>
        <Field label="Confirm password" htmlFor="confirm-password">
          <Input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
          />
        </Field>
        <FormAlert message={error} />
        <Button type="submit" size="lg" loading={loading} className="w-full">
          Save password
        </Button>
      </form>
    </AuthCard>
  );
}

export default function ResetPasswordPage() {
  return (
    <AuthLayout>
      <Suspense fallback={null}>
        <ResetPasswordForm />
      </Suspense>
    </AuthLayout>
  );
}
