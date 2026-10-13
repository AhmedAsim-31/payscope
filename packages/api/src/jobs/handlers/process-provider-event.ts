import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { ProviderError } from '@payscope/provider-adapters/provider-error';
import type { AdapterRegistry } from '@payscope/provider-adapters/registry';
import { applyEvent, type ApplyResult } from '../../events/apply-event';
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

function attemptFields(result: Exclude<ApplyResult, { kind: 'already_handled' }>) {
  switch (result.kind) {
    case 'unsupported':
      return { outcome: 'skipped', failureCategory: 'unsupported_event' } as const;
    case 'stale':
      return { outcome: 'skipped', errorMessage: 'stale_event' } as const;
    case 'noted':
      return { outcome: 'succeeded', errorMessage: result.note } as const;
    default:
      return { outcome: 'succeeded' } as const;
  }
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
        connectionId: providerEventsTable.connectionId,
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
    const stored = { id: parsed.data.eventId, orgId, connectionId: event.connectionId };

    try {
      const adapter = findAdapter(adapters, event.provider);
      if (!adapter) throw new PermanentJobError('no_adapter_for_provider');
      const normalized = adapter.normalizeEvent(event.payload);
      await db.transaction(async (tx) => {
        const result = await applyEvent(tx, stored, normalized);
        if (result.kind === 'already_handled') return;
        await tx.insert(eventProcessingAttemptsTable).values({
          ...base,
          endedAt: new Date(),
          ...attemptFields(result),
        });
      });
    } catch (err) {
      const retryable = isRetryable(err);
      const willRetry = retryable && job.attemptCount < job.maxAttempts;
      await db.transaction(async (tx) => {
        await tx
          .update(providerEventsTable)
          .set({ status: willRetry ? 'failed' : 'needs_attention' })
          .where(
            and(
              eventWhere,
              inArray(providerEventsTable.status, ['pending', 'processing', 'failed']),
            ),
          );
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
