import { sql } from 'drizzle-orm';
import type { FastifyRateLimitStore, FastifyRateLimitStoreCtor } from '@fastify/rate-limit';
import { z } from 'zod';
import type { Db } from '../db/client';

export type StoreLogger = { warn: (obj: object, msg: string) => void };

type StoreDeps = { db: Db; logger: StoreLogger; cleanupIntervalMs?: number };

const CLEANUP_BATCH = 1000;
const DEFAULT_CLEANUP_INTERVAL_MS = 60_000;

const hitRow = z.object({ count: z.number(), ttl_ms: z.number() });

export async function hitBucket(db: Db, key: string, windowMs: number) {
  const rows = await db.execute(sql`
    INSERT INTO rate_limit_buckets AS b (key, count, reset_at)
    VALUES (${key}, 1, now() + make_interval(secs => ${windowMs / 1000}::float8))
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN b.reset_at <= now() THEN 1 ELSE b.count + 1 END,
      reset_at = CASE
        WHEN b.reset_at <= now() THEN now() + make_interval(secs => ${windowMs / 1000}::float8)
        ELSE b.reset_at
      END
    RETURNING count, (extract(epoch FROM (reset_at - now())) * 1000)::float8 AS ttl_ms
  `);
  const row = hitRow.parse(rows[0]);
  return { current: row.count, ttl: Math.max(0, Math.ceil(row.ttl_ms)) };
}

export async function deleteExpiredBuckets(db: Db): Promise<void> {
  await db.execute(sql`
    DELETE FROM rate_limit_buckets
    WHERE ctid IN (
      SELECT ctid FROM rate_limit_buckets
      WHERE reset_at < now() - interval '1 hour'
      LIMIT ${CLEANUP_BATCH}
    )
  `);
}

export function pgRateLimitStore({
  db,
  logger,
  cleanupIntervalMs = DEFAULT_CLEANUP_INTERVAL_MS,
}: StoreDeps): FastifyRateLimitStoreCtor {
  let lastCleanup = 0;

  const maybeCleanup = () => {
    const now = Date.now();
    if (now - lastCleanup < cleanupIntervalMs) return;
    lastCleanup = now;
    deleteExpiredBuckets(db).catch((err: unknown) => {
      logger.warn({ err }, 'rate_limit_cleanup_failed');
    });
  };

  return class PgRateLimitStore implements FastifyRateLimitStore {
    incr(
      key: string,
      callback: (error: Error | null, result?: { current: number; ttl: number }) => void,
      timeWindow: number,
    ) {
      hitBucket(db, key, timeWindow).then(
        (result) => {
          maybeCleanup();
          callback(null, result);
        },
        (err: unknown) => {
          logger.warn({ err, key }, 'rate_limit_store_failed_open');
          callback(null, { current: 0, ttl: timeWindow });
        },
      );
    }

    child() {
      return this;
    }
  };
}
