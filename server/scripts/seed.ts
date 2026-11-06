/**
 * Loads the demo / test dataset (src/demo/data.ts) through the real services.
 *
 *   npm run seed            # only if the database is empty
 *   npm run seed -- --reset # wipe everything first (also refreshes the dates)
 */
import { parseArgs } from 'node:util';
import mongoose from 'mongoose';
import env from '../src/config/env';
import { connectDatabase, disconnectDatabase } from '../src/config/db';
import { User } from '../src/models';
import { seed, wipeDatabase } from '../src/demo/seed';
import * as data from '../src/demo/data';

const { DEMO_PASSWORD } = data;

function printSummary() {
  const width = Math.max(...data.users.map((u) => u.email.length)) + 2;
  console.log(`\nDemo data ready. Every account uses the password "${DEMO_PASSWORD}":\n`);
  for (const u of data.users) {
    const role = u.status === 'suspended' ? 'suspended' : u.role;
    console.log(`  ${u.email.padEnd(width)}${role.padEnd(11)}${u.purpose}`);
  }
  console.log('\nSee TEST_ACCOUNTS.md for what to try with each account.\n');
}

async function main() {
  const { values } = parseArgs({ options: { reset: { type: 'boolean', default: false } } });
  // A public demo (DEMO_MODE) is the one production database that may hold demo data.
  if (env.isProduction && !env.demoMode) {
    console.error('Refusing to seed demo data in production (set DEMO_MODE=true for a public demo).');
    process.exit(1);
  }

  await connectDatabase(env.dbUri);
  await mongoose.connection.syncIndexes();

  if (values.reset) {
    await wipeDatabase();
  } else if (await User.exists({})) {
    console.log('Database already has data; skipping seed. Use `npm run seed -- --reset` to start over.');
    await disconnectDatabase();
    return;
  }

  await seed();
  printSummary();
  await disconnectDatabase();
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { seed, printSummary, DEMO_PASSWORD };
