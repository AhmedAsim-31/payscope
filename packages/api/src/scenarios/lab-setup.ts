import { and, eq } from 'drizzle-orm';
import type { CredentialsCipher } from '../crypto/credentials-cipher';
import type { Db } from '../db/client';
import {
  customersTable,
  providerConnectionsTable,
  providerCustomerMappingsTable,
} from '../db/schema/providers';
import { demoId } from '../seed/seed-ids';

export const LAB_DISPLAY_NAME = 'Scenario lab (demo)';
export const LAB_PRICE_PRO = 'price_lab_pro';
export const LAB_PRICE_UNMAPPED = 'price_lab_unmapped';
export const LAB_REF_PREFIX = 'scenario-lab:';
const LAB_API_KEY = 'sk_test_scenario_lab';

export type LabConnection = { id: string; secret: string };
export type LabCustomer = { id: string; providerCustomerId: string };

export const labConnectionId = (orgId: string) => demoId(`scenario-lab:${orgId}`);

export async function ensureLabConnection(
  db: Db,
  cipher: CredentialsCipher,
  orgId: string,
): Promise<LabConnection> {
  const id = labConnectionId(orgId);
  const secret = `whsec_scenario_lab_${orgId}`;
  const { ciphertext, keyVersion } = cipher.encrypt(
    { webhookSecrets: [secret], apiKey: LAB_API_KEY },
    id,
  );
  await db
    .insert(providerConnectionsTable)
    .values({
      id,
      orgId,
      provider: 'stripe',
      mode: 'simulation',
      status: 'active',
      displayName: LAB_DISPLAY_NAME,
      externalAccountId: 'acct_scenario_lab',
      credentialsCiphertext: ciphertext,
      credentialsKeyVersion: keyVersion,
      entitlementMap: { [LAB_PRICE_PRO]: ['pro'] },
    })
    .onConflictDoNothing({ target: providerConnectionsTable.id });
  return { id, secret };
}

export async function createLabCustomer(
  db: Db,
  orgId: string,
  connectionId: string,
  tag: string,
  key: string,
): Promise<LabCustomer> {
  const providerCustomerId = `cus_lab_${tag}_${key}`;
  const [customer] = await db
    .insert(customersTable)
    .values({
      orgId,
      email: `${key}.${tag}@scenario-lab.example`,
      displayName: `Lab customer ${key}`,
      externalRef: `${LAB_REF_PREFIX}${tag}:${key}`,
    })
    .returning({ id: customersTable.id });
  if (!customer) throw new Error('lab customer insert returned no row');
  await db
    .insert(providerCustomerMappingsTable)
    .values({ orgId, connectionId, customerId: customer.id, providerCustomerId });
  return { id: customer.id, providerCustomerId };
}

export async function labConnectionExists(db: Db, orgId: string): Promise<boolean> {
  const rows = await db
    .select({ id: providerConnectionsTable.id })
    .from(providerConnectionsTable)
    .where(
      and(
        eq(providerConnectionsTable.orgId, orgId),
        eq(providerConnectionsTable.id, labConnectionId(orgId)),
      ),
    );
  return rows.length > 0;
}
