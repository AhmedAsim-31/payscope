import { inArray, sql } from 'drizzle-orm';
import type { Role } from '@payscope/shared/permissions';
import type { Db } from '../db/client';
import { membershipsTable, organizationsTable, profilesTable } from '../db/schema/identity';
import { demoId } from './seed-ids';

export const DEMO_USERS = {
  owner: { id: 'd5a051dd-a737-4861-8db0-482c5cf283f3', email: 'demo-owner@example.com' },
  operator: { id: '10514f8a-c0ec-4ce6-8786-c596925387df', email: 'demo-operator@example.com' },
  viewer: { id: '5f86a70f-797f-422c-9b53-76d6c5a4f67d', email: 'demo-viewer@example.com' },
  outsider: { id: 'c01317e0-8dc4-462d-be21-76199bbe7015', email: 'demo-outsider@example.com' },
} as const;

export const DEMO_ORGS = {
  acme: { id: demoId('org:acme'), name: 'Acme Streaming (demo)', slug: 'acme-demo' },
  globex: { id: demoId('org:globex'), name: 'Globex Apps (demo)', slug: 'globex-demo' },
} as const;

export type DemoOrgKey = keyof typeof DEMO_ORGS;

export const DEMO_ORG_IDS: string[] = [DEMO_ORGS.acme.id, DEMO_ORGS.globex.id];

type Member = { org: DemoOrgKey; user: keyof typeof DEMO_USERS; role: Role };

const MEMBERS: Member[] = [
  { org: 'acme', user: 'owner', role: 'OWNER' },
  { org: 'acme', user: 'operator', role: 'OPERATOR' },
  { org: 'acme', user: 'viewer', role: 'VIEWER' },
  { org: 'globex', user: 'owner', role: 'OWNER' },
  { org: 'globex', user: 'outsider', role: 'OWNER' },
];

export async function seedIdentity(db: Db): Promise<void> {
  await db
    .insert(profilesTable)
    .values(
      Object.entries(DEMO_USERS).map(([key, u]) => ({
        id: u.id,
        email: u.email,
        displayName: `Demo ${key}`,
      })),
    )
    .onConflictDoUpdate({
      target: profilesTable.id,
      set: { email: sql`excluded.email`, displayName: sql`excluded.display_name` },
    });
  await db
    .insert(organizationsTable)
    .values(Object.values(DEMO_ORGS))
    .onConflictDoUpdate({
      target: organizationsTable.id,
      set: { name: sql`excluded.name`, slug: sql`excluded.slug` },
    });
  await db
    .insert(membershipsTable)
    .values(
      MEMBERS.map((m) => ({
        id: demoId(`membership:${m.org}:${m.user}`),
        orgId: DEMO_ORGS[m.org].id,
        userId: DEMO_USERS[m.user].id,
        role: m.role,
      })),
    )
    .onConflictDoUpdate({ target: membershipsTable.id, set: { role: sql`excluded.role` } });
}

export async function resetDemoOrgs(db: Db): Promise<void> {
  await db.delete(organizationsTable).where(inArray(organizationsTable.id, DEMO_ORG_IDS));
}
