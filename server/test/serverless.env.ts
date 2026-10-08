// Settings for serverless.test.ts; imported before helpers so the app sees them.
process.env.CRON_SECRET = 'test-cron-secret';
process.env.CLIENT_URL = 'http://localhost:3000,https://sync-*-sak.vercel.app';
process.env.REALTIME = 'polling';

export {};
