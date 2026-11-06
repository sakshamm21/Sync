// Explore's date chips (B15) work on the campus calendar.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rangeFor } from './dateRanges.ts';

// Friday 6 Nov 2026, 11 pm in India (5:30 pm UTC).
const now = new Date('2026-11-06T17:30:00Z');

test('today and tomorrow are campus days', () => {
  assert.deepEqual(rangeFor('today', now), { from: '2026-11-05T18:30:00.000Z', to: '2026-11-06T18:30:00.000Z' });
  assert.deepEqual(rangeFor('tomorrow', now), { from: '2026-11-06T18:30:00.000Z', to: '2026-11-07T18:30:00.000Z' });
});

test('this weekend is Saturday and Sunday', () => {
  assert.deepEqual(rangeFor('weekend', now), { from: '2026-11-06T18:30:00.000Z', to: '2026-11-08T18:30:00.000Z' });
  // On a Sunday it is just today.
  assert.deepEqual(rangeFor('weekend', new Date('2026-11-08T06:00:00Z')), { from: '2026-11-07T18:30:00.000Z', to: '2026-11-08T18:30:00.000Z' });
});

test('a picked day and the next 7 days', () => {
  assert.deepEqual(rangeFor('2026-12-25', now), { from: '2026-12-24T18:30:00.000Z', to: '2026-12-25T18:30:00.000Z' });
  assert.equal(rangeFor('week', now).to, '2026-11-12T18:30:00.000Z');
});
