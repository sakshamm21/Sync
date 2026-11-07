import assert from 'node:assert/strict';
import { test } from 'node:test';
import { googleCalendarUrl } from './calendarLinks.ts';

test('builds a Google Calendar link with UTC times and the event page', () => {
  const url = new URL(
    googleCalendarUrl(
      {
        id: 'abc',
        title: 'Rust & Pizza',
        description: 'Bring a laptop',
        startsAt: '2026-11-08T11:30:00.000Z',
        endsAt: '2026-11-08T13:00:00.000Z',
        venue: { name: 'LHC 101', address: '' } as never,
        onlineUrl: '',
      },
      'https://sync.example'
    )
  );
  assert.equal(url.hostname, 'calendar.google.com');
  assert.equal(url.searchParams.get('text'), 'Rust & Pizza');
  assert.equal(url.searchParams.get('dates'), '20261108T113000Z/20261108T130000Z');
  assert.equal(url.searchParams.get('location'), 'LHC 101');
  assert.match(url.searchParams.get('details')!, /https:\/\/sync\.example\/events\/abc$/);
});
