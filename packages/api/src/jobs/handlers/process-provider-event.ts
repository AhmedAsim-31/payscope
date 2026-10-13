import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { ProviderError } from '@payscope/provider-adapters/provider-error';
import type { AdapterRegistry } from '@payscope/provider-adapters/registry';
import { eventProcessingAttemptsTable, providerEventsTable } from '../../db/schema/events';
import { findAdapter } from '../../providers/adapter-registry';
import { PermanentJobError, isRetryable, sanitizeError } from '../job-errors';
import type { JobHandler } from '../worker';

type FailureCategory = typeof eventProcessingAttemptsTable.$inferInsert.failureCategory;

const payloadSchema = z.object({ eventId: z.uuid() });

function failureCategoryOf(err: unknown): FailureCategory {
  if (err instanceof ProviderError) {
    if (err.category === 'not_found') return 'permanent';
    if (err.category === 'unavailable') return 'transient';
    return err.category;
  }
  return err instanceof PermanentJobError ? 'permanent' : 'transient';
}

export function createProcessProviderEventHandler(adapters: AdapterRegistry): JobHandler {
  return async (job, { db }) => {
    const parsed = payloadSchema.safeParse(job.payload);
    if (!parsed.success || !job.orgId) throw new PermanentJobError('invalid_job_payload');
    const orgId = job.orgId;
    const startedAt = new Date();

    const [event] = await db
      .update(providerEventsTable)
      .set({ status: 'processing', attemptCount: sql`${providerEventsTable.attemptCount} + 1` })
      .where(
        and(
          eq(providerEventsTable.id, parsed.data.eventId),
          eq(providerEventsTable.orgId, orgId),
          inArray(providerEventsTable.status, ['pending', 'processing', 'failed']),
        ),
      )
      .returning({
        provider: providerEventsTable.provider,
        payload: providerEventsTable.payload,
        attemptCount: providerEventsTable.attemptCount,
      });
    if (!event) return;

    const base = {
      orgId,
      eventId: parsed.data.eventId,
      jobId: job.id,
      attemptNumber: event.attemptCount,
      startedAt,
    };
    const eventWhere = eq(providerEventsTable.id, parsed.data.eventId);

    try {
      const adapter = findAdapter(adapters, event.provider);
      if (!adapter) throw new PermanentJobError('no_adapter_for_provider');
      const normalized = adapter.normalizeEvent(event.payload);
      const ignored = normalized.normalizedType === 'unsupported';
      await db.transaction(async (tx) => {
        await tx
          .update(providerEventsTable)
          .set({
            status: ignored ? 'ignored' : 'processed',
            normalizedType: normalized.normalizedType,
            processedAt: new Date(),
          })
          .where(eventWhere);
        await tx.insert(eventProcessingAttemptsTable).values({
          ...base,
          endedAt: new Date(),
          outcome: ignored ? 'skipped' : 'succeeded',
          failureCategory: ignored ? 'unsupported_event' : null,
        });
      });
    } catch (err) {
      const retryable = isRetryable(err);
      await db.transaction(async (tx) => {
        await tx
          .update(providerEventsTable)
          .set({ status: retryable ? 'failed' : 'needs_attention' })
          .where(eventWhere);
        await tx.insert(eventProcessingAttemptsTable).values({
          ...base,
          endedAt: new Date(),
          outcome: 'failed',
          failureCategory: failureCategoryOf(err),
          errorMessage: sanitizeError(err),
          retryable,
        });
      });
      throw err;
    }
  };
}
