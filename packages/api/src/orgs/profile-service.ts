import { sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import type { AuthContext } from '../auth/token-verifier';
import { profilesTable } from '../db/schema/identity';

export async function ensureProfile(db: Db, auth: AuthContext): Promise<void> {
  const email = auth.email ?? '';
  await db
    .insert(profilesTable)
    .values({ id: auth.userId, email })
    .onConflictDoUpdate({
      target: profilesTable.id,
      set: { email, updatedAt: new Date() },
      setWhere: sql`excluded.email <> '' and ${profilesTable.email} is distinct from excluded.email`,
    });
}
