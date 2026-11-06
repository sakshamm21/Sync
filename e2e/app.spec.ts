// The flows the review found broken, exercised in a real browser
// (docs/IMPROVEMENT_PLAN.md, E1). Each test names the bug it guards.
import { expect, test } from '@playwright/test';
import { API, PASSWORD, apiGet, signInAs, type Ev } from './helpers';

test('a demo account can sign in through the form', async ({ page }) => {
  await page.goto('/authentication');
  await page.getByLabel('Email').fill('member@syncronify.dev');
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
});

test('B9: the owner can open a private plan from its link; visitors cannot', async ({ page, browser }) => {
  const token = await signInAs(page, 'member@syncronify.dev');
  const now = Date.now();
  const mine = await apiGet<Ev[]>(
    token,
    `/api/me/calendar?from=${new Date(now - 30 * 864e5).toISOString()}&to=${new Date(now + 30 * 864e5).toISOString()}`
  );
  const plan = mine.find((e) => e.visibility === 'private')!;
  await page.goto(`/events/${plan.id}`);
  await expect(page.getByRole('heading', { name: plan.title })).toBeVisible();

  const visitor = await browser.newPage();
  await visitor.goto(`/events/${plan.id}`);
  await expect(visitor.getByText('Event not found')).toBeVisible();
  await visitor.close();
});

test('B14: tapping "You\'re in" opens a sheet and keeps the seat', async ({ page }) => {
  const token = await signInAs(page, 'member@syncronify.dev');
  const going = (await apiGet<Ev[]>(token, '/api/me/registrations?upcoming=true')).find(
    (e) => e.visibility === 'public' && e.viewer.registration === 'going'
  )!;
  await page.goto(`/events/${going.id}`);
  await page.getByRole('button', { name: "You're in" }).first().click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('img', { name: 'Entry code' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  const after = await apiGet<Ev>(token, `/api/events/${going.id}`);
  expect(after.viewer.registration).toBe('going');
});

test('B15: date chips filter Explore and live in the URL', async ({ page }) => {
  await signInAs(page, 'member@syncronify.dev');
  await page.goto('/explore');
  const request = page.waitForRequest((r) => r.url().startsWith(`${API}/api/events?`) && r.url().includes('from='));
  await page.getByRole('button', { name: 'Next 7 days' }).click();
  const url = new URL((await request).url());
  expect(new Date(url.searchParams.get('to')!).getTime() - new Date(url.searchParams.get('from')!).getTime()).toBe(7 * 864e5);
  await expect(page).toHaveURL(/when=week/);
});

test('B20: Escape in the map picker keeps the event form and what was typed', async ({ page }) => {
  await signInAs(page, 'member@syncronify.dev');
  await page.goto('/schedule');
  await page.getByRole('button', { name: 'Add event' }).click();
  const form = page.getByRole('dialog', { name: /Drop an event/ });
  await form.getByRole('textbox').first().fill('Escape test');
  await form.getByRole('button', { name: 'Map' }).click();
  await expect(page.getByRole('dialog', { name: 'Pick a venue' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Pick a venue' })).toBeHidden();
  await expect(form.getByRole('textbox').first()).toHaveValue('Escape test');
  // Closing the form itself now asks first.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Discard this event?' })).toBeVisible();
});

test('B3: door staff reach door mode, not an error', async ({ page }) => {
  const token = await signInAs(page, 'rahul@syncronify.dev');
  const overview = await apiGet<{ events: (Ev & { viewer: { staffRole: string } })[] }>(token, '/api/organizer/overview');
  const staffed = overview.events.find((e) => e.viewer.staffRole === 'checkin')!;
  await page.goto(`/organizer/events/${staffed.id}`);
  await expect(page.getByRole('button', { name: 'Scan entry codes' })).toBeVisible();
  await expect(page.getByText('Check in by name')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export CSV' })).toHaveCount(0);
});

test('waitlisted people see their place in line, and Settings offers a calendar feed', async ({ page }) => {
  const token = await signInAs(page, 'ishaan@syncronify.dev');
  const waiting = (await apiGet<Ev[]>(token, '/api/me/registrations?upcoming=true')).find(
    (e) => e.viewer.registration === 'waitlisted'
  )!;
  await page.goto(`/events/${waiting.id}`);
  await expect(page.getByText(/You're #\d+ on the waitlist/)).toBeVisible();

  await page.goto('/settings');
  const subscribe = page.getByRole('link', { name: 'Subscribe', exact: true });
  await expect(subscribe).toHaveAttribute('href', /^webcal:\/\/.+\/api\/calendar\/.+\.ics$/);
  const feed = await page.request.get((await subscribe.getAttribute('href'))!.replace(/^webcal:/, 'http:'));
  const ics = await feed.text();
  expect(ics).toContain('X-WR-CALNAME:Sync');
  // Only confirmed plans go on the calendar, not ones you're still waiting for.
  expect(ics).not.toContain(`SUMMARY:${waiting.title}`);
});
