// The sign-in redirect only follows our own paths (B22).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { safeNextPath } from './redirect.ts';

const origin = 'https://sync.example';

test('keeps same-site paths', () => {
  assert.equal(safeNextPath('/events/abc?x=1', origin, '/dashboard'), '/events/abc?x=1');
});

test('ignores other sites, however they are spelled', () => {
  for (const next of ['//evil.com', '/\\evil.com', 'https://evil.com/x', '\\\\evil.com', 'javascript:alert(1)']) {
    assert.equal(safeNextPath(next, origin, '/dashboard'), '/dashboard', next);
  }
  assert.equal(safeNextPath(null, origin, '/dashboard'), '/dashboard');
});
