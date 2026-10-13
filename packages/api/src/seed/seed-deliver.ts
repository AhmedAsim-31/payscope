import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { eventProcessingAttemptsTable, providerEventsTable } from '../db/schema/events';
import { backgroundJobsTable } from '../db/schema/jobs';
import { sanitizeError } from '../jobs/job-errors';
import { createProcessProviderEventHandler } from '../jobs/handlers/process-provider-event';
import type { Job } from '../jobs/job-queue';
import { createDefaultAdapterRegistry } from '../providers/adapter-registry';
import {
  identifyEvent,
  ingestVerifiedEvent,
  PROCESS_EVENT_JOB_KIND,
  type EventIdentity,
} from '../webhooks/ingest-event';
import type { SeedConnection } from './seed-directory';

export type DeliverMode = 'process' | 'queue' | 'fail';
export type DeliverOutcome = 'processed' | 'queued' | 'failed' | 'duplicate';
export type SeedStats = Record<DeliverOutcome, number>;

export type Deliverer = {
  stats: SeedStats;
  deliver(conn: SeedConnection, payload: object, mode?: DeliverMode): Promise<DeliverOutcome>;
  deliverBroken(
    conn: SeedConnection,
    broken: { providerEventId: string; eventType: string; occurredAt: Date },
    payload: object,
  ): Promise<DeliverOutcome>;
};

const quiet = { info: () => undefined, warn: () => undefined, error: () => undefined };
const PROCESSING_DELAY_MS = 3000;

export function createDeliverer(db: Db): Deliverer {
  const registry = createDefaultAdapterRegistry();
  const handler = createProcessProviderEventHandler(registry);
  const ctx = { db, logger: quiet, workerId: 'demo-seed' };
  const stats: SeedStats = { processed: 0, queued: 0, failed: 0, duplicate: 0 };

  async function persistAndRun(
    conn: SeedConnection,
    providerEventId: string,
    payload: object,
    identity: EventIdentity,
    mode: DeliverMode,
  ): Promise<DeliverOutcome> {
    const { duplicate } = await ingestVerifiedEvent(db, {
      orgId: conn.orgId,
      connectionId: conn.id,
      provider: conn.provider,
      providerEventId,
      payload,
      identity,
    });
    if (duplicate) {
      stats.duplicate += 1;
      return 'duplicate';
    }
    const [event] = await db
      .select({ id: providerEventsTable.id })
      .from(providerEventsTable)
      .where(
        and(
          eq(providerEventsTable.connectionId, conn.id),
          eq(providerEventsTable.providerEventId, providerEventId),
        ),
      );
    if (!event) throw new Error('ingested event not found');
    const [row] = await db
      .select()
      .from(backgroundJobsTable)
      .where(eq(backgroundJobsTable.idempotencyKey, `event:${event.id}`));
    if (!row) throw new Error('ingested event has no job');
    const job: Job = {
      id: row.id,
      orgId: row.orgId,
      kind: PROCESS_EVENT_JOB_KIND,
      payload: row.payload,
      attemptCount: 1,
      maxAttempts: row.maxAttempts,
    };
    const jobWhere = eq(backgroundJobsTable.id, job.id);
    let outcome: DeliverOutcome = 'queued';
    if (mode === 'process') {
      await handler(job, ctx);
      await db
        .update(backgroundJobsTable)
        .set({ status: 'succeeded', attemptCount: 1 })
        .where(jobWhere);
      outcome = 'processed';
    } else if (mode === 'fail') {
      const error = await handler(job, ctx).then(
        () => undefined,
        (err: unknown) => err ?? new Error('unknown_error'),
      );
      if (error === undefined) throw new Error('forced failure unexpectedly succeeded');
      await db
        .update(backgroundJobsTable)
        .set({ status: 'dead', attemptCount: 1, lastError: sanitizeError(error) })
        .where(jobWhere);
      outcome = 'failed';
    }
    await backdate(event.id, job.id, identity.occurredAt);
    stats[outcome] += 1;
    return outcome;
  }

  async function backdate(eventId: string, jobId: string, occurredAt: Date): Promise<void> {
    const received = new Date(occurredAt.getTime() + 1000);
    const handled = new Date(occurredAt.getTime() + PROCESSING_DELAY_MS);
    await db
      .update(providerEventsTable)
      .set({
        receivedAt: received,
        processedAt: sql`CASE WHEN ${providerEventsTable.processedAt} IS NULL THEN NULL ELSE ${handled.toISOString()}::timestamptz END`,
      })
      .where(eq(providerEventsTable.id, eventId));
    await db
      .update(eventProcessingAttemptsTable)
      .set({ startedAt: received, endedAt: handled })
      .where(eq(eventProcessingAttemptsTable.eventId, eventId));
    await db
      .update(backgroundJobsTable)
      .set({ createdAt: received, updatedAt: handled })
      .where(eq(backgroundJobsTable.id, jobId));
  }

  return {
    stats,
    async deliver(conn, payload, mode = 'process') {
      const adapter = registry.get(conn.provider);
      const identity = identifyEvent(adapter, payload, null, new Date());
      const { providerEventId } = adapter.normalizeEvent(payload);
      return persistAndRun(conn, providerEventId, payload, identity, mode);
    },
    deliverBroken(conn, broken, payload) {
      const identity: EventIdentity = {
        eventType: broken.eventType,
        normalizedType: null,
        occurredAt: broken.occurredAt,
        objectRef: null,
      };
      return persistAndRun(conn, broken.providerEventId, payload, identity, 'fail');
    },
  };
}
