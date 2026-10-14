import { and, asc, count, desc, eq, gte, lt, min, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { eventQuerySchema } from '@payscope/shared/events-schemas';
import type { Db } from '../db/client';
import { eventProcessingAttemptsTable, providerEventsTable as e } from '../db/schema/events';
import { backgroundJobsTable } from '../db/schema/jobs';
import { providerCustomerMappingsTable as m } from '../db/schema/providers';
import { paymentRecordsTable as p, subscriptionRecordsTable as s } from '../db/schema/records';
import { cursorTsColumn, iso, isoOrNull, keysetAfter, toPage } from '../records/keyset';
import { redactPayload } from './event-redaction';

type EventQuery = z.output<typeof eventQuerySchema>;

function refersToCustomer(orgId: string, customerId: string) {
  return sql`(${e.connectionId}, ${e.objectRef}) in (
    select ${p.connectionId}, ${p.providerPaymentId} from ${p}
      where ${p.orgId} = ${orgId} and ${p.customerId} = ${customerId}
    union all
    select ${s.connectionId}, ${s.providerSubscriptionId} from ${s}
      where ${s.orgId} = ${orgId} and ${s.customerId} = ${customerId}
    union all
    select ${m.connectionId}, ${m.providerCustomerId} from ${m}
      where ${m.orgId} = ${orgId} and ${m.customerId} = ${customerId}
  )`;
}

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
    q.objectRef === undefined ? undefined : eq(e.objectRef, q.objectRef),
    q.customerId === undefined ? undefined : refersToCustomer(orgId, q.customerId),
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
      retried: sql<number>`count(*) filter (where ${backgroundJobsTable.attemptCount} > 0)`.mapWith(
        Number,
      ),
      oldestAvailableAt: min(backgroundJobsTable.availableAt),
    })
    .from(backgroundJobsTable)
    .where(eq(backgroundJobsTable.orgId, orgId))
    .groupBy(backgroundJobsTable.status);
  const counts = { queued: 0, running: 0, succeeded: 0, failed: 0, dead: 0 };
  for (const row of rows) counts[row.status] = row.total;
  const queued = rows.find((row) => row.status === 'queued');
  const oldest = queued?.oldestAvailableAt;
  const oldestQueuedAgeSeconds = oldest
    ? Math.max(0, Math.floor((Date.now() - oldest.getTime()) / 1000))
    : null;
  return { counts, retrying: queued?.retried ?? 0, oldestQueuedAgeSeconds };
}
