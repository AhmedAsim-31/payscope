import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import type { ProviderAdapter } from '@payscope/provider-adapters/adapter';
import { ProviderError } from '@payscope/provider-adapters/provider-error';
import type { ProviderObjectSnapshot } from '@payscope/provider-adapters/provider-object';
import { createCredentialsCipher } from '../crypto/credentials-cipher';
import type { Job } from '../jobs/job-queue';
import { RUN_RECONCILIATION_JOB_KIND } from '../jobs/handlers/run-reconciliation';
import { TEST_CREDENTIALS_KEY } from './identity-harness';

export type Org = { orgId: string; connectionId: string };

export async function seedConnection(
  sql: postgres.Sql,
  orgId: string,
  withCredentials = true,
): Promise<Org> {
  const connectionId = randomUUID();
  const ciphertext = withCredentials
    ? createCredentialsCipher(TEST_CREDENTIALS_KEY).encrypt(
        { webhookSecrets: [], apiKey: 'sk_test_recon' },
        connectionId,
      ).ciphertext
    : null;
  await sql`insert into provider_connections
      (id, org_id, provider, mode, status, display_name, external_account_id, credentials_ciphertext)
    values (${connectionId}, ${orgId}, 'stripe', 'sandbox', 'active', 'Stripe', ${`acct_${randomUUID()}`}, ${ciphertext})`;
  return { orgId, connectionId };
}

export async function addCustomer(sql: postgres.Sql, o: Org, mappings = 1): Promise<string> {
  const id = randomUUID();
  await sql`insert into customers (id, org_id) values (${id}, ${o.orgId})`;
  for (let i = 0; i < mappings; i++) {
    await sql`insert into provider_customer_mappings (org_id, connection_id, customer_id, provider_customer_id)
      values (${o.orgId}, ${o.connectionId}, ${id}, ${`cus_${randomUUID()}`})`;
  }
  return id;
}

export type PaymentSeed = {
  customerId?: string | null;
  status?: string;
  amount?: number;
  refunded?: number;
  providerId?: string;
};

export async function addPayment(
  sql: postgres.Sql,
  o: Org,
  p: PaymentSeed = {},
): Promise<{ id: string; providerId: string }> {
  const id = randomUUID();
  const providerId = p.providerId ?? `pi_${randomUUID()}`;
  await sql`insert into payment_records
      (id, org_id, connection_id, customer_id, provider_payment_id, status, amount_minor, amount_refunded_minor, currency)
    values (${id}, ${o.orgId}, ${o.connectionId}, ${p.customerId ?? null}, ${providerId},
      ${p.status ?? 'succeeded'}, ${p.amount ?? 1000}, ${p.refunded ?? 0}, 'USD')`;
  return { id, providerId };
}

export async function addSubscription(
  sql: postgres.Sql,
  o: Org,
  customerId: string,
  status: string,
  periodEnd: string | null = null,
): Promise<string> {
  const id = randomUUID();
  await sql`insert into subscription_records
      (id, org_id, connection_id, customer_id, provider_subscription_id, status, current_period_end)
    values (${id}, ${o.orgId}, ${o.connectionId}, ${customerId}, ${`sub_${randomUUID()}`}, ${status},
      ${periodEnd}::timestamptz)`;
  return id;
}

export async function addEntitlement(
  sql: postgres.Sql,
  o: Org,
  customerId: string,
  state: string,
  subscriptionId: string | null = null,
): Promise<string> {
  const id = randomUUID();
  await sql`insert into entitlement_records
      (id, org_id, customer_id, subscription_id, entitlement_key, state, source)
    values (${id}, ${o.orgId}, ${customerId}, ${subscriptionId}, 'pro', ${state}, 'provider_event')`;
  return id;
}

export async function addStuckEvent(
  sql: postgres.Sql,
  o: Org,
  objectRef: string,
  normalizedType: string,
  status = 'needs_attention',
): Promise<void> {
  await sql`insert into provider_events
      (org_id, connection_id, provider, provider_event_id, event_type, normalized_type, occurred_at,
       status, signature_verified, payload, object_ref)
    values (${o.orgId}, ${o.connectionId}, 'stripe', ${`evt_${randomUUID()}`}, ${normalizedType},
      ${normalizedType}, now(), ${status}, true, '{}'::jsonb, ${objectRef})`;
}

export function reconJob(orgId: string, runId: string, attemptCount = 1): Job {
  return {
    id: randomUUID(),
    orgId,
    kind: RUN_RECONCILIATION_JOB_KIND,
    payload: { runId },
    attemptCount,
    maxAttempts: 5,
  };
}

export type FakeBehavior =
  | { kind: 'ok'; status: string; amountMinor?: bigint }
  | { kind: 'error'; category: ConstructorParameters<typeof ProviderError>[0] };

export function createFakeAdapter(
  behaviors: Map<string, FakeBehavior>,
  onCall: (id: string) => Promise<void> | void = () => undefined,
) {
  const calls: string[] = [];
  async function fetchObject(_ctx: unknown, id: string): Promise<ProviderObjectSnapshot> {
    calls.push(id);
    await onCall(id);
    const b = behaviors.get(id);
    if (!b) throw new ProviderError('not_found', 'missing');
    if (b.kind === 'error') throw new ProviderError(b.category, 'fake failure');
    return {
      provider: 'stripe',
      objectId: id,
      status: b.status,
      amountMinor: b.amountMinor ?? null,
      currency: null,
      fetchedAt: new Date(),
      raw: {},
    };
  }
  const adapter: ProviderAdapter = {
    provider: 'stripe',
    capabilities: {
      webhookVerification: 'unsupported',
      eventNormalization: 'unsupported',
      authoritativeFetch: 'simulated',
      reconciliation: 'simulated',
      credentialValidation: 'unsupported',
      idMapping: 'unsupported',
    },
    verifyWebhook: () => Promise.resolve({ ok: false, reason: 'malformed' }),
    normalizeEvent: () => {
      throw new Error('not used');
    },
    fetchPayment: fetchObject,
    fetchSubscription: fetchObject,
  };
  return { adapter, calls };
}
