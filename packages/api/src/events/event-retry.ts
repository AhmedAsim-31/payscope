import { and, eq, inArray, sql } from 'drizzle-orm';
import { RETRYABLE_EVENT_STATUSES } from '@payscope/shared/events-schemas';
import { providerEventsTable } from '../db/schema/events';
import { backgroundJobsTable } from '../db/schema/jobs';
import { ApiHttpError } from '../http-error';
import type { Tx } from './apply-types';

const RETRY_EXTRA_ATTEMPTS = 3;

const notRetryable = () =>
  new ApiHttpError(409, 'NOT_RETRYABLE', 'Only failed events with a stopped job can be retried');

export async function retryEvent(tx: Tx, orgId: string, eventId: string): Promise<void> {
  const [requeued] = await tx
    .update(backgroundJobsTable)
    .set({
      status: 'queued',
      availableAt: sql`now()`,
      updatedAt: sql`now()`,
      maxAttempts: sql`GREATEST(${backgroundJobsTable.maxAttempts}, ${backgroundJobsTable.attemptCount} + ${RETRY_EXTRA_ATTEMPTS})`,
    })
    .where(
      and(
        eq(backgroundJobsTable.orgId, orgId),
        eq(backgroundJobsTable.idempotencyKey, `event:${eventId}`),
        inArray(backgroundJobsTable.status, ['dead', 'failed']),
      ),
    )
    .returning({ id: backgroundJobsTable.id });
  if (!requeued) throw notRetryable();

  const [reset] = await tx
    .update(providerEventsTable)
    .set({ status: 'pending' })
    .where(
      and(
        eq(providerEventsTable.orgId, orgId),
        eq(providerEventsTable.id, eventId),
        inArray(providerEventsTable.status, [...RETRYABLE_EVENT_STATUSES]),
      ),
    )
    .returning({ id: providerEventsTable.id });
  if (!reset) throw notRetryable();
}
