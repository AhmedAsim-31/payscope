import { repairResultSchema, type RepairResult } from '@payscope/shared/repair-schemas';
import type { AuditedWork } from '../audit/audit-log';
import { idempotentAudited } from '../audit/idempotent-audited';
import type { Db } from '../db/client';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export type RepairInput = {
  orgId: string;
  actorId: string;
  requestId: string;
  action: string;
  targetType: string;
  targetId: string;
  reason: string;
  idempotencyKey: string;
  body: unknown;
};

export function runRepair(
  db: Db,
  input: RepairInput,
  work: (tx: Tx) => Promise<AuditedWork<RepairResult>>,
): Promise<RepairResult> {
  return idempotentAudited(
    db,
    {
      audit: {
        orgId: input.orgId,
        actorId: input.actorId,
        requestId: input.requestId,
        action: `repair.${input.action}`,
        targetType: input.targetType,
        targetId: input.targetId,
        reason: input.reason,
      },
      scope: `repair:${input.action}`,
      idempotencyKey: input.idempotencyKey,
      body: input.body,
      response: repairResultSchema,
    },
    work,
  );
}
