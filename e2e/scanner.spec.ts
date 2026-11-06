// B1/B2: the door scanner reads a real ticket from a (fake) camera and sends
// exactly one check-in for it, however many frames show the code.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { chromium, expect, request, test } from '@playwright/test';
import { API, apiGet, tokenFor, type Ev } from './helpers';

// The web app's own QR encoder, so the test scans what attendees really see.
const qrcode = createRequire(path.resolve('client/package.json'))('qrcode-generator') as (
  type: number,
  level: string
) => { addData(s: string): void; make(): void; getModuleCount(): number; isDark(r: number, c: number): boolean };

/** A Y4M video (what Chrome's fake camera plays) of a still QR code on white. */
function qrVideo(text: string): string {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const [w, h, scale] = [640, 480, 8];
  const n = qr.getModuleCount();
  const left = Math.floor((w - n * scale) / 2);
  const top = Math.floor((h - n * scale) / 2);
  const y = Buffer.alloc(w * h, 235);
  for (let r = 0; r < n; r += 1)
    for (let c = 0; c < n; c += 1)
      if (qr.isDark(r, c))
        for (let dy = 0; dy < scale; dy += 1)
          y.fill(16, (top + r * scale + dy) * w + left + c * scale, (top + r * scale + dy) * w + left + (c + 1) * scale);
  const chroma = Buffer.alloc((w / 2) * (h / 2) * 2, 128);
  const frame = Buffer.concat([Buffer.from('FRAME\n'), y, chroma]);
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sync-qr-')), 'ticket.y4m');
  fs.writeFileSync(
    file,
    Buffer.concat([Buffer.from(`YUV4MPEG2 W${w} H${h} F10:1 Ip A1:1 C420jpeg\n`), ...Array(10).fill(frame)])
  );
  return file;
}

test('scans a ticket once and checks the attendee in', async () => {
  // An upcoming event the organiser runs that Kabir (member@) is going to.
  const organizer = await tokenFor('organizer@syncronify.dev');
  const member = await tokenFor('member@syncronify.dev');
  const going = await apiGet<Ev[]>(member, '/api/me/registrations?upcoming=true');
  const overview = await apiGet<{ events: Ev[] }>(organizer, '/api/organizer/overview');
  const event = overview.events.find(
    (e) => !e.isPast && e.status === 'published' && going.some((g) => g.id === e.id && g.viewer.registration === 'going')
  )!;
  const { token } = await apiGet<{ token: string }>(member, `/api/events/${event.id}/ticket`);

  const browser = await chromium.launch({
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-video-capture=${qrVideo(token)}`,
    ],
  });
  const context = await browser.newContext({ baseURL: 'http://localhost:3100', permissions: ['camera'] });
  await context.addInitScript((t) => window.localStorage.setItem('sync.token', t), organizer);
  const page = await context.newPage();
  const scans: string[] = [];
  page.on('request', (r) => r.url().startsWith(`${API}/api/events/${event.id}/scan`) && scans.push(r.url()));

  await page.goto(`/organizer/events/${event.id}`);
  await page.getByRole('button', { name: 'Scan entry codes' }).click();
  await expect(page.getByRole('status')).toContainText(/Checked in|Already checked in/);
  // The code stays in view; the scanner must not keep posting it.
  await page.waitForTimeout(2500);
  expect(scans).toHaveLength(1);
  await browser.close();
});

test('a scan with no connection is kept and checks the person in once back online', async () => {
  const organizer = await tokenFor('organizer@syncronify.dev');
  const guest = await tokenFor('tester5@syncronify.dev');
  const overview = await apiGet<{ events: (Ev & { capacity: number | null; attendeeCount: number })[] }>(
    organizer,
    '/api/organizer/overview'
  );
  const event = overview.events.find(
    (e) => !e.isPast && e.status === 'published' && (e.capacity === null || e.attendeeCount < e.capacity)
  )!;
  const api = await request.newContext({ baseURL: API, extraHTTPHeaders: { Authorization: `Bearer ${guest}` } });
  expect((await api.post(`/api/events/${event.id}/registration`)).ok()).toBe(true);
  const { token } = await apiGet<{ token: string }>(guest, `/api/events/${event.id}/ticket`);

  const browser = await chromium.launch({
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-video-capture=${qrVideo(token)}`,
    ],
  });
  const context = await browser.newContext({ baseURL: 'http://localhost:3100', permissions: ['camera'] });
  await context.addInitScript((t) => window.localStorage.setItem('sync.token', t), organizer);
  const page = await context.newPage();
  await page.goto(`/organizer/events/${event.id}`);
  await expect(page.getByRole('button', { name: 'Scan entry codes' })).toBeVisible();

  await context.setOffline(true);
  await page.getByRole('button', { name: 'Scan entry codes' }).click();
  await expect(page.getByText('Saved offline')).toBeVisible();
  await expect(page.getByText(/1 check-in waiting to sync/)).toBeVisible();

  await context.setOffline(false);
  await expect(page.getByText(/waiting to sync/)).toBeHidden({ timeout: 20_000 });
  const door = await apiGet<{ items: { user: { name: string }; checkedInAt: string | null }[] }>(
    organizer,
    `/api/events/${event.id}/door-list`
  );
  const me = await apiGet<{ name: string }>(guest, '/api/me');
  expect(door.items.find((i) => i.user.name === me.name)?.checkedInAt).toBeTruthy();
  await api.dispose();
  await browser.close();
});
