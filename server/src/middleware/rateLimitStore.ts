/**
 * A rate-limit store in MongoDB, so every API instance shares one count.
 *
 * With the default memory store each serverless instance keeps its own
 * counters, so limits are both easy to dodge (requests land on fresh
 * instances) and inconsistent. One document per client and limiter holds the
 * hit count and when the window resets; a TTL index removes stale ones.
 */
import mongoose from 'mongoose';
import type { ClientRateLimitInfo, Options, Store } from 'express-rate-limit';

const COLLECTION = 'rate_limits';
let indexReady: Promise<unknown> | null = null;

type Row = { _id: string; hits: number; resetAt: Date };

export class MongoRateLimitStore implements Store {
  private windowMs = 60_000;
  /** Keys are shared across instances, so this store is not "local". */
  localKeys = false;

  constructor(readonly prefix: string) {}

  init(options: Options) {
    this.windowMs = options.windowMs;
  }

  private get collection() {
    const db = mongoose.connection.db;
    if (!db) throw new Error('Database is not connected');
    const collection = db.collection<Row>(COLLECTION);
    indexReady ??= collection.createIndex({ resetAt: 1 }, { expireAfterSeconds: 0 }).catch(() => (indexReady = null));
    return collection;
  }

  async get(key: string): Promise<ClientRateLimitInfo | undefined> {
    const row = await this.collection.findOne({ _id: this.prefix + key });
    return row && row.resetAt > new Date() ? { totalHits: row.hits, resetTime: row.resetAt } : undefined;
  }

  async increment(key: string): Promise<ClientRateLimitInfo> {
    const now = new Date();
    const fresh = new Date(now.getTime() + this.windowMs);
    // One atomic update: start a new window if the old one is over, else count the hit.
    const row = await this.collection.findOneAndUpdate(
      { _id: this.prefix + key },
      [
        {
          $set: {
            hits: { $cond: [{ $gt: [{ $ifNull: ['$resetAt', now] }, now] }, { $add: ['$hits', 1] }, 1] },
            resetAt: { $cond: [{ $gt: [{ $ifNull: ['$resetAt', now] }, now] }, '$resetAt', fresh] },
          },
        },
      ],
      { upsert: true, returnDocument: 'after' }
    );
    return { totalHits: row?.hits ?? 1, resetTime: row?.resetAt ?? fresh };
  }

  async decrement(key: string): Promise<void> {
    await this.collection.updateOne({ _id: this.prefix + key, hits: { $gt: 0 } }, { $inc: { hits: -1 } });
  }

  async resetKey(key: string): Promise<void> {
    await this.collection.deleteOne({ _id: this.prefix + key });
  }
}
