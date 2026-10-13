import type { Db } from '../db/client';
import type { reconciliationFindingsTable } from '../db/schema/reconciliation';
import { evidenceString } from './evidence';
import { fingerprintOf } from '../reconciliation/finding-upsert';
import { LOCAL_RULES } from '../reconciliation/local-rules';

type Finding = typeof reconciliationFindingsTable.$inferSelect;
type Recheck = { verifiable: false } | { verifiable: true; stillDetected: boolean };

function cursorOf(finding: Finding): string {
  const field =
    finding.type === 'expired_externally_active_locally'
      ? 'entitlementId'
      : finding.type === 'status_mismatch'
        ? 'eventId'
        : undefined;
  return (field && evidenceString(finding.evidence, field)) || finding.subjectId;
}

/** Re-runs the finding's own local rule scoped to its subject; provider-derived findings have no local rule. */
export async function recheckFinding(
  executor: Pick<Db, 'execute'>,
  finding: Finding,
): Promise<Recheck> {
  const rule = LOCAL_RULES.find(
    (r) => r.type === finding.type && r.subjectType === finding.subjectType,
  );
  if (!rule) return { verifiable: false };
  const found = await rule.find(executor, {
    orgId: finding.orgId,
    connectionId: null,
    after: null,
    limit: 50,
    only: cursorOf(finding),
  });
  return {
    verifiable: true,
    stillDetected: found.some((c) => fingerprintOf(c.draft) === finding.fingerprint),
  };
}
