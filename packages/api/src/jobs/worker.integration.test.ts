import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProviderError } from '@payscope/provider-adapters/provider-error';
import { createDb } from '../db/client';
import { expireLease, insertJobs, jobRow, parkQueuedJobs, uniqueKind } from '../test/job-fixtures';
import { TEST_DATABASE_URL } from '../test/test-database-url';
import { recoverExpiredLeases } from './job-queue';
import { PermanentJobError } from './job-errors';
import { createWorker, type JobHandler } from './worker';

const { db, sql } = createDb(TEST_DATABASE_URL, { max: 10 });
const silent = { info: () => undefined, warn: () => undefined, error: () => undefined };

beforeAll(() => parkQueuedJobs(sql));
afterAll(() => sql.end({ timeout: 1 }));

function workerFor(kind: string, handler: JobHandler, extra: object = {}) {
  return createWorker({
    db,
    handlers: { [kind]: handler },
    logger: silent,
    random: () => 0.999,
    ...extra,
  });
}

async function runOne(handler: JobHandler, maxAttempts = 5) {
  const kind = uniqueKind();
  const [id] = await insertJobs(sql, kind, 1, maxAttempts);
  if (!id) throw new Error('no job');
  await workerFor(kind, handler).drainOnce();
  return jobRow(sql, id);
}

describe('failure classification', () => {
  it('re-queues a retryable ProviderError with a future available_at', async () => {
    const row = await runOne(() => Promise.reject(new ProviderError('transient', 'rate limited')));
    expect(row).toMatchObject({ status: 'queued', attempt_count: 1, locked_by: null });
    expect(row.available_at.getTime()).toBeGreaterThan(Date.now());
    expect(row.last_error).toContain('rate limited');
  });

  it('re-queues unknown errors', async () => {
    const row = await runOne(() => Promise.reject(new Error('socket hang up')));
    expect(row.status).toBe('queued');
  });

  it('dead-letters a non-retryable ProviderError immediately', async () => {
    const row = await runOne(() =>
      Promise.reject(new ProviderError('invalid_input', 'bad payload')),
    );
    expect(row).toMatchObject({ status: 'dead', attempt_count: 1 });
  });

  it('dead-letters a PermanentJobError immediately', async () => {
    const row = await runOne(() => Promise.reject(new PermanentJobError('cannot ever work')));
    expect(row).toMatchObject({ status: 'dead', attempt_count: 1 });
  });

  it('dead-letters a retryable failure on the last attempt', async () => {
    const row = await runOne(() => Promise.reject(new Error('still failing')), 1);
    expect(row.status).toBe('dead');
  });

  it('dead-letters an unknown job kind as unsupported_job_kind', async () => {
    const kind = uniqueKind();
    const [id] = await insertJobs(sql, kind, 1);
    if (!id) throw new Error('no job');
    await createWorker({ db, handlers: {}, logger: silent }).drainOnce();
    const row = await jobRow(sql, id);
    expect(row.status).toBe('dead');
    expect(row.last_error).toContain('unsupported_job_kind');
  });

  it('never persists a multi-line or oversized error', async () => {
    const row = await runOne(() => Promise.reject(new Error(`first\nsecond ${'y'.repeat(3000)}`)));
    expect(row.last_error).not.toContain('\n');
    expect(row.last_error?.length).toBeLessThanOrEqual(1000);
  });
});

describe('leases', () => {
  it('heartbeats a slow job so recovery never re-queues it', async () => {
    let calls = 0;
    const kind = uniqueKind();
    const [id] = await insertJobs(sql, kind, 1);
    if (!id) throw new Error('no job');
    const worker = workerFor(
      kind,
      async () => {
        calls += 1;
        await new Promise((r) => setTimeout(r, 2200));
      },
      { leaseSeconds: 1 },
    );
    const running = worker.drainOnce();
    const sweep = setInterval(() => {
      recoverExpiredLeases(db).catch(() => undefined);
    }, 200);
    await running;
    clearInterval(sweep);
    expect(calls).toBe(1);
    expect((await jobRow(sql, id)).status).toBe('succeeded');
  }, 15_000);

  it('logs and swallows a lost lease instead of throwing', async () => {
    const kind = uniqueKind();
    const [id] = await insertJobs(sql, kind, 1);
    if (!id) throw new Error('no job');
    const worker = workerFor(kind, async () => {
      await expireLease(sql, id);
      await recoverExpiredLeases(db);
    });
    await expect(worker.drainOnce()).resolves.toMatchObject({ claimed: 1 });
    expect(await jobRow(sql, id)).toMatchObject({ status: 'queued', locked_by: null });
  });
});

describe('start and stop', () => {
  it('recovers expired leases on start and processes the job', async () => {
    const kind = uniqueKind();
    const [id] = await insertJobs(sql, kind, 1);
    if (!id) throw new Error('no job');
    await sql`update background_jobs set status = 'running', locked_by = 'dead-worker',
      attempt_count = 1, lease_expires_at = now() - interval '1 minute' where id = ${id}`;
    const worker = workerFor(kind, () => Promise.resolve(), { pollIntervalMs: 20 });
    worker.start();
    await expect
      .poll(async () => (await jobRow(sql, id)).status, { timeout: 5000 })
      .toBe('succeeded');
    await worker.stop();
  });

  it('waits for in-flight jobs when stopping', async () => {
    const kind = uniqueKind();
    const [id] = await insertJobs(sql, kind, 1);
    if (!id) throw new Error('no job');
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started = false;
    const worker = workerFor(
      kind,
      async () => {
        started = true;
        await gate;
      },
      { pollIntervalMs: 20 },
    );
    worker.start();
    await expect.poll(() => started, { timeout: 5000 }).toBe(true);
    let stopped = false;
    const stopping = worker.stop().then(() => {
      stopped = true;
    });
    await new Promise((r) => setTimeout(r, 150));
    expect(stopped).toBe(false);
    release();
    await stopping;
    expect((await jobRow(sql, id)).status).toBe('succeeded');
  });
});
