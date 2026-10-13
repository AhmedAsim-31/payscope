import { sql } from 'drizzle-orm';
import type { ProviderName } from '@payscope/provider-adapters/provider-name';
import type { CredentialsCipher } from '../crypto/credentials-cipher';
import type { Db } from '../db/client';
import {
  customersTable,
  providerConnectionsTable,
  providerCustomerMappingsTable,
} from '../db/schema/providers';
import { DEMO_ORGS, type DemoOrgKey } from './seed-identity';
import { demoId } from './seed-ids';
import { PEOPLE, type Person } from './seed-people';

export type SeedConnection = { id: string; orgId: string; org: DemoOrgKey; provider: ProviderName };

const CONNECTION_PLAN: { org: DemoOrgKey; provider: ProviderName }[] = [
  { org: 'acme', provider: 'stripe' },
  { org: 'acme', provider: 'paddle' },
  { org: 'acme', provider: 'revenuecat' },
  { org: 'globex', provider: 'paypal' },
  { org: 'globex', provider: 'stripe' },
];

const PROVIDER_LABEL: Record<ProviderName, string> = {
  stripe: 'Stripe',
  paddle: 'Paddle',
  revenuecat: 'RevenueCat',
  paypal: 'PayPal',
};

export const CONNECTIONS: SeedConnection[] = CONNECTION_PLAN.map(({ org, provider }) => ({
  id: demoId(`connection:${org}:${provider}`),
  orgId: DEMO_ORGS[org].id,
  org,
  provider,
}));

export function connectionOf(org: DemoOrgKey, provider: ProviderName): SeedConnection {
  const found = CONNECTIONS.find((c) => c.org === org && c.provider === provider);
  if (!found) throw new Error(`no demo connection ${org}/${provider}`);
  return found;
}

export function connectionOfPerson(person: Person): SeedConnection {
  return connectionOf(person.org, person.provider);
}

export async function seedConnections(db: Db, cipher: CredentialsCipher): Promise<void> {
  const rows = CONNECTIONS.map((c) => {
    const { ciphertext, keyVersion } = cipher.encrypt(
      { webhookSecrets: [`whsec_demo_${c.org}_${c.provider}`] },
      c.id,
    );
    return {
      id: c.id,
      orgId: c.orgId,
      provider: c.provider,
      mode: 'simulation' as const,
      status: 'active' as const,
      displayName: `${PROVIDER_LABEL[c.provider]} simulation (demo)`,
      externalAccountId: `acct_demo_${c.org}_${c.provider}`,
      credentialsCiphertext: ciphertext,
      credentialsKeyVersion: keyVersion,
      entitlementMap:
        c.org === 'acme' && c.provider === 'stripe' ? { price_demo_pro: ['pro'] } : {},
    };
  });
  await db
    .insert(providerConnectionsTable)
    .values(rows)
    .onConflictDoUpdate({
      target: providerConnectionsTable.id,
      set: {
        displayName: sql`excluded.display_name`,
        credentialsCiphertext: sql`excluded.credentials_ciphertext`,
        credentialsKeyVersion: sql`excluded.credentials_key_version`,
        entitlementMap: sql`excluded.entitlement_map`,
      },
    });
}

export async function seedCustomers(db: Db): Promise<void> {
  await db
    .insert(customersTable)
    .values(
      PEOPLE.map((p) => ({
        id: demoId(`customer:${p.key}`),
        orgId: DEMO_ORGS[p.org].id,
        email: `${p.key}@example.com`,
        displayName: p.name,
        externalRef: `demo:${p.key}`,
      })),
    )
    .onConflictDoUpdate({
      target: customersTable.id,
      set: {
        email: sql`excluded.email`,
        displayName: sql`excluded.display_name`,
        externalRef: sql`excluded.external_ref`,
      },
    });
  await db
    .insert(providerCustomerMappingsTable)
    .values(
      PEOPLE.map((p) => {
        const connection = connectionOfPerson(p);
        return {
          id: demoId(`mapping:${connection.id}:${p.providerCustomerId}`),
          orgId: connection.orgId,
          connectionId: connection.id,
          customerId: demoId(`customer:${p.key}`),
          providerCustomerId: p.providerCustomerId,
        };
      }),
    )
    .onConflictDoNothing({ target: providerCustomerMappingsTable.id });
}
