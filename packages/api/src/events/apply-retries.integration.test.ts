import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { ProviderAdapter } from '@payscope/provider-adapters/adapter';
import { ProviderError } from '@payscope/provider-adapters/provider-error';
import { createAdapterRegistry } from '@payscope/provider-adapters/registry';
import { stripeAdapter } from '@payscope/provider-adapters/stripe/stripe-adapter';
import { createDb } from '../db/client';
import { createProcessProviderEventHandler } from '../jobs/handlers/process-provider-event';
import { createWorker } from '../jobs/worker';
import {
  attemptRows,
  eventRow,
  payments,
  seedConnection,
  silent,
  storeEvent,
  stripe,
} from '../test/event-harness';
import { makeAvailable, parkQueuedJobs } from '../test/job-fixtures';
import { TEST_DATABASE_URL } from '../test/test-database-url';

const { db, sql } = createDb(TEST_DATABASE_URL, { max: 10 });

afterAll(() => sql.end({ timeout: 1 }));

describe('retries', () => {
  beforeEach(() => parkQueuedJobs(sql));

  it('fails transiently, retries through the worker and records two attempts', async () => {
    const seed = await seedConnection(sql, 'stripe');
    let calls = 0;
    const flaky: ProviderAdapter = {
      ...stripeAdapter,
      normalizeEvent: (payload) => {
        calls += 1;
        if (calls === 2) throw new ProviderError('transient', 'provider hiccup');
        return stripeAdapter.normalizeEvent(payload);
      },
    };
    const stored = await storeEvent(
      sql,
      seed,
      flaky,
      stripe('payment-intent-succeeded', 1760000001),
    );
    const worker = createWorker({
      db,
      handlers: {
        process_provider_event: createProcessProviderEventHandler(createAdapterRegistry([flaky])),
      },
      logger: silent,
      random: () => 0.999,
    });
    await worker.drainOnce();
    expect((await eventRow(sql, stored.eventId))?.status).toBe('failed');
    expect(await payments(sql, seed)).toHaveLength(0);
    await makeAvailable(sql, stored.jobId);
    await worker.drainOnce();
    expect((await eventRow(sql, stored.eventId))?.status).toBe('processed');
    expect(await attemptRows(sql, stored.eventId)).toMatchObject([
      { attempt_number: 1, outcome: 'failed', failure_category: 'transient' },
      { attempt_number: 2, outcome: 'succeeded' },
    ]);
    expect((await payments(sql, seed))[0]?.status).toBe('succeeded');
  });

  it('moves the event to needs_attention when the last attempt fails', async () => {
    const seed = await seedConnection(sql, 'stripe');
    const broken: ProviderAdapter = {
      ...stripeAdapter,
      normalizeEvent: () => {
        throw new ProviderError('transient', 'down');
      },
    };
    const stored = await storeEvent(
      sql,
      seed,
      stripeAdapter,
      stripe('payment-intent-succeeded', 1760000001),
    );
    await sql`update background_jobs set max_attempts = 1 where id = ${stored.jobId}`;
    const worker = createWorker({
      db,
      handlers: {
        process_provider_event: createProcessProviderEventHandler(createAdapterRegistry([broken])),
      },
      logger: silent,
    });
    await worker.drainOnce();
    expect((await eventRow(sql, stored.eventId))?.status).toBe('needs_attention');
    const [job] = await sql<
      { status: string }[]
    >`select status from background_jobs where id = ${stored.jobId}`;
    expect(job?.status).toBe('dead');
  });
});
