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

test('organisers can preview their event as an attendee sees it', async ({ page }) => {
  const token = await signInAs(page, 'organizer@syncronify.dev');
  const overview = await apiGet<{ events: (Ev & { viewer: { canManage: boolean } })[] }>(token, '/api/organizer/overview');
  const mine = overview.events.find((e) => e.status === 'published' && !e.isPast && e.viewer.canManage)!;
  await page.goto(`/events/${mine.id}`);
  await expect(page.getByRole('link', { name: 'Manage' })).toBeVisible();
  await page.getByRole('button', { name: 'Preview as attendee' }).click();
  await expect(page.getByRole('link', { name: 'Manage' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /I'm in|Join waitlist/ }).first()).toBeVisible();
});

test('a held waitlist spot can be claimed from the event page', async ({ page }) => {
  const organizer = await tokenFor('organizer@syncronify.dev');
  const first = await tokenFor('tester1@syncronify.dev');
  const second = await tokenFor('tester2@syncronify.dev');
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const start = new Date(Date.now() + 6 * 864e5).toISOString();
  const end = new Date(Date.now() + 6 * 864e5 + 2 * 36e5).toISOString();
  const created = await page.request.post(`${API}/api/events`, {
    headers: as(organizer),
    data: { title: 'Claim Test', category: 'tech', startsAt: start, endsAt: end, capacity: 1, waitlistClaimHours: 12 },
  });
  const { id } = (await created.json()).data;
  expect((await page.request.post(`${API}/api/events/${id}/registration`, { headers: as(first) })).ok()).toBe(true);
  expect((await page.request.post(`${API}/api/events/${id}/registration`, { headers: as(second) })).ok()).toBe(true);
  expect((await page.request.delete(`${API}/api/events/${id}/registration`, { headers: as(first) })).ok()).toBe(true);

  await signInAs(page, 'tester2@syncronify.dev');
  await page.goto(`/events/${id}`);
  await expect(page.getByText(/Held for you until/)).toBeVisible();
  await page.getByRole('button', { name: 'Claim your spot' }).click();
  await expect(page.getByRole('button', { name: "You're in" }).first()).toBeVisible();
});

test('RSVP questions and approval work end to end', async ({ page, browser }) => {
  const organizer = await tokenFor('organizer@syncronify.dev');
  const start = new Date(Date.now() + 7 * 864e5).toISOString();
  const end = new Date(Date.now() + 7 * 864e5 + 2 * 36e5).toISOString();
  const created = await page.request.post(`${API}/api/events`, {
    headers: { Authorization: `Bearer ${organizer}` },
    data: {
      title: 'Selective Workshop',
      category: 'workshop',
      startsAt: start,
      endsAt: end,
      capacity: 10,
      requiresApproval: true,
      questions: [{ label: 'Roll number', kind: 'text', required: true }],
    },
  });
  const { id } = (await created.json()).data;

  await signInAs(page, 'tester3@syncronify.dev');
  await page.goto(`/events/${id}`);
  await page.getByRole('button', { name: 'Request a place' }).first().click();
  await page.getByLabel(/Roll number/).fill('21CS042');
  await page.getByRole('button', { name: 'Send request' }).click();
  await expect(page.getByRole('button', { name: 'Requested' }).first()).toBeVisible();

  const org = await browser.newPage();
  await org.addInitScript((t) => window.localStorage.setItem('sync.token', t), organizer);
  await org.goto(`/organizer/events/${id}`);
  await expect(org.getByText('Roll number: 21CS042')).toBeVisible();
  await org.getByRole('button', { name: 'Approve' }).click();
  await expect(org.getByRole('button', { name: 'Check in' }).first()).toBeVisible();
  await org.close();
});

test('a member can download their data and delete their account', async ({ page }) => {
  // Priya isn't used by any other test, so deleting her affects nothing else.
  await signInAs(page, 'priya@syncronify.dev');
  await page.goto('/settings');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download my data' }).click();
  expect((await download).suggestedFilename()).toBe('sync-my-data.json');

  await page.getByRole('button', { name: 'Delete my account' }).click();
  await page.getByLabel('Your password', { exact: true }).fill('wrong-password');
  await page.getByRole('button', { name: 'Delete for good' }).click();
  await expect(page.getByText('That password is not right')).toBeVisible();
  await page.getByLabel('Your password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Delete for good' }).click();
  await expect(page.getByText('Your account has been deleted')).toBeVisible();
});

test('admins can read the audit log', async ({ page }) => {
  const admin = await signInAs(page, 'admin@syncronify.dev');
  const headers = { Authorization: `Bearer ${admin}` };
  const users = (await (await page.request.get(`${API}/api/admin/users?q=tester4&limit=50`, { headers })).json()).data as {
    id: string;
    name: string;
    email: string;
  }[];
  const target = users.find((u) => u.email === 'tester4@syncronify.dev')!;
  await page.request.patch(`${API}/api/admin/users/${target.id}`, { headers, data: { status: 'suspended' } });
  await page.goto('/admin?tab=audit');
  await expect(page.getByText(`Suspended ${target.name}`).first()).toBeVisible();
});

test('chat messages can be removed by the sender and reported by others; organisers see insights', async ({ page, browser }) => {
  const organizer = await tokenFor('organizer@syncronify.dev');
  const member = await signInAs(page, 'member@syncronify.dev');
  const going = (await apiGet<Ev[]>(member, '/api/me/registrations?upcoming=true')).find(
    (e) => e.visibility === 'public' && e.viewer.registration === 'going'
  )!;
  await page.goto('/chat');
  await page
    .getByRole('button', { name: new RegExp(going.title) })
    .first()
    .click();
  await page.getByLabel('Message').fill('Typo, ignore me');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Typo, ignore me')).toBeVisible();
  await page.getByRole('button', { name: 'Remove' }).last().click();
  await expect(page.getByText('Message removed').last()).toBeVisible();

  const org = await browser.newPage();
  await org.addInitScript((t) => window.localStorage.setItem('sync.token', t), organizer);
  await org.goto(`/organizer/events/${going.id}`);
  await expect(org.getByRole('heading', { name: 'RSVPs over time' })).toBeVisible();
  await org.close();
});

test('attendees of a past event can leave feedback and print a certificate', async ({ page }) => {
  await signInAs(page, 'member@syncronify.dev');
  await page.goto('/history');
  await expect(page.getByRole('heading', { name: /My events/ })).toBeVisible();
  await page.getByRole('link', { name: 'Certificate' }).first().click();
  await expect(page.getByText('Certificate of participation')).toBeVisible();
  await expect(page.getByText(/^Ref\. SYNC-/)).toBeVisible();
});

test('members can RSVP to every date of a weekly series at once', async ({ page }) => {
  const organizer = await tokenFor('organizer@syncronify.dev');
  const start = new Date(Date.now() + 3 * 864e5).toISOString();
  const end = new Date(Date.now() + 3 * 864e5 + 2 * 36e5).toISOString();
  const created = await page.request.post(`${API}/api/events`, {
    headers: { Authorization: `Bearer ${organizer}` },
    data: { title: 'Weekly Coding Club', category: 'meetup', startsAt: start, endsAt: end, repeat: { every: 'week', count: 3 } },
  });
  const { id } = (await created.json()).data;
  await signInAs(page, 'tester2@syncronify.dev');
  await page.goto(`/events/${id}`);
  await expect(page.getByText('Repeats · 3 upcoming dates')).toBeVisible();
  await page.getByRole('button', { name: 'RSVP to all dates' }).click();
  await expect(page.getByText("You're down for 3 of 3 dates")).toBeVisible();
});

test('a member can change their email with a code sent to the new address', async ({ page }) => {
  // Asha isn't used by any other test, so her new address affects nothing else.
  await signInAs(page, 'asha@syncronify.dev');
  await page.goto('/settings');
  await page.getByLabel('New email').fill('asha.new@example.com');
  await page.getByLabel('Confirm with your password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Send a code' }).click();
  const hint = await page.getByText(/the code is \d{6}/).textContent();
  await page.getByLabel('Code').fill(hint!.match(/\d{6}/)![0]);
  await page.getByRole('button', { name: 'Confirm new email' }).click();
  await expect(page.getByText('You sign in with asha.new@example.com.')).toBeVisible();
});

test('the admin overview shows weekly trends', async ({ page }) => {
  await signInAs(page, 'admin@syncronify.dev');
  await page.goto('/admin');
  await expect(page.getByText('New people')).toBeVisible();
  await expect(page.getByRole('img', { name: /^RSVPs per week:/ })).toBeVisible();
});

test('friends see which events each other is going to', async ({ page }) => {
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const member = await tokenFor('member@syncronify.dev');
  await signInAs(page, 'tester1@syncronify.dev');
  await page.goto('/friends');
  await page.getByLabel('Add a friend by email').fill('member@syncronify.dev');
  await page.getByRole('button', { name: 'Send request' }).click();
  await expect(page.getByText(/Waiting on:/)).toBeVisible();

  const incoming = (await (await page.request.get(`${API}/api/friends`, { headers: as(member) })).json()).data.incoming;
  await page.request.put(`${API}/api/friends/requests/${incoming[0].id}`, { headers: as(member), data: { accept: true } });

  const going = (await apiGet<Ev[]>(member, '/api/me/registrations?upcoming=true')).find(
    (e) => e.visibility === 'public' && e.viewer.registration === 'going'
  )!;
  await page.goto(`/events/${going.id}`);
  await expect(page.getByText(/👋 .+ going/).first()).toBeVisible();
});

test('chat replies and reactions', async ({ page }) => {
  const member = await signInAs(page, 'member@syncronify.dev');
  const going = (await apiGet<Ev[]>(member, '/api/me/registrations?upcoming=true')).find(
    (e) => e.visibility === 'public' && e.viewer.registration === 'going'
  )!;
  await page.goto('/chat');
  await page
    .getByRole('button', { name: new RegExp(going.title) })
    .first()
    .click();
  await page.getByLabel('Message').fill('Who is bringing snacks?');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Who is bringing snacks?')).toBeVisible();
  await page.getByRole('button', { name: 'Reply' }).last().click();
  await expect(page.getByText(/Replying to/)).toBeVisible();
  await page.getByLabel('Message').fill('I will!');
  await page.keyboard.press('Enter');
  await expect(page.getByText(/↩ .*: Who is bringing snacks\?/)).toBeVisible();
  await page.getByRole('button', { name: 'React' }).last().click();
  await page.getByRole('button', { name: 'React 🎉' }).click();
  await expect(page.getByRole('button', { name: '🎉 1' })).toBeVisible();
});

test('team events: create a team, a teammate joins with the code, the organiser checks the team in', async ({
  page,
  browser,
}) => {
  const organizer = await tokenFor('organizer@syncronify.dev');
  const mate = await tokenFor('tester3@syncronify.dev');
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });
  const start = new Date(Date.now() + 9 * 864e5).toISOString();
  const end = new Date(Date.now() + 9 * 864e5 + 6 * 36e5).toISOString();
  const { id } = (
    await (
      await page.request.post(`${API}/api/events`, {
        headers: as(organizer),
        data: { title: 'Mini Hackathon', category: 'tech', startsAt: start, endsAt: end, teamSize: { min: 2, max: 3 } },
      })
    ).json()
  ).data;
  await page.request.post(`${API}/api/events/${id}/registration`, { headers: as(mate) });

  await signInAs(page, 'tester2@syncronify.dev');
  await page.goto(`/events/${id}`);
  await page.getByRole('button', { name: "I'm in" }).first().click();
  await page.getByLabel('Start a team').fill('Null Pointers');
  await page.getByRole('button', { name: 'Create team' }).click();
  const code = (await page.getByRole('button', { name: /Team code/ }).getAttribute('aria-label'))!.match(/[A-Z0-9]{6}/)![0];
  await expect(page.getByText('Needs 1 more.', { exact: false })).toBeVisible();

  await page.request.post(`${API}/api/events/${id}/teams/join`, { headers: as(mate), data: { code } });
  const org = await browser.newPage();
  await org.addInitScript((t) => window.localStorage.setItem('sync.token', t), organizer);
  await org.goto(`/organizer/events/${id}`);
  await org.getByRole('button', { name: 'Check in team' }).click();
  await expect(org.getByRole('button', { name: 'All checked in' })).toBeVisible();
  await org.close();
});

