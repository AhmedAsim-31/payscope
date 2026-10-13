import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createDefaultAdapterRegistry } from '../providers/adapter-registry';
import { createDefaultHandlers } from '../jobs/default-handlers';
import { createWorker } from '../jobs/worker';
import { createHarness } from '../test/identity-harness';
import { parkQueuedJobs } from '../test/job-fixtures';
import { addCustomer, addEntitlement, addSubscription } from '../test/reconciliation-fixtures';
import { findingIdOf, newTenant, REASON, repairCall, runLocalRecon } from '../test/ops-harness';
import { STRIPE_SECRET, stripeEvent, stripeHeaders } from '../test/webhook-fixtures';

const API_KEY = 'sk_test_LOG_AUDIT_API_KEY';
const CUSTOMER_EMAIL = 'pii-customer-marker@example.test';
const BODY_MARKER = 'RAW_PAYLOAD_MARKER';
const harness = createHarness();
const lines: string[] = [];
const capture = (obj: object, msg?: string) => lines.push(JSON.stringify({ ...obj, msg }));
const worker = createWorker({
  db: harness.db,
  handlers: createDefaultHandlers(createDefaultAdapterRegistry()),
  logger: { info: capture, warn: capture, error: capture },
});
let app: FastifyInstance;

beforeAll(async () => {
  await parkQueuedJobs(harness.sql);
  app = await harness.start({
    logger: undefined,
    logLevel: 'trace',
    logStream: { write: (msg) => lines.push(msg) },
  });
});
afterAll(() => harness.stop());

describe('log redaction across ingress, worker, and repair', () => {
  it('never writes secrets, tokens, emails, or raw payloads to logs', async () => {
    const t = await newTenant(harness, app);
    const conn = await app.inject({
      method: 'POST',
      url: `/api/v1/orgs/${t.orgId}/connections`,
      headers: t.owner.headers,
      payload: {
        provider: 'stripe',
        mode: 'sandbox',
        displayName: 'logs',
        externalAccountId: `acct_${randomUUID()}`,
        webhookSecrets: [STRIPE_SECRET],
        apiKey: API_KEY,
      },
    });
    const connectionId = conn.json<{ id: string }>().id;

    const event = stripeEvent();
    const data = event.data as { object: Record<string, unknown> };
    data.object.receipt_email = CUSTOMER_EMAIL;
    data.object.metadata = { marker: BODY_MARKER };
    const body = JSON.stringify(event);
    const good = stripeHeaders(body);
    const url = `/webhooks/stripe/${connectionId}`;
    await app.inject({ method: 'POST', url, headers: good, payload: body });
    const bad = stripeHeaders(body, 'whsec_wrong_log_secret');
    await app.inject({ method: 'POST', url, headers: bad, payload: body });
    await app.inject({ url: '/api/v1/me', headers: { authorization: 'Bearer BAD.TOKEN.VALUE' } });

    await worker.drainOnce();

    const customer = await addCustomer(harness.sql, t);
    const subId = await addSubscription(
      harness.sql,
      t,
      customer,
      'expired',
      '2020-01-01T00:00:00Z',
    );
    await addEntitlement(harness.sql, t, customer, 'active', subId);
    await runLocalRecon(harness, app, t);
    const findingId = await findingIdOf(harness, t, 'expired_externally_active_locally');
    const repair = await repairCall(app, t, t.owner, 'correct-entitlement', {
      findingId,
      reason: REASON,
    });
    expect(repair.statusCode).toBe(200);

    const logs = lines.join('\n');
    expect(logs).toContain('webhook signature rejected');
    expect(logs).toContain('job_finished');
    const bearer = t.owner.headers.authorization.replace('Bearer ', '');
    for (const forbidden of [
      STRIPE_SECRET,
      'whsec_wrong_log_secret',
      API_KEY,
      CUSTOMER_EMAIL,
      t.owner.email,
      BODY_MARKER,
      bearer,
      'BAD.TOKEN.VALUE',
      good['stripe-signature'],
      bad['stripe-signature'],
    ]) {
      expect(logs).not.toContain(forbidden);
    }
  });
});
