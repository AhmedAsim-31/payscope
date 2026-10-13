import { and, eq } from 'drizzle-orm';
import { customersTable, providerCustomerMappingsTable } from '../db/schema/providers';
import type { Tx } from './apply-types';

async function findMapping(tx: Tx, connectionId: string, providerCustomerId: string) {
  const [row] = await tx
    .select({ customerId: providerCustomerMappingsTable.customerId })
    .from(providerCustomerMappingsTable)
    .where(
      and(
        eq(providerCustomerMappingsTable.connectionId, connectionId),
        eq(providerCustomerMappingsTable.providerCustomerId, providerCustomerId),
      ),
    );
  return row?.customerId;
}

export async function resolveCustomerId(
  tx: Tx,
  orgId: string,
  connectionId: string,
  providerCustomerId: string,
): Promise<string> {
  const existing = await findMapping(tx, connectionId, providerCustomerId);
  if (existing) return existing;
  const [customer] = await tx
    .insert(customersTable)
    .values({ orgId, externalRef: providerCustomerId })
    .returning({ id: customersTable.id });
  if (!customer) throw new Error('customer insert returned no row');
  const [mapping] = await tx
    .insert(providerCustomerMappingsTable)
    .values({ orgId, connectionId, customerId: customer.id, providerCustomerId })
    .onConflictDoNothing({
      target: [
        providerCustomerMappingsTable.connectionId,
        providerCustomerMappingsTable.providerCustomerId,
      ],
    })
    .returning({ customerId: providerCustomerMappingsTable.customerId });
  if (mapping) return mapping.customerId;
  await tx.delete(customersTable).where(eq(customersTable.id, customer.id));
  const winner = await findMapping(tx, connectionId, providerCustomerId);
  if (!winner) throw new Error('customer mapping vanished after conflict');
  return winner;
}
