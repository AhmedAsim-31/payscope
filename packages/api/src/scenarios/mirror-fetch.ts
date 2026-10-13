import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { paymentRecordsTable, subscriptionRecordsTable } from '../db/schema/records';

export type ProviderOverride = { down: true } | { status: string };

const PATH = /\/v1\/(payment_intents|subscriptions)\/([^/?]+)/;
const LIST_PATH = /\/v1\/payment_intents\?/;

const json = (body: object, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A provider that mirrors local state, except where the scenario overrides it. */
export function createMirrorFetch(db: Db, overrides: Map<string, ProviderOverride>): typeof fetch {
  return async (input) => {
    const url = input instanceof Request ? input.url : input.toString();
    // A mirror holds only local payments, so its listing can never surface one missing locally.
    if (LIST_PATH.test(url)) return json({ object: 'list', data: [], has_more: false });
    const match = PATH.exec(url);
    if (!match?.[1] || !match[2]) return json({}, 404);
    const [, kind, id] = match;
    const override = overrides.get(id);
    if (override && 'down' in override) throw new TypeError('simulated provider outage');
    if (kind === 'payment_intents') {
      const [row] = await db
        .select()
        .from(paymentRecordsTable)
        .where(eq(paymentRecordsTable.providerPaymentId, id));
      if (!row) return json({}, 404);
      return json({
        id,
        status: override?.status ?? row.status,
        amount: Number(row.amountMinor),
        amount_received: Number(row.amountMinor),
        currency: row.currency.toLowerCase(),
      });
    }
    const [row] = await db
      .select()
      .from(subscriptionRecordsTable)
      .where(eq(subscriptionRecordsTable.providerSubscriptionId, id));
    if (!row) return json({}, 404);
    return json({ id, status: override?.status ?? row.status });
  };
}
