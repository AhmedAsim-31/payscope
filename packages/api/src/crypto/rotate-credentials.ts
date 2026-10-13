import { and, asc, eq, gt, isNotNull, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { providerConnectionsTable as t } from '../db/schema/providers';
import type { CredentialsCipher } from './credentials-cipher';

export type RotationSummary = { rotated: number; skipped: number; failed: string[] };

const BATCH_SIZE = 100;

export async function rotateCredentials(
  db: Db,
  cipher: CredentialsCipher,
  activeVersion: number,
): Promise<RotationSummary> {
  const summary: RotationSummary = { rotated: 0, skipped: 0, failed: [] };
  let cursor = '00000000-0000-0000-0000-000000000000';
  for (;;) {
    const rows = await db
      .select({ id: t.id, ciphertext: t.credentialsCiphertext, version: t.credentialsKeyVersion })
      .from(t)
      .where(
        and(
          gt(t.id, cursor),
          isNotNull(t.credentialsCiphertext),
          sql`${t.credentialsKeyVersion} is distinct from ${activeVersion}`,
        ),
      )
      .orderBy(asc(t.id))
      .limit(BATCH_SIZE);
    if (rows.length === 0) return summary;
    for (const row of rows) {
      if (!row.ciphertext || row.version === null) continue;
      try {
        const next = cipher.encrypt(cipher.decrypt(row.ciphertext, row.id), row.id);
        const updated = await db
          .update(t)
          .set({
            credentialsCiphertext: next.ciphertext,
            credentialsKeyVersion: next.keyVersion,
            updatedAt: new Date(),
          })
          .where(and(eq(t.id, row.id), eq(t.credentialsKeyVersion, row.version)))
          .returning({ id: t.id });
        if (updated.length > 0) summary.rotated += 1;
        else summary.skipped += 1;
      } catch {
        summary.failed.push(row.id);
      }
    }
    cursor = rows[rows.length - 1]?.id ?? cursor;
  }
}
