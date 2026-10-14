import { describe, expect, it } from 'vitest';
import { REASON, type Tenant } from '../test/ops-harness';
import { addCustomer, addPayment, addSubscription } from '../test/reconciliation-fixtures';
import {
  addFinding,
  behaviors,
  errorCode,
  findingAudits,
  findingRow,
  refresh,
  refreshSub,
  sql,
  subscriptionRow,
  tenant,
  useFake,
  useRefreshHarness,
} from './refresh-from-provider.harness';

useRefreshHarness();

describe('refresh resolves the originating finding', () => {
  it('resolves an open status mismatch on the refreshed subscription and audits it', async () => {
    useFake();
    const t = await tenant();
    const subId = await addSubscription(sql, t, await addCustomer(sql, t), 'active');
    const providerId = (await subscriptionRow(subId))?.providerId ?? '';
    behaviors.set(providerId, { kind: 'ok', status: 'past_due' });
    const findingId = await addFinding(t, 'subscription', subId);

    const res = await refreshSub(t, subId);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ resultingState: { resolvedFindingIds: [findingId] } });
    expect(await findingRow(findingId)).toEqual({ status: 'resolved', note: REASON });
    const rows = await findingAudits(t, findingId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      previous: { status: 'open' },
      resulting: { status: 'resolved', via: 'refresh_from_provider' },
    });
  });

  it('resolves an open status mismatch on the refreshed payment', async () => {
    useFake();
    const t = await tenant();
    const pay = await addPayment(sql, t, { status: 'pending' });
    behaviors.set(pay.providerId, { kind: 'ok', status: 'succeeded' });
    const findingId = await addFinding(t, 'payment', pay.id, 'reviewed');

    const res = await refresh(t, pay.id);
    expect(res.statusCode).toBe(200);
    expect((await findingRow(findingId))?.status).toBe('resolved');
    expect((await findingAudits(t, findingId))[0]).toMatchObject({
      previous: { status: 'reviewed' },
    });
  });

  it('leaves the finding open when the mapped status still differs from the provider', async () => {
    useFake();
    const t = await tenant();
    const pay = await addPayment(sql, t, { status: 'pending' });
    behaviors.set(pay.providerId, { kind: 'ok', status: 'completed' });
    const findingId = await addFinding(t, 'payment', pay.id);

    const res = await refresh(t, pay.id);
    expect(res.statusCode).toBe(200);
    expect((await findingRow(findingId))?.status).toBe('open');
    expect(await findingAudits(t, findingId)).toHaveLength(0);
  });

  it('does not touch dismissed findings or findings on other records', async () => {
    useFake();
    const t = await tenant();
    const pay = await addPayment(sql, t, { status: 'pending' });
    const other = await addPayment(sql, t, { status: 'pending' });
    behaviors.set(pay.providerId, { kind: 'ok', status: 'succeeded' });
    const dismissed = await addFinding(t, 'payment', pay.id, 'dismissed');
    const unrelated = await addFinding(t, 'payment', other.id);

    const res = await refresh(t, pay.id);
    expect(res.statusCode).toBe(200);
    expect((await findingRow(dismissed))?.status).toBe('dismissed');
    expect((await findingRow(unrelated))?.status).toBe('open');
  });
});

describe('refresh on an already consistent record', () => {
  const subscriptionWith = async (t: Tenant, local: string, remote: string) => {
    const id = await addSubscription(sql, t, await addCustomer(sql, t), local);
    behaviors.set((await subscriptionRow(id))?.providerId ?? '', { kind: 'ok', status: remote });
    return id;
  };

  it('resolves open status mismatches on a payment and still answers 409', async () => {
    useFake();
    const t = await tenant();
    const pay = await addPayment(sql, t, { status: 'refunded', amount: 1000, refunded: 1000 });
    behaviors.set(pay.providerId, { kind: 'ok', status: 'succeeded', amountMinor: 1000n });
    const findingId = await addFinding(t, 'payment', pay.id);

    const res = await refresh(t, pay.id);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      error: { code: 'ALREADY_CONSISTENT', details: { resolvedFindingIds: [findingId] } },
    });
    expect(await findingRow(findingId)).toEqual({ status: 'resolved', note: REASON });
    expect(await findingAudits(t, findingId)).toEqual([
      expect.objectContaining({
        previous: { status: 'open' },
        resulting: { status: 'resolved', via: 'refresh_from_provider' },
      }),
    ]);
  });

  it('resolves reviewed status mismatches on a subscription', async () => {
    useFake();
    const t = await tenant();
    const subId = await subscriptionWith(t, 'active', 'active');
    const findingId = await addFinding(t, 'subscription', subId, 'reviewed');

    const res = await refreshSub(t, subId);
    expect(res.statusCode).toBe(409);
    expect(errorCode(res)).toBe('ALREADY_CONSISTENT');
    expect((await findingRow(findingId))?.status).toBe('resolved');
    expect(await findingAudits(t, findingId)).toHaveLength(1);
  });

  it('leaves the finding open when the local status only maps to the provider spelling', async () => {
    useFake();
    const t = await tenant();
    const subId = await subscriptionWith(t, 'past_due', 'unpaid');
    const findingId = await addFinding(t, 'subscription', subId);

    const res = await refreshSub(t, subId);
    expect(res.statusCode).toBe(409);
    expect((await findingRow(findingId))?.status).toBe('open');
  });
});
