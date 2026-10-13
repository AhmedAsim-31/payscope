'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { findingDetailSchema, type FINDING_TYPES } from '@payscope/shared/reconciliation-schemas';
import { can, type Role } from '@payscope/shared/permissions';
import { CORRECTABLE_FINDING_TYPES } from '@payscope/shared/repair-schemas';
import { RepairDialog } from '@/components/repairs/repair-dialog';
import { useRepair, type RepairPath } from '@/components/repairs/use-repair';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api-client';
import { describeError } from '@/lib/api-messages';

type Props = {
  orgId: string;
  findingId: string;
  type: (typeof FINDING_TYPES)[number];
  status: string;
  role: Role;
};

type Mode = 'correct' | 'resolve' | null;

const isClosed = (status: string) => status === 'resolved' || status === 'dismissed';

function correctionStates(type: Props['type']) {
  return type === 'entitlement_missing_or_stale'
    ? { previous: 'No active entitlement', resulting: 'Entitlement active (manual repair)' }
    : { previous: 'Entitlement active', resulting: 'Entitlement expired (manual repair)' };
}

function TriageButtons({ orgId, findingId, status }: Omit<Props, 'role' | 'type'>) {
  const queryClient = useQueryClient();
  const triage = useMutation({
    mutationFn: async (next: 'reviewed' | 'dismissed') =>
      findingDetailSchema.parse(
        await apiFetch(`/api/v1/orgs/${orgId}/reconciliation/findings/${findingId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            status: next,
            note: next === 'reviewed' ? 'Reviewed in the console' : 'Dismissed in the console',
          }),
        }),
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['orgs', orgId] }),
  });
  return (
    <>
      {status === 'open' ? (
        <Button
          variant="outline"
          disabled={triage.isPending}
          onClick={() => triage.mutate('reviewed')}
        >
          Mark reviewed
        </Button>
      ) : null}
      <Button
        variant="outline"
        disabled={triage.isPending}
        onClick={() => triage.mutate('dismissed')}
      >
        Dismiss
      </Button>
      <p role="alert" className="text-destructive w-full text-sm empty:hidden">
        {triage.isError ? describeError(triage.error, 'triage-finding') : null}
      </p>
    </>
  );
}

function RepairFlow({
  orgId,
  findingId,
  type,
  mode,
  onClose,
}: Pick<Props, 'orgId' | 'findingId' | 'type'> & {
  mode: Exclude<Mode, null>;
  onClose: () => void;
}) {
  const path: RepairPath = mode === 'correct' ? 'correct-entitlement' : 'resolve-finding';
  const repair = useRepair(orgId, path);
  const states =
    mode === 'correct'
      ? correctionStates(type)
      : { previous: 'Finding open', resulting: 'Finding resolved' };
  return (
    <RepairDialog
      title={mode === 'correct' ? 'Correct the entitlement?' : 'Resolve this finding?'}
      description={
        mode === 'correct'
          ? 'PayScope changes only its own entitlement record. Nothing is written to the provider.'
          : 'The finding resolves only if a fresh local re-check no longer detects it.'
      }
      confirmLabel={mode === 'correct' ? 'Correct entitlement' : 'Resolve finding'}
      {...states}
      isPending={repair.isPending}
      error={repair.isError ? describeError(repair.error, 'repair') : null}
      onCancel={onClose}
      onConfirm={(reason, idempotencyKey) =>
        repair.mutate({ body: { findingId, reason }, idempotencyKey }, { onSuccess: onClose })
      }
    />
  );
}

export function FindingActions({ orgId, findingId, type, status, role }: Props) {
  const [mode, setMode] = useState<Mode>(null);
  if (isClosed(status)) return null;
  const canTriage = can(role, 'findings:update');
  const canRepair = can(role, 'repairs:execute');
  if (!canTriage && !canRepair) return null;
  const correctable = (CORRECTABLE_FINDING_TYPES as readonly string[]).includes(type);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canTriage ? <TriageButtons orgId={orgId} findingId={findingId} status={status} /> : null}
      {canRepair && correctable ? (
        <Button onClick={() => setMode('correct')}>Correct entitlement</Button>
      ) : null}
      {canRepair ? (
        <Button variant="outline" onClick={() => setMode('resolve')}>
          Resolve after verification
        </Button>
      ) : null}
      {mode ? (
        <RepairFlow
          orgId={orgId}
          findingId={findingId}
          type={type}
          mode={mode}
          onClose={() => setMode(null)}
        />
      ) : null}
    </div>
  );
}
