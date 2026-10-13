import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../db/client';
import {
  expireLease,
  insertJobs,
  jobRow,
  makeAvailable,
  parkQueuedJobs,
  uniqueKind,
} from '../test/job-fixtures';
import { TEST_DATABASE_URL } from '../test/test-database-url';
import { claimJobs, completeJob, enqueueJob, failJob, recoverExpiredLeases } from './job-queue';
import { createWorker } from './worker';

const { db, sql } = createDb(TEST_DATABASE_URL, { max: 10 });
const silent = { info: () => undefined, warn: () => undefined, error: () => undefined };
const future = () => new Date(Date.now() + 60_000);

beforeAll(() => parkQueuedJobs(sql));
afterAll(() => sql.end({ timeout: 1 }));

async function claimOne(kind: string, workerId: string, leaseSeconds = 60) {
  const jobs = await claimJobs(db, { workerId, limit: 1000, leaseSeconds });
  return jobs.filter((j) => j.kind === kind);
}

describe('enqueueJob', () => {
  it('ignores a second enqueue with the same idempotency key', async () => {
    const kind = uniqueKind();
    const first = await enqueueJob(db, { kind, payload: {}, orgId: null, idempotencyKey: kind });
    const second = await enqueueJob(db, { kind, payload: {}, orgId: null, idempotencyKey: kind });
    expect(first?.id).toBeDefined();
    expect(second).toBeUndefined();
  });

  it('delays a job until availableAt', async () => {
    const kind = uniqueKind();
    await enqueueJob(db, { kind, payload: {}, orgId: null, availableAt: future() });
    expect(await claimOne(kind, 'w')).toHaveLength(0);
  });
});

describe('claimJobs', () => {
  it('hands each of 50 jobs to exactly one of 5 concurrent workers', async () => {
    const kind = uniqueKind();
    const ids = await insertJobs(sql, kind, 50);
    const calls = new Map<string, number>();
    const handlers = {
      [kind]: async (job: { id: string }) => {
        calls.set(job.id, (calls.get(job.id) ?? 0) + 1);
        await new Promise((r) => setTimeout(r, Math.random() * 20));
      },
    };
    const workers = Array.from({ length: 5 }, (_, i) =>
      createWorker({ db, handlers, logger: silent, workerId: `w${i}`, concurrency: 4 }),
    );
    await Promise.all(
      workers.map(async (w) => {
        while ((await w.drainOnce()).claimed > 0) {
          /* drain until empty */
        }
      }),
    );
    expect([...calls.keys()].sort()).toEqual([...ids].sort());
    expect([...calls.values()].every((n) => n === 1)).toBe(true);
    const [done] = await sql<{ n: number }[]>`
      select count(*)::int as n from background_jobs where kind = ${kind} and status = 'succeeded'`;
    expect(done?.n).toBe(50);
  });
});

describe('lease ownership', () => {
  it('re-queues an expired lease so another worker can complete it', async () => {
    const kind = uniqueKind();
    const [id] = await insertJobs(sql, kind, 1);
    if (!id) throw new Error('no job');
    expect(await claimOne(kind, 'a')).toHaveLength(1);
    await expireLease(sql, id);
    expect(await recoverExpiredLeases(db)).toBeGreaterThanOrEqual(1);
    expect(await jobRow(sql, id)).toMatchObject({ status: 'queued', locked_by: null });

    expect(await claimOne(kind, 'b')).toHaveLength(1);
    expect(await completeJob(db, id, 'b')).toBe(true);
    expect(await jobRow(sql, id)).toMatchObject({ status: 'succeeded', attempt_count: 2 });
  });

  it('refuses completion from a worker whose lease expired', async () => {
    const kind = uniqueKind();
    const [id] = await insertJobs(sql, kind, 1);
    if (!id) throw new Error('no job');
    await claimOne(kind, 'a');
    await expireLease(sql, id);
    await recoverExpiredLeases(db);
    expect(await completeJob(db, id, 'a')).toBe(false);
    expect(
      await failJob(db, id, 'a', { error: 'x', retryable: true, nextAvailableAt: future() }),
    ).toBe(false);
    expect(await jobRow(sql, id)).toMatchObject({ status: 'queued', attempt_count: 1 });
  });

  it('refuses completion from a worker that lost the job to another worker', async () => {
    const kind = uniqueKind();
    const [id] = await insertJobs(sql, kind, 1);
    if (!id) throw new Error('no job');
    await claimOne(kind, 'a');
    await expireLease(sql, id);
    await recoverExpiredLeases(db);
    await claimOne(kind, 'b');
    expect(await completeJob(db, id, 'a')).toBe(false);
    expect(await jobRow(sql, id)).toMatchObject({ status: 'running', locked_by: 'b' });
  });

  it('dead-letters an expired lease once attempts are exhausted', async () => {
    const kind = uniqueKind();
    const [id] = await insertJobs(sql, kind, 1, 1);
    if (!id) throw new Error('no job');
    await claimOne(kind, 'a');
    await expireLease(sql, id);
    await recoverExpiredLeases(db);
    expect(await jobRow(sql, id)).toMatchObject({ status: 'dead', last_error: 'lease_expired' });
  });
});

describe('failJob', () => {
  it('re-queues a retryable failure in the future and keeps the attempt count', async () => {
    const kind = uniqueKind();
    const [id] = await insertJobs(sql, kind, 1);
    if (!id) throw new Error('no job');
    await claimOne(kind, 'a');
    const at = future();
    expect(
      await failJob(db, id, 'a', { error: 'boom', retryable: true, nextAvailableAt: at }),
    ).toBe(true);
    const row = await jobRow(sql, id);
    expect(row).toMatchObject({ status: 'queued', attempt_count: 1, locked_by: null });
    expect(row.available_at.getTime()).toBe(at.getTime());
    expect(await claimOne(kind, 'a')).toHaveLength(0);
  });

  it('dead-letters when attempts are exhausted', async () => {
    const kind = uniqueKind();
    const [id] = await insertJobs(sql, kind, 1, 2);
    if (!id) throw new Error('no job');
    await claimOne(kind, 'a');
    await failJob(db, id, 'a', { error: 'one', retryable: true, nextAvailableAt: future() });
    await makeAvailable(sql, id);
    await claimOne(kind, 'a');
    await failJob(db, id, 'a', { error: 'two', retryable: true, nextAvailableAt: future() });
    expect(await jobRow(sql, id)).toMatchObject({ status: 'dead', attempt_count: 2 });
  });

  it('dead-letters a non-retryable failure on the first attempt', async () => {
    const kind = uniqueKind();
    const [id] = await insertJobs(sql, kind, 1);
    if (!id) throw new Error('no job');
    await claimOne(kind, 'a');
    await failJob(db, id, 'a', { error: 'nope', retryable: false, nextAvailableAt: future() });
    expect(await jobRow(sql, id)).toMatchObject({ status: 'dead', attempt_count: 1 });
  });

  it('truncates stored errors to 1000 characters', async () => {
    const kind = uniqueKind();
    const [id] = await insertJobs(sql, kind, 1);
    if (!id) throw new Error('no job');
    await claimOne(kind, 'a');
    await failJob(db, id, 'a', {
      error: 'x'.repeat(5000),
      retryable: false,
      nextAvailableAt: future(),
    });
    expect((await jobRow(sql, id)).last_error).toHaveLength(1000);
  });
});
