import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCredentialsCipher } from '../crypto/credentials-cipher';
import { createDb } from '../db/client';
import { TEST_DATABASE_URL } from '../test/test-database-url';
import { runSeed, summarize } from './run-seed';
import { DEMO_ORG_IDS, DEMO_ORGS } from './seed-identity';

const { db, sql } = createDb(TEST_DATABASE_URL, { max: 5 });
const cipher = createCredentialsCipher(randomBytes(32));
const empty = { processed: 0, queued: 0, failed: 0, duplicate: 0 };

afterAll(() => sql.end({ timeout: 1 }));

describe('demo seed', () => {
  beforeAll(async () => {
    await runSeed(db, cipher, { reset: true });
  });

  it('converges: a second run leaves identical counts', async () => {
    const before = await summarize(db, empty);
    await runSeed(db, cipher, { reset: false });
    const after = await summarize(db, empty);
    expect(after).toEqual(before);
    expect(after.totals['customers']).toBe(40);
  });

  it('reset removes only demo orgs', async () => {
    const [other] = await sql<{ id: string }[]>`
      insert into organizations (name, slug) values ('Not Demo', ${`keep-${randomUUID()}`})
      returning id`;
    await runSeed(db, cipher, { reset: true });
    const survivors = await sql`select id from organizations where id = ${other?.id ?? ''}`;
    expect(survivors).toHaveLength(1);
    const demo = await sql`select id from organizations where id in ${sql(DEMO_ORG_IDS)}`;
    expect(demo).toHaveLength(2);
    await sql`delete from organizations where id = ${other?.id ?? ''}`;
  });

  it('contains the deliberate situations', async () => {
    const summary = await summarize(db, empty);
    expect(summary.eventsByStatus['needs_attention']).toBe(3);
    expect(summary.jobsByStatus['dead']).toBe(3);
    expect(summary.jobsByStatus['queued']).toBe(2);
    expect(summary.eventsByStatus['ignored']).toBe(1);
    const dupes = await sql`
      select provider_event_id from provider_events
      where org_id = ${DEMO_ORGS.acme.id} group by connection_id, provider_event_id having count(*) > 1`;
    expect(dupes).toHaveLength(0);
  });

  it('guided demo customer has an active subscription and payment but no entitlement', async () => {
    const [maya] = await sql<{ id: string; external_ref: string }[]>`
      select id, external_ref from customers where email = 'maya.patel@example.com'`;
    expect(maya?.external_ref).toBe('demo:maya.patel');
    const [counts] = await sql<{ pay: number; sub: number; ent: number }[]>`
      select
        (select count(*) from payment_records where customer_id = ${maya?.id ?? ''} and status = 'succeeded')::int as pay,
        (select count(*) from subscription_records where customer_id = ${maya?.id ?? ''} and status = 'active')::int as sub,
        (select count(*) from entitlement_records where customer_id = ${maya?.id ?? ''})::int as ent`;
    expect(counts?.sub).toBe(1);
    expect(counts?.ent).toBe(0);
    expect(counts?.pay).toBeGreaterThan(0);
  });

  it('keeps an active entitlement on an expired subscription', async () => {
    const rows = await sql`
      select 1 from subscription_records s
      join entitlement_records e on e.subscription_id = s.id
      where s.org_id = ${DEMO_ORGS.acme.id} and s.status = 'expired' and e.state = 'active'`;
    expect(rows.length).toBeGreaterThan(0);
  });

  it('never lets Globex rows reference Acme connections', async () => {
    const acmeConnections = await sql<{ id: string }[]>`
      select id from provider_connections where org_id = ${DEMO_ORGS.acme.id}`;
    const ids = acmeConnections.map((c) => c.id);
    const leaks = await sql`
      select 1 from payment_records where org_id = ${DEMO_ORGS.globex.id} and connection_id in ${sql(ids)}
      union all select 1 from subscription_records where org_id = ${DEMO_ORGS.globex.id} and connection_id in ${sql(ids)}
      union all select 1 from provider_events where org_id = ${DEMO_ORGS.globex.id} and connection_id in ${sql(ids)}`;
    expect(leaks).toHaveLength(0);
  });
});
