'use client';

import React, { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { ApiError, errorMessage, type RegisterResult } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Field, FormAlert, Input } from '@/components/ui/field';
import AuthCard, { linkClass } from './AuthCard';

interface RegisterFormProps {
  onSwitchToLogin: () => void;
  onRegistered: (result: RegisterResult) => void;
}

type FieldName = 'name' | 'email' | 'password';

const FIELDS: { key: FieldName; label: string; type: string; placeholder: string; autoComplete: string; hint?: string }[] = [
  { key: 'name', label: 'Full name', type: 'text', placeholder: 'Asha Rao', autoComplete: 'name' },
  { key: 'email', label: 'Email', type: 'email', placeholder: 'you@college.edu', autoComplete: 'email' },
  {
    key: 'password',
    label: 'Password',
    type: 'password',
    placeholder: 'At least 8 characters',
    autoComplete: 'new-password',
    hint: 'Use 8 or more characters.',
  },
];

export default function RegisterForm({ onSwitchToLogin, onRegistered }: RegisterFormProps) {
  const { register } = useAuth();
  const [form, setForm] = useState<Record<FieldName, string>>({ name: '', email: '', password: '' });
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      onRegistered(await register(form));
    } catch (err) {
      if (err instanceof ApiError && err.code === 'VALIDATION_ERROR') {
        setFieldErrors({
          name: err.fieldMessage('name'),
          email: err.fieldMessage('email'),
          password: err.fieldMessage('password'),
        });
      } else {
        setError(errorMessage(err));
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthCard
      title={
        <>
          get <em>in</em>.
        </>
      }
      subtitle="Takes a minute. We’ll send a 6-digit code to check it’s really you."
      footer={
        <>
          Already have an account?{' '}
          <button type="button" onClick={onSwitchToLogin} className={linkClass}>
            Sign in
          </button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {FIELDS.map((f) => (
          <Field key={f.key} label={f.label} htmlFor={f.key} error={fieldErrors[f.key]} hint={f.hint}>
            <Input
              id={f.key}
              type={f.type}
              autoComplete={f.autoComplete}
              placeholder={f.placeholder}
              value={form[f.key]}
              aria-invalid={Boolean(fieldErrors[f.key])}
              onChange={(e) => {
                setForm((prev) => ({ ...prev, [f.key]: e.target.value }));
                setFieldErrors((prev) => ({ ...prev, [f.key]: undefined }));
              }}
              required
            />
          </Field>
        ))}
        <FormAlert message={error} />
        <Button type="submit" size="lg" loading={loading} className="w-full">
          Create my account
        </Button>
        <p className="text-center text-xs text-muted">
          Want to host events? Apply to become an organizer from Settings once you're in.
        </p>
      </form>
    </AuthCard>
  );
}
