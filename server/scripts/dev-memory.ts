/**
 * Runs the API against a local MongoDB that needs no installation.
 * Data is kept in server/.data between runs and seeded on first start.
 * With DEV_MEMORY_FRESH=1 (end-to-end tests) it uses a throwaway database
 * that is seeded every time.
 *
 *   npm run dev:memory
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoMemoryServer } from 'mongodb-memory-server';

async function main() {
  const fresh = process.env.DEV_MEMORY_FRESH === '1';
  const dbPath = path.resolve(__dirname, '../.data/mongo');
  if (!fresh) fs.mkdirSync(dbPath, { recursive: true });

  const mongo = await MongoMemoryServer.create(fresh ? {} : { instance: { dbPath, storageEngine: 'wiredTiger', port: 27018 } });
  // Must be set before anything reads the environment, so the app modules
  // below are loaded with dynamic import() only after this line.
  process.env.DB_URI = mongo.getUri('sync');

  const { default: mongoose } = await import('mongoose');
  const { connectDatabase, disconnectDatabase } = await import('../src/config/db.js');
  const { User } = await import('../src/models/index.js');
  const { seed, printSummary } = await import('./seed.js');

  await connectDatabase(process.env.DB_URI);
  await mongoose.connection.syncIndexes();
  if (!(await User.exists({}))) {
    await seed();
    printSummary();
  }
  await disconnectDatabase();

  process.on('exit', () => void mongo.stop());
  const { start } = await import('../src/server.js');
  await start();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
