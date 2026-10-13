import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../db/client';
import { TEST_DATABASE_URL } from '../test/test-database-url';
import { createCredentialsCipher } from './credentials-cipher';
import { rotateCredentials } from './rotate-credentials';

const { db, sql } = createDb(TEST_DATABASE_URL, { max: 3 });
const k1 = randomBytes(32);
const k2 = randomBytes(32);
const v1 = createCredentialsCipher(k1, { version: 1 });
const v2 = createCredentialsCipher(k2, { version: 2, previous: new Map([[1, k1]]) });
const ids = { old: randomUUID(), current: randomUUID(), unknown: randomUUID() };
const secrets = { webhookSecrets: ['whsec_rotate_me'] };

async function insert(id: string, orgId: string, ciphertext: Buffer, version: number) {
  await sql`insert into provider_connections
    (id, org_id, provider, mode, status, display_name, external_account_id, credentials_ciphertext, credentials_key_version)
    values (${id}, ${orgId}, 'stripe', 'sandbox', 'unverified', 'rot', ${`acct_${id}`}, ${ciphertext}, ${version})`;
}

beforeAll(async () => {
  const [org] = await sql<{ id: string }[]>`
    insert into organizations (name, slug) values ('Rot', ${`org-${randomUUID().slice(0, 12)}`})
    returning id`;
  const orgId = org?.id ?? '';
  await insert(ids.old, orgId, v1.encrypt(secrets, ids.old).ciphertext, 1);
  await insert(ids.current, orgId, v2.encrypt(secrets, ids.current).ciphertext, 2);
  const stray = v1.encrypt(secrets, ids.unknown).ciphertext;
  stray[0] = 7;
  await insert(ids.unknown, orgId, stray, 7);
});
afterAll(async () => {
  await sql`delete from provider_connections where id in ${sql(Object.values(ids))}`;
  await sql.end({ timeout: 1 });
});

describe('credentials rotation', () => {
  it('re-encrypts older rows, reports unknown versions, and is idempotent', async () => {
    const first = await rotateCredentials(db, v2, 2);
    expect(first.rotated).toBeGreaterThanOrEqual(1);
    expect(first.failed).toContain(ids.unknown);
    const rows = await sql<{ id: string; v: number; c: Buffer }[]>`
      select id, credentials_key_version as v, credentials_ciphertext as c
      from provider_connections where id in ${sql(Object.values(ids))}`;
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(ids.old)?.v).toBe(2);
    expect(v2.decrypt(byId.get(ids.old)?.c ?? Buffer.alloc(0), ids.old)).toEqual(secrets);
    expect(byId.get(ids.unknown)?.v).toBe(7);
    const second = await rotateCredentials(db, v2, 2);
    expect(second.rotated).toBe(0);
    expect(second.failed).toContain(ids.unknown);
  });
});