test('the assistant offers an RSVP button that goes through only when tapped', async ({ page }) => {
  const member = await signInAs(page, 'tester1@syncronify.dev');
  const events = (await (await page.request.get(`${API}/api/events?limit=20`)).json()).data as (Ev & {
    spotsLeft: number | null;
  })[];
  const target = events.find((e) => e.viewer.registration === null && e.spotsLeft !== 0)!;
  // No AI key in tests: stand in for the model, keep everything else real.
  await page.route(`${API}/api/meta`, async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    await route.fulfill({ json: { data: { ...body.data, assistant: true } } });
  });
  await page.route(`${API}/api/assistant/chat`, (route) =>
    route.fulfill({
      json: {
        data: {
          reply: `Tap below to join [${target.title}](/events/${target.id}).`,
          events: [],
          actions: [{ type: 'rsvp', eventId: target.id, title: target.title, when: 'Soon' }],
        },
      },
    })
  );
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Ask Sync, the AI assistant' }).click();
  await page.getByRole('textbox', { name: 'Message Sync' }).fill(`Sign me up for ${target.title}`);
  await page.keyboard.press('Enter');
  const confirm = page.getByRole('dialog', { name: 'Ask Sync' }).getByRole('button', { name: "I'm in" });
  await expect(confirm).toBeVisible();
  expect((await apiGet<Ev>(member, `/api/events/${target.id}`)).viewer.registration).toBeNull();
  await confirm.click();
  await expect(page.getByRole('dialog', { name: 'Ask Sync' }).getByRole('button', { name: "You're in" })).toBeVisible();
  expect((await apiGet<Ev>(member, `/api/events/${target.id}`)).viewer.registration).not.toBeNull();
});

