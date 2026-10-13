import type { ProviderAdapter } from '@payscope/provider-adapters/adapter';
import { ProviderError } from '@payscope/provider-adapters/provider-error';
import type { ProviderName } from '@payscope/provider-adapters/provider-name';
import type { Db } from '../db/client';
import { providerEventsTable } from '../db/schema/events';
import { ApiHttpError } from '../http-error';
import { backgroundJobsTable } from '../db/schema/jobs';

export const PROCESS_EVENT_JOB_KIND = 'process_provider_event';

export type EventIdentity = {
  eventType: string;
  normalizedType: string | null;
  occurredAt: Date;
  objectRef: string | null;
};

export type IngestInput = {
  orgId: string;
  connectionId: string;
  provider: ProviderName;
  providerEventId: string;
  payload: object;
  identity: EventIdentity;
};

export function identifyEvent(
  adapter: ProviderAdapter,
  payload: unknown,
  verifiedOccurredAt: Date | null,
  now: Date,
): EventIdentity {
  try {
    const event = adapter.normalizeEvent(payload);
    return {
      eventType: event.eventType,
      normalizedType: event.normalizedType,
      occurredAt: validDate(event.occurredAt) ?? verifiedOccurredAt ?? now,
      objectRef: event.objectId,
    };
  } catch (err) {
    if (err instanceof ProviderError && err.category === 'invalid_input') {
      const liveMode = /live-?mode|production/i.test(err.message);
      throw new ApiHttpError(
        422,
        liveMode ? 'WEBHOOK_LIVE_MODE_REJECTED' : 'WEBHOOK_PAYLOAD_INVALID',
        liveMode ? 'Live-mode events are not accepted' : 'Webhook payload failed validation',
      );
    }
    throw err;
  }
}

function validDate(date: Date | null): Date | null {
  return date !== null && Number.isFinite(date.getTime()) ? date : null;
}

export async function ingestVerifiedEvent(
  db: Db,
  input: IngestInput,
): Promise<{ duplicate: boolean }> {
  return db.transaction(async (tx) => {
    const [event] = await tx
      .insert(providerEventsTable)
      .values({
        orgId: input.orgId,
        connectionId: input.connectionId,
        provider: input.provider,
        providerEventId: input.providerEventId,
        eventType: input.identity.eventType,
        normalizedType: input.identity.normalizedType,
        occurredAt: input.identity.occurredAt,
        status: 'pending',
        signatureVerified: true,
        payload: input.payload,
        objectRef: input.identity.objectRef,
      })
      .onConflictDoNothing({
        target: [providerEventsTable.connectionId, providerEventsTable.providerEventId],
      })
      .returning({ id: providerEventsTable.id });
    if (!event) return { duplicate: true };
    await tx
      .insert(backgroundJobsTable)
      .values({
        orgId: input.orgId,
        kind: PROCESS_EVENT_JOB_KIND,
        payload: { eventId: event.id },
        idempotencyKey: `event:${event.id}`,
      })
      .onConflictDoNothing({ target: backgroundJobsTable.idempotencyKey });
    return { duplicate: false };
  });
}
