// Times must read the same whatever zone the server or browser runs in (B13).
// Run with TZ set to anything: `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as f from './format.ts';
test('campus zone', () => {
  const iso = '2026-11-08T04:30:00.000Z';
  assert.equal(f.formatEventWhen({ startsAt: iso, endsAt: '2026-11-08T10:30:00.000Z' }), 'Sun, 8 Nov · 10:00 am – 4:00 pm');
  assert.equal(f.formatCampusDateTime(iso), 'Sunday, 8 November at 10:00 am IST');
  assert.deepEqual(f.campusDateParts(iso), { weekday: 'Sun', day: '8', month: 'Nov' });
  assert.equal(f.toDateTimeInput(new Date(iso)), '2026-11-08T10:00');
  assert.equal(f.fromDateTimeInput('2026-11-08T10:00').toISOString(), iso);
  // a late-evening event stays on one campus day though it crosses UTC midnight
  assert.match(f.formatEventWhen({ startsAt: '2026-11-07T19:00:00Z', endsAt: '2026-11-08T02:00:00Z' }), /^Sun, 8 Nov · /);
});
