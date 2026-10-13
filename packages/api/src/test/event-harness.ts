import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { paddleAdapter } from '@payscope/provider-adapters/paddle/paddle-adapter';
import { paypalAdapter } from '@payscope/provider-adapters/paypal/paypal-adapter';
import { createAdapterRegistry } from '@payscope/provider-adapters/registry';
import { revenueCatAdapter } from '@payscope/provider-adapters/revenuecat/revenuecat-adapter';
import { loadRevenueCatFixture } from '@payscope/provider-adapters/revenuecat/revenuecat-fixtures';
import { stripeAdapter } from '@payscope/provider-adapters/stripe/stripe-adapter';
import { loadStripeFixture } from '@payscope/provider-adapters/stripe/stripe-fixtures';
import type { ProviderAdapter } from '@payscope/provider-adapters/adapter';
import type { ProviderName } from '@payscope/provider-adapters/provider-name';
import type { Job } from '../jobs/job-queue';
import { PROCESS_EVENT_JOB_KIND } from '../webhooks/ingest-event';
import { paddleEvent } from './webhook-fixtures';

export type Seed = { orgId: string; connectionId: string; provider: ProviderName };

export async function seedConnection(sql: postgres.Sql, provider: ProviderName): Promise<Seed> {
  const [org] = await sql<{ id: string }[]>`
    insert into organizations (name, slug) values ('Events', ${`org-${randomUUID()}`})
    returning id`;
  const [conn] = await sql<{ id: string }[]>`
    insert into provider_connections (org_id, provider, mode, status, display_name, external_account_id)
    values (${org?.id ?? ''}, ${provider}, 'sandbox', 'active', ${provider}, ${`acct_${randomUUID()}`})
    returning id`;
  return { orgId: org?.id ?? '', connectionId: conn?.id ?? '', provider };
}

export type Stored = { eventId: string; jobId: string; job: Job };

export async function storeEvent(
  sql: postgres.Sql,
  seed: Seed,
  adapter: ProviderAdapter,
  payload: Record<string, unknown>,
): Promise<Stored> {
  const normalized = adapter.normalizeEvent(payload);
  const [event] = await sql<{ id: string }[]>`
    insert into provider_events
      (org_id, connection_id, provider, provider_event_id, event_type, normalized_type,
       occurred_at, signature_verified, payload, object_ref)
    values (${seed.orgId}, ${seed.connectionId}, ${seed.provider}, ${normalized.providerEventId},
      ${normalized.eventType}, ${normalized.normalizedType}, ${normalized.occurredAt.toISOString()}::timestamptz, true,
      ${JSON.stringify(payload)}::jsonb, ${normalized.objectId})
    returning id`;
  const eventId = event?.id ?? '';
  const [job] = await sql<{ id: string }[]>`
    insert into background_jobs (org_id, kind, payload, idempotency_key)
    values (${seed.orgId}, ${PROCESS_EVENT_JOB_KIND}, ${JSON.stringify({ eventId })}::jsonb, ${`event:${eventId}`})
    returning id`;
  const jobId = job?.id ?? '';
  return {
    eventId,
    jobId,
    job: {
      id: jobId,
      orgId: seed.orgId,
      kind: PROCESS_EVENT_JOB_KIND,
      payload: { eventId },
      attemptCount: 1,
      maxAttempts: 5,
    },
  };
}

export async function eventRow(sql: postgres.Sql, eventId: string) {
  const [row] = await sql<{ status: string; attempt_count: number }[]>`
    select status, attempt_count from provider_events where id = ${eventId}`;
  return row;
}

export function attemptRows(sql: postgres.Sql, eventId: string) {
  return sql<
    {
      attempt_number: number;
      outcome: string | null;
      failure_category: string | null;
      error_message: string | null;
    }[]
  >`select attempt_number, outcome, failure_category, error_message
    from event_processing_attempts where event_id = ${eventId} order by attempt_number`;
}

export const silent = { info: () => undefined, warn: () => undefined, error: () => undefined };
export const registry = createAdapterRegistry([
  stripeAdapter,
  paddleAdapter,
  revenueCatAdapter,
  paypalAdapter,
]);
export type Obj = Record<string, unknown>;

export function stripe(
  fixture: string,
  created: number,
  patch: (obj: Obj) => void = () => undefined,
) {
  const payload: Obj = { ...loadStripeFixture(fixture), id: `evt_${randomUUID()}`, created };
  patch((payload['data'] as { object: Obj }).object);
  return payload;
}

export function revenueCat(fixture: string, timestampMs: number) {
  const payload = loadRevenueCatFixture(fixture) as { event: Obj };
  return {
    ...payload,
    event: { ...payload.event, id: randomUUID(), event_timestamp_ms: timestampMs },
  };
}

export function paddle(
  fixture: string,
  occurredAt?: string,
  patch: (data: Obj) => void = () => undefined,
) {
  const payload = paddleEvent(fixture);
  if (occurredAt) payload['occurred_at'] = occurredAt;
  patch(payload['data'] as Obj);
  return payload;
}

export function payments(sql: postgres.Sql, seed: Seed) {
  return sql<
    {
      provider_payment_id: string;
      status: string;
      amount_minor: string;
      amount_refunded_minor: string;
      version: number;
      currency: string;
      customer_id: string | null;
    }[]
  >`select provider_payment_id, status, amount_minor::text, amount_refunded_minor::text, version,
      currency, customer_id from payment_records where connection_id = ${seed.connectionId}`;
}
