import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app';
import { createCredentialsCipher } from '../crypto/credentials-cipher';
import { createDb } from '../db/client';
import { TEST_CREDENTIALS_KEY } from '../test/identity-harness';
import { TEST_DATABASE_URL } from '../test/test-database-url';
import { STRIPE_SECRET, stripeEvent, stripeHeaders } from '../test/webhook-fixtures';

const { db, sql } = createDb(TEST_DATABASE_URL, { max: 3 });
const cipher = createCredentialsCipher(TEST_CREDENTIALS_KEY);
const lines: string[] = [];
let app: FastifyInstance;
const connectionId = randomUUID();

beforeAll(async () => {
  const [org] = await sql<{ id: string }[]>`
    insert into organizations (name, slug) values ('Log', ${`org-${randomUUID().slice(0, 12)}`})
    returning id`;
  const { ciphertext, keyVersion } = cipher.encrypt(
    { webhookSecrets: [STRIPE_SECRET] },
    connectionId,
  );
  await sql`insert into provider_connections
    (id, org_id, provider, mode, status, display_name, external_account_id, credentials_ciphertext, credentials_key_version)
    values (${connectionId}, ${org?.id ?? ''}, 'stripe', 'sandbox', 'unverified', 'log', 'acct_log', ${ciphertext}, ${keyVersion})`;
  app = await buildApp({
    db,
    credentialsCipher: cipher,
    logLevel: 'debug',
    logStream: { write: (msg) => lines.push(msg) },
  });
});
afterAll(async () => {
  await app.close();
  await sql.end({ timeout: 1 });
});

describe('webhook logging', () => {
  it('never logs the webhook secret, signature, or raw body', async () => {
    const good = JSON.stringify({ ...stripeEvent(), marker: 'BODY_MARKER_GOOD' });
    const goodHeaders = stripeHeaders(good);
    await app.inject({
      method: 'POST',
      url: `/webhooks/stripe/${connectionId}`,
      headers: goodHeaders,
      payload: good,
    });
    const bad = JSON.stringify({ ...stripeEvent(), marker: 'BODY_MARKER_BAD' });
    const badHeaders = stripeHeaders(bad, 'whsec_wrong_secret');
    await app.inject({
      method: 'POST',
      url: `/webhooks/stripe/${connectionId}`,
      headers: badHeaders,
      payload: bad,
    });
    const logs = lines.join('');
    expect(logs).toContain('webhook signature rejected');
    for (const forbidden of [
      STRIPE_SECRET,
      'whsec_wrong_secret',
      'BODY_MARKER_GOOD',
      'BODY_MARKER_BAD',
      goodHeaders['stripe-signature'],
      badHeaders['stripe-signature'],
    ]) {
      expect(logs).not.toContain(forbidden);
    }
  });
});
