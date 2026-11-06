import { request, type Page } from '@playwright/test';

export const API = 'http://localhost:4100';
/** Every seeded account uses this password (TEST_ACCOUNTS.md). */
export const PASSWORD = 'syncronify123';

export async function tokenFor(email: string): Promise<string> {
  const api = await request.newContext({ baseURL: API });
  const res = await api.post('/api/auth/login', { data: { email, password: PASSWORD } });
  if (!res.ok()) throw new Error(`Sign-in failed for ${email}: ${res.status()}`);
  const token = (await res.json()).data.token as string;
  await api.dispose();
  return token;
}

/** Signs in through the API and hands the session to the page, skipping the form. */
export async function signInAs(page: Page, email: string): Promise<string> {
  const token = await tokenFor(email);
  await page.addInitScript((t) => window.localStorage.setItem('sync.token', t), token);
  return token;
}

/** A JSON GET against the API as a signed-in user. */
export async function apiGet<T>(token: string, path: string): Promise<T> {
  const api = await request.newContext({ baseURL: API, extraHTTPHeaders: { Authorization: `Bearer ${token}` } });
  const res = await api.get(path);
  if (!res.ok()) throw new Error(`GET ${path}: ${res.status()}`);
  const body = (await res.json()).data as T;
  await api.dispose();
  return body;
}

export type Ev = {
  id: string;
  title: string;
  visibility: string;
  status: string;
  isPast: boolean;
  viewer: { registration: string | null };
};