test('a club adds a committee member, who can then manage its events', async ({ page, browser }) => {
  await signInAs(page, 'cultural@syncronify.dev');
  await page.goto('/organizer');
  await page.getByLabel('Committee member email').fill('tester2@syncronify.dev');
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByText('tester2@syncronify.dev')).toBeVisible();

  const helper = await tokenFor('tester2@syncronify.dev');
  const other = await browser.newPage();
  await other.addInitScript((t) => window.localStorage.setItem('sync.token', t), helper);
  await other.goto('/organizer');
  await expect(other.getByRole('link', { name: 'Attendees' }).first()).toBeVisible();
  await other.close();
});

test('reminders and pins: set "remind me 1 hour before", and an organiser pins a message', async ({ page, browser }) => {
  const member = await signInAs(page, 'member@syncronify.dev');
  const going = (await apiGet<Ev[]>(member, '/api/me/registrations?upcoming=true')).find(
    (e) => e.visibility === 'public' && e.viewer.registration === 'going'
  )!;
  await page.goto(`/events/${going.id}`);
  await page.getByRole('button', { name: "You're in" }).first().click();
  await page.getByLabel('Remind me').selectOption('60');
  await expect(page.getByText("We'll remind you")).toBeVisible();
  expect((await apiGet<{ minutesBefore: number }>(member, `/api/events/${going.id}/reminder`)).minutesBefore).toBe(60);

  const organizer = await tokenFor('organizer@syncronify.dev');
  const posted = await page.request.post(`${API}/api/events/${going.id}/messages`, {
    headers: { Authorization: `Bearer ${organizer}` },
    data: { text: 'Doors open at 5:30' },
  });
  const { id: messageId } = (await posted.json()).data;
  const org = await browser.newPage();
  await org.addInitScript((t) => window.localStorage.setItem('sync.token', t), organizer);
  await org.goto(`/organizer/events/${going.id}`);
  await org.getByRole('button', { name: 'Pin' }).last().click();
  await expect(org.getByText(/📌 .*:Doors open at 5:30/)).toBeVisible();
  await org.close();
  expect(messageId).toBeTruthy();
});

test('admins add a campus venue, which appears as a pin on the interactive map', async ({ page }) => {
  await signInAs(page, 'admin@syncronify.dev');
  await page.goto('/admin?tab=venues');
  await page.getByLabel('Name', { exact: true }).fill('Test Auditorium');
  await page.getByLabel('Latitude').fill('26.5130');
  await page.getByLabel('Longitude').fill('80.2340');
  await page.getByLabel('Capacity').fill('300');
  await page.getByRole('button', { name: 'Add venue' }).click();
  await expect(page.getByText('Test Auditorium')).toBeVisible();

  await page.goto('/map');
  await expect(page.locator('.leaflet-container')).toBeVisible();
  await expect(page.locator('path.leaflet-interactive').first()).toBeVisible();
});

test('every public event has a Stories image', async ({ page, request }) => {
  const events = (await (await request.get(`${API}/api/events?limit=1`)).json()).data as Ev[];
  await page.goto(`/events/${events[0].id}`);
  await expect(page.getByRole('link', { name: 'Story' })).toHaveAttribute('href', `/events/${events[0].id}/story`);
  const image = await request.get(`/events/${events[0].id}/story`);
  expect(image.status()).toBe(200);
  expect(image.headers()['content-type']).toBe('image/png');
});
