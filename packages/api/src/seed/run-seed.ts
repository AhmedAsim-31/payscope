import { sql } from 'drizzle-orm';
import type { CredentialsCipher } from '../crypto/credentials-cipher';
import type { Db } from '../db/client';
import { createDeliverer, type SeedStats } from './seed-deliver';
import { seedConnections, seedCustomers } from './seed-directory';
import { DEMO_ORG_IDS, resetDemoOrgs, seedIdentity } from './seed-identity';
import { anchorOf } from './seed-payloads';
import { seedPaddle, seedPayPal, seedRevenueCat } from './seed-providers';
import { seedSituations } from './seed-situations';
import { seedStripePayments, seedStripeSubscriptions } from './seed-stripe';

export type SeedSummary = {
  totals: Record<string, number>;
  eventsByStatus: Record<string, number>;
  jobsByStatus: Record<string, number>;
  subscriptionsByStatus: Record<string, number>;
  paymentsByCurrency: Record<string, number>;
  delivery: SeedStats;
};

const TOTAL_TABLES = [
  'memberships',
  'provider_connections',
  'customers',
  'provider_events',
  'background_jobs',
  'payment_records',
  'subscription_records',
  'entitlement_records',
] as const;

async function groupCounts(db: Db, table: string, column: string): Promise<Record<string, number>> {
  const ids = sql.join(
    DEMO_ORG_IDS.map((id) => sql`${id}`),
    sql`, `,
  );
  const rows = await db.execute<{ k: string; n: number }>(
    sql`select ${sql.raw(column)}::text as k, count(*)::int as n from ${sql.raw(table)}
        where org_id in (${ids}) group by 1 order by 1`,
  );
  return Object.fromEntries(rows.map((r) => [r.k, r.n]));
}

export async function summarize(db: Db, delivery: SeedStats): Promise<SeedSummary> {
  const totals: Record<string, number> = {};
  for (const table of TOTAL_TABLES) {
    const counts = await groupCounts(db, table, `'all'`);
    totals[table] = counts['all'] ?? 0;
  }
  return {
    totals,
    eventsByStatus: await groupCounts(db, 'provider_events', 'status'),
    jobsByStatus: await groupCounts(db, 'background_jobs', 'status'),
    subscriptionsByStatus: await groupCounts(db, 'subscription_records', 'status'),
    paymentsByCurrency: await groupCounts(db, 'payment_records', 'currency'),
    delivery,
  };
}

export async function runSeed(
  db: Db,
  cipher: CredentialsCipher,
  opts: { reset: boolean; now?: Date },
): Promise<SeedSummary> {
  if (opts.reset) await resetDemoOrgs(db);
  const anchor = anchorOf(opts.now ?? new Date());
  const deliverer = createDeliverer(db);
  await seedIdentity(db);
  await seedConnections(db, cipher);
  await seedCustomers(db);
  await seedStripePayments(deliverer, 'acme', anchor);
  await seedStripeSubscriptions(deliverer, 'acme', anchor);
  await seedPaddle(deliverer, anchor);
  await seedRevenueCat(deliverer, anchor);
  await seedStripePayments(deliverer, 'globex', anchor);
  await seedStripeSubscriptions(deliverer, 'globex', anchor);
  await seedPayPal(deliverer, anchor);
  await seedSituations(db, deliverer, anchor);
  return summarize(db, deliverer.stats);
}
