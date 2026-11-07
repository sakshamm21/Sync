import { z, email, password } from '../../lib/schemas';

export const register = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(80),
  email,
  password,
});

export const verifyEmail = z.object({
  email,
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Enter the 6-digit code'),
});

export const emailOnly = z.object({ email });

export const login = z.object({
  email,
  password: z.string().min(1, 'Password is required'),
});

export const resetPassword = z.object({
  token: z.string().trim().min(1, 'Reset token is required'),
  password,
});
