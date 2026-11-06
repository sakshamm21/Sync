/**
 * On a public demo (DEMO_MODE) everyone signs in to the same seeded accounts,
 * so nobody may change what would lock the next visitor out: a password, or an
 * account's role or status. Everything else resets with the nightly job.
 */
import env from '../config/env';
import { forbidden } from '../lib/errors';
import { users } from './data';

const DEMO_EMAILS = new Set(users.map((u) => u.email.toLowerCase()));

/** True for a seeded demo account while DEMO_MODE is on. */
export function isDemoAccount(email: string | undefined | null): boolean {
  return env.demoMode && Boolean(email) && DEMO_EMAILS.has(String(email).toLowerCase());
}

/** Refuses changes that would affect everyone sharing a demo account. */
export function assertNotDemoAccount(email: string | undefined | null): void {
  if (isDemoAccount(email)) {
    throw forbidden(
      "Demo accounts are shared, so this can't be changed. Create your own account to try it.",
      'DEMO_ACCOUNT'
    );
  }
}
