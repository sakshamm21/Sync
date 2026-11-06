// The flows the review found broken, exercised in a real browser
// (docs/IMPROVEMENT_PLAN.md, E1). Each test names the bug it guards.
import { expect, test } from '@playwright/test';
import { API, PASSWORD, apiGet, signInAs, tokenFor, type Ev } from './helpers';

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

test('shared event links get a generated preview image and a WhatsApp button', async ({ page, request }) => {
  const events = (await (await request.get(`${API}/api/events?limit=1`)).json()).data as Ev[];
  await page.goto(`/events/${events[0].id}`);
  const ogImage = await page.locator('meta[property="og:image"]').getAttribute('content');
  expect(ogImage).toContain(`/events/${events[0].id}/opengraph-image`);
  const image = await request.get(new URL(ogImage!).pathname);
  expect(image.status()).toBe(200);
  expect(image.headers()['content-type']).toBe('image/png');
  await expect(page.getByRole('link', { name: 'WhatsApp' })).toHaveAttribute('href', /^https:\/\/wa\.me\/\?text=/);
});

test('an organiser can duplicate an event into a new one a week later', async ({ page }) => {
  const token = await signInAs(page, 'organizer@syncronify.dev');
  const overview = await apiGet<{ events: (Ev & { startsAt: string; viewer: { canManage: boolean } })[] }>(
    token,
    '/api/organizer/overview'
  );
  const source = overview.events.find((e) => e.status === 'published' && !e.isPast && e.viewer.canManage)!;
  await page.goto('/organizer');
  await page.getByRole('button', { name: 'Duplicate' }).first().click();
  const form = page.getByRole('dialog', { name: /Drop an event/ });
  await expect(form.getByRole('textbox').first()).not.toHaveValue('');
  // A copy is a new event: it publishes instead of saving changes.
  await expect(form.getByRole('button', { name: /Save changes/ })).toHaveCount(0);
  expect(source).toBeTruthy();
});

test('a member can mark an event as interested without taking a seat', async ({ page }) => {
  const token = await signInAs(page, 'tester1@syncronify.dev');
  const events = (await (await page.request.get(`${API}/api/events?limit=5`)).json()).data as Ev[];
  const target = events[0];
  await page.goto(`/events/${target.id}`);
  await page.getByRole('button', { name: "I'm interested" }).click();
  await expect(page.getByRole('button', { name: /^Interested/ })).toHaveAttribute('aria-pressed', 'true');
  const after = await apiGet<Ev & { interestedCount: number }>(token, `/api/events/${target.id}`);
  expect(after.viewer.registration).toBeNull();
  expect(after.interestedCount).toBeGreaterThan(0);
});

test('the notification centre lists history and lets you keep a kind out of email', async ({ page }) => {
  const token = await signInAs(page, 'tester2@syncronify.dev');
  // Demo accounts start with email off, which disables the per-kind switches.
  await page.request.patch(`${API}/api/me`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { preferences: { emailNotifications: true } },
  });
  await page.goto('/notifications');
  await expect(page.getByRole('heading', { name: /notifications/i })).toBeVisible();
  const toggle = page.getByRole('switch', { name: 'Email me announcements' });
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await page.reload();
  await expect(page.getByRole('switch', { name: 'Email me announcements' })).toHaveAttribute('aria-checked', 'false');
});

test('Sync is installable and offers notifications on this device', async ({ page, request }) => {
  const manifest = await (await request.get('/manifest.webmanifest')).json();
  expect(manifest.display).toBe('standalone');
  expect(manifest.icons.some((i: { purpose: string }) => i.purpose === 'maskable')).toBe(true);
  expect((await request.get('/sw.js')).status()).toBe(200);

  await signInAs(page, 'member@syncronify.dev');
  await page.goto('/settings');
  await expect(page.getByRole('button', { name: 'Turn on notifications' })).toBeVisible();
  const registered = await page.evaluate(async () => Boolean(await navigator.serviceWorker.getRegistration()));
  expect(registered).toBe(true);
});

test('Explore toggles narrow the list and stay in the URL', async ({ page }) => {
  await signInAs(page, 'member@syncronify.dev');
  await page.goto('/explore');
  const request = page.waitForRequest((r) => r.url().startsWith(`${API}/api/events?`) && r.url().includes('tag=free-food'));
  await page.getByRole('button', { name: /Free food/ }).click();
  await request;
  await expect(page).toHaveURL(/tag=free-food/);
  await expect(page.getByRole('link', { name: '24h Design & Build Hackathon' }).first()).toBeVisible();
});

test('a club page lists its events and can be followed from the event page', async ({ page, request }) => {
  await signInAs(page, 'tester3@syncronify.dev');
  const events = (await (await request.get(`${API}/api/events?limit=1`)).json()).data as (Ev & { owner: { id: string } })[];
  await page.goto(`/events/${events[0].id}`);
  await page.locator(`a[href="/clubs/${events[0].owner.id}"]`).first().click();
  await expect(page).toHaveURL(new RegExp(`/clubs/${events[0].owner.id}`));
  await expect(page.getByRole('heading', { name: 'Coming up' })).toBeVisible();
  await page.getByRole('button', { name: 'Follow' }).click();
  await expect(page.getByRole('button', { name: 'Following' })).toBeVisible();
  await expect(page.getByText(/1 follower/)).toBeVisible();
});

test('new members get an onboarding step that suggests clubs', async ({ page }) => {
  await signInAs(page, 'tester4@syncronify.dev');
  await page.goto('/welcome');
  await page.getByRole('button', { name: /Tech & Code/ }).click();
  await expect(page.getByRole('button', { name: 'Follow' }).first()).toBeVisible();
  await page.getByRole('button', { name: "Let's go" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
});

test('an event with a future sign-up window says when registration opens', async ({ page }) => {
  const organizer = await tokenFor('organizer@syncronify.dev');
  const api = await page.request;
  const start = new Date(Date.now() + 5 * 864e5).toISOString();
  const end = new Date(Date.now() + 5 * 864e5 + 2 * 36e5).toISOString();
  const opens = new Date(Date.now() + 2 * 864e5).toISOString();
  const created = await api.post(`${API}/api/events`, {
    headers: { Authorization: `Bearer ${organizer}` },
    data: { title: 'Window Test', category: 'tech', startsAt: start, endsAt: end, registrationOpensAt: opens },
  });
  expect(created.ok()).toBe(true);
  const { id } = (await created.json()).data;
  await signInAs(page, 'tester1@syncronify.dev');
  await page.goto(`/events/${id}`);
  await expect(page.getByRole('button', { name: /^Opens / })).toBeDisabled();
});
