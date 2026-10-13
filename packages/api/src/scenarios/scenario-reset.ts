import { sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { LAB_REF_PREFIX, labConnectionId } from './lab-setup';

/** Removes only rows tied to the org's scenario-lab connection, then the run history. */
export async function resetScenarioLab(db: Db, orgId: string): Promise<{ deletedRuns: number }> {
  const conn = labConnectionId(orgId);
  return db.transaction(async (tx) => {
    await tx.execute(sql`
      DELETE FROM event_processing_attempts
      WHERE event_id IN (SELECT id FROM provider_events WHERE connection_id = ${conn}::uuid)`);
    await tx.execute(sql`
      DELETE FROM background_jobs WHERE org_id = ${orgId}::uuid AND (
        payload->>'eventId' IN (SELECT id::text FROM provider_events WHERE connection_id = ${conn}::uuid)
        OR payload->>'runId' IN (SELECT id::text FROM reconciliation_runs WHERE connection_id = ${conn}::uuid)
        OR payload->>'runId' IN (SELECT id::text FROM demo_scenario_runs WHERE org_id = ${orgId}::uuid))`);
    await tx.execute(sql`DELETE FROM provider_events WHERE connection_id = ${conn}::uuid`);
    await tx.execute(sql`DELETE FROM reconciliation_runs WHERE connection_id = ${conn}::uuid`);
    await tx.execute(sql`
      DELETE FROM entitlement_records WHERE org_id = ${orgId}::uuid AND customer_id IN
        (SELECT id FROM customers WHERE org_id = ${orgId}::uuid AND external_ref LIKE ${`${LAB_REF_PREFIX}%`})`);
    await tx.execute(sql`DELETE FROM payment_records WHERE connection_id = ${conn}::uuid`);
    await tx.execute(sql`DELETE FROM subscription_records WHERE connection_id = ${conn}::uuid`);
    await tx.execute(sql`DELETE FROM provider_connections WHERE id = ${conn}::uuid`);
    await tx.execute(sql`
      DELETE FROM customers WHERE org_id = ${orgId}::uuid AND external_ref LIKE ${`${LAB_REF_PREFIX}%`}`);
    const runs = await tx.execute(
      sql`DELETE FROM demo_scenario_runs WHERE org_id = ${orgId}::uuid RETURNING id`,
    );
    return { deletedRuns: runs.length };
  });
}
