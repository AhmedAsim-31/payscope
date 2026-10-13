import { and, asc, count, desc, eq, gte, lt, min } from 'drizzle-orm';
import type { z } from 'zod';
import type { eventQuerySchema } from '@payscope/shared/events-schemas';
import type { Db } from '../db/client';
import { eventProcessingAttemptsTable, providerEventsTable as e } from '../db/schema/events';
import { backgroundJobsTable } from '../db/schema/jobs';
import { cursorTsColumn, iso, isoOrNull, keysetAfter, toPage } from '../records/keyset';
import { redactPayload } from './event-redaction';

type EventQuery = z.output<typeof eventQuerySchema>;

const summaryColumns = {
  id: e.id,
  provider: e.provider,
  connectionId: e.connectionId,
  providerEventId: e.providerEventId,
  eventType: e.eventType,
  normalizedType: e.normalizedType,
  status: e.status,
  attemptCount: e.attemptCount,
  occurredAt: e.occurredAt,
  receivedAt: e.receivedAt,
};

export async function listEvents(db: Db, orgId: string, q: EventQuery) {
  const where = and(
    eq(e.orgId, orgId),
    q.status === undefined ? undefined : eq(e.status, q.status),
    q.provider === undefined ? undefined : eq(e.provider, q.provider),
    q.connectionId === undefined ? undefined : eq(e.connectionId, q.connectionId),
    q.normalizedType === undefined ? undefined : eq(e.normalizedType, q.normalizedType),
    q.from === undefined ? undefined : gte(e.receivedAt, new Date(q.from)),
    q.to === undefined ? undefined : lt(e.receivedAt, new Date(q.to)),
    keysetAfter(e.receivedAt, e.id, q.cursor),
  );
  const rows = await db
    .select({ ...summaryColumns, cursorTs: cursorTsColumn(e.receivedAt) })
    .from(e)
    .where(where)
    .orderBy(desc(e.receivedAt), desc(e.id))
    .limit(q.limit + 1);
  return toPage(rows, q.limit, (row) => ({
    id: row.id,
    provider: row.provider,
    connectionId: row.connectionId,
    providerEventId: row.providerEventId,
    eventType: row.eventType,
    normalizedType: row.normalizedType,
    status: row.status,
    attemptCount: row.attemptCount,
    occurredAt: iso(row.occurredAt),
    receivedAt: iso(row.receivedAt),
  }));
}

export async function getEvent(db: Db, orgId: string, eventId: string) {
  const [row] = await db
    .select({
      ...summaryColumns,
      processedAt: e.processedAt,
      signatureVerified: e.signatureVerified,
      payload: e.payload,
    })
    .from(e)
    .where(and(eq(e.orgId, orgId), eq(e.id, eventId)))
    .limit(1);
  if (!row) return undefined;

  const attempts = await db
    .select({
      id: eventProcessingAttemptsTable.id,
      attemptNumber: eventProcessingAttemptsTable.attemptNumber,
      startedAt: eventProcessingAttemptsTable.startedAt,
      endedAt: eventProcessingAttemptsTable.endedAt,
      outcome: eventProcessingAttemptsTable.outcome,
      failureCategory: eventProcessingAttemptsTable.failureCategory,
      errorMessage: eventProcessingAttemptsTable.errorMessage,
      retryable: eventProcessingAttemptsTable.retryable,
    })
    .from(eventProcessingAttemptsTable)
    .where(
      and(
        eq(eventProcessingAttemptsTable.orgId, orgId),
        eq(eventProcessingAttemptsTable.eventId, eventId),
      ),
    )
    .orderBy(asc(eventProcessingAttemptsTable.attemptNumber));

  const [job] = await db
    .select({
      status: backgroundJobsTable.status,
      attemptCount: backgroundJobsTable.attemptCount,
      maxAttempts: backgroundJobsTable.maxAttempts,
      availableAt: backgroundJobsTable.availableAt,
      lastError: backgroundJobsTable.lastError,
    })
    .from(backgroundJobsTable)
    .where(
      and(
        eq(backgroundJobsTable.orgId, orgId),
        eq(backgroundJobsTable.idempotencyKey, `event:${eventId}`),
      ),
    )
    .limit(1);

  return {
    ...row,
    occurredAt: iso(row.occurredAt),
    receivedAt: iso(row.receivedAt),
    processedAt: isoOrNull(row.processedAt),
    payload: redactPayload(row.payload),
    attempts: attempts.map((a) => ({
      ...a,
      startedAt: iso(a.startedAt),
      endedAt: isoOrNull(a.endedAt),
      durationMs: a.endedAt ? a.endedAt.getTime() - a.startedAt.getTime() : null,
    })),
    job: job ? { ...job, availableAt: iso(job.availableAt) } : null,
  };
}

export async function summarizeJobs(db: Db, orgId: string) {
  const rows = await db
    .select({
      status: backgroundJobsTable.status,
      total: count(),
      oldestAvailableAt: min(backgroundJobsTable.availableAt),
    })
    .from(backgroundJobsTable)
    .where(eq(backgroundJobsTable.orgId, orgId))
    .groupBy(backgroundJobsTable.status);
  const counts = { queued: 0, running: 0, succeeded: 0, failed: 0, dead: 0 };
  for (const row of rows) counts[row.status] = row.total;
  const oldest = rows.find((row) => row.status === 'queued')?.oldestAvailableAt;
  const oldestQueuedAgeSeconds = oldest
    ? Math.max(0, Math.floor((Date.now() - oldest.getTime()) / 1000))
    : null;
  return { counts, oldestQueuedAgeSeconds };
}
