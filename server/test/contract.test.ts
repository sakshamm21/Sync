// The web app keeps its own copy of the API's types (client/src/lib/api/types.ts).
// This contract test fails CI the moment a list of values drifts apart, so a
// rename on the server can't quietly break the web app at runtime (plan E3).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as c from '../src/constants';

const clientTypes = fs.readFileSync(path.resolve(__dirname, '../../client/src/lib/api/types.ts'), 'utf8');

/** The string literals of `export type Name = 'a' | 'b' ...` in the client types file. */
function clientUnion(name: string): string[] {
  const match = clientTypes.match(new RegExp(`export type ${name} =([^;]+);`));
  assert.ok(match, `client type ${name} not found`);
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
}

const values = (o: Record<string, string> | readonly string[]) => [...Object.values(o)].sort();

const pairs: [string, Record<string, string> | readonly string[]][] = [
  ['Role', c.ROLES],
  ['UserStatus', c.USER_STATUS],
  ['CategoryValue', c.CATEGORY_VALUES],
  ['EventVisibility', c.EVENT_VISIBILITY],
  ['EventStatus', c.EVENT_STATUS],
  ['RegistrationStatus', c.REGISTRATION_STATUS],
  ['StaffRole', c.STAFF_ROLES],
  ['NoteTag', c.NOTE_TAGS],
  ['ApplicationStatus', c.ORGANIZER_APPLICATION_STATUS],
  ['NotificationType', c.NOTIFICATION_TYPES],
  ['ReportReason', c.REPORT_REASONS],
  ['ReportStatus', c.REPORT_STATUS],
];

describe('API contract with the web app', () => {
  for (const [name, server] of pairs) {
    it(`${name} matches the server's values`, () => {
      assert.deepEqual(clientUnion(name), values(server));
    });
  }
});
